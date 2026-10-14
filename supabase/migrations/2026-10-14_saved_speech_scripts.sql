-- Saved speech scripts remain available independently of the exact set selected
-- as reference context for the current speech. Safe to re-run after the base,
-- guest-link, password-operator, and non-retrying-conflict migrations.

BEGIN;

CREATE OR REPLACE FUNCTION caption_utf16_length(p_text text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=public AS $fn$
  SELECT char_length(p_text) + COALESCE((
    SELECT count(*) FROM generate_series(1,char_length(p_text)) AS position
    WHERE ascii(substr(p_text,position,1))>65535
  ),0)::integer;
$fn$;

CREATE OR REPLACE FUNCTION caption_script_reference_length(p_event_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  WITH ordered AS (
    SELECT content,row_number() OVER (ORDER BY sequence,updated_at,id) AS cue_id
    FROM caption_scripts WHERE event_id=p_event_id AND active
  )
  SELECT COALESCE(sum(char_length(cue_id::text)+2+caption_utf16_length(content)) + GREATEST(count(*)-1,0),0)::integer
  FROM ordered;
$fn$;

CREATE OR REPLACE FUNCTION caption_scripts_payload(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT jsonb_build_object('scripts',COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'title',title,'content',content,'sequence',sequence,'active',active,'revision',revision
  ) ORDER BY sequence,updated_at,id),'[]'::jsonb))
  FROM caption_scripts WHERE event_id=p_event_id;
$fn$;

CREATE OR REPLACE FUNCTION caption_list_scripts(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  PERFORM caption_require_operator(p_event_id);
  IF NOT EXISTS (SELECT 1 FROM caption_events WHERE id=p_event_id) THEN
    RAISE EXCEPTION 'caption event not found' USING ERRCODE='P0002';
  END IF;
  RETURN caption_scripts_payload(p_event_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_selected_scripts(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE scripts jsonb;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  IF NOT EXISTS (SELECT 1 FROM caption_events WHERE id=p_event_id) THEN
    RAISE EXCEPTION 'caption event not found' USING ERRCODE='P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'sequence',cue_id,'text',content)
    ORDER BY cue_id),'[]'::jsonb) INTO scripts
  FROM (
    SELECT id,content,row_number() OVER (ORDER BY sequence,updated_at,id)::integer AS cue_id
    FROM caption_scripts WHERE event_id=p_event_id AND active
  ) selected;
  RETURN scripts;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_upsert_script(p_event_id uuid,p_script jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v caption_scripts;
  v_title text := trim(p_script->>'title');
  v_content text := trim(p_script->>'content');
  v_sequence integer;
  v_expected_revision integer;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  PERFORM 1 FROM caption_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'caption event not found' USING ERRCODE='P0002';
  END IF;
  IF jsonb_typeof(p_script) IS DISTINCT FROM 'object' OR v_title IS NULL OR caption_utf16_length(v_title) NOT BETWEEN 1 AND 240 OR
     v_content IS NULL OR caption_utf16_length(v_content) NOT BETWEEN 1 AND 12000 THEN
    RAISE EXCEPTION 'script title or content is invalid' USING ERRCODE='22023';
  END IF;
  BEGIN
    v_sequence := COALESCE((p_script->>'sequence')::integer,0);
    v_expected_revision := CASE WHEN p_script ? 'revision' THEN (p_script->>'revision')::integer ELSE NULL END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'script sequence or revision is invalid' USING ERRCODE='22023';
  END;
  IF v_sequence < 0 OR (v_expected_revision IS NOT NULL AND v_expected_revision < 1) THEN
    RAISE EXCEPTION 'script sequence or revision is invalid' USING ERRCODE='22023';
  END IF;

  IF p_script ? 'id' THEN
    UPDATE caption_scripts SET title=v_title,content=v_content,sequence=v_sequence,
      revision=revision+1,updated_by=auth.uid(),updated_at=now()
    WHERE id=(p_script->>'id')::uuid AND event_id=p_event_id
      AND (v_expected_revision IS NULL OR revision=v_expected_revision)
    RETURNING * INTO v;
    IF v.id IS NULL THEN
      IF v_expected_revision IS NOT NULL AND EXISTS (
        SELECT 1 FROM caption_scripts WHERE id=(p_script->>'id')::uuid AND event_id=p_event_id
      ) THEN
        RAISE EXCEPTION 'script revision is stale' USING ERRCODE='PT409';
      END IF;
      RAISE EXCEPTION 'script not found' USING ERRCODE='P0002';
    END IF;
  ELSE
    INSERT INTO caption_scripts(event_id,title,content,sequence,active,updated_by)
    VALUES(p_event_id,v_title,v_content,v_sequence,false,auth.uid()) RETURNING * INTO v;
  END IF;

  -- Editing a selected script can increase the full formatted reference. Raising
  -- here rolls the whole function back, including its revision increment.
  IF caption_script_reference_length(p_event_id)>12000 THEN
    RAISE EXCEPTION 'selected scripts exceed the 12000 character reference limit' USING ERRCODE='22001';
  END IF;
  RETURN caption_scripts_payload(p_event_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_select_scripts(p_event_id uuid,p_script_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_ids uuid[] := COALESCE(p_script_ids,'{}'::uuid[]);
  v_requested integer := cardinality(COALESCE(p_script_ids,'{}'::uuid[]));
  v_found integer;
  v_reference_length integer;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  PERFORM 1 FROM caption_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'caption event not found' USING ERRCODE='P0002';
  END IF;
  IF v_requested>100 THEN
    RAISE EXCEPTION 'too many scripts selected' USING ERRCODE='22023';
  END IF;

  -- The event-row lock serializes selection with every script edit for this event.
  SELECT count(*)::integer INTO v_found FROM caption_scripts
    WHERE event_id=p_event_id AND id=ANY(v_ids);
  IF v_found<>v_requested THEN
    RAISE EXCEPTION 'one or more scripts do not belong to this event' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(sum(char_length(cue_id::text)+2+caption_utf16_length(content)) + GREATEST(count(*)-1,0),0)::integer
    INTO v_reference_length
  FROM (
    SELECT content,row_number() OVER (ORDER BY sequence,updated_at,id) AS cue_id
    FROM caption_scripts WHERE event_id=p_event_id AND id=ANY(v_ids)
  ) selected;
  IF v_reference_length>12000 THEN
    RAISE EXCEPTION 'selected scripts exceed the 12000 character reference limit' USING ERRCODE='22001';
  END IF;

  UPDATE caption_scripts SET active=(id=ANY(v_ids))
    WHERE event_id=p_event_id AND active IS DISTINCT FROM (id=ANY(v_ids));
  RETURN caption_scripts_payload(p_event_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_runtime_context(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; scripts jsonb; glossary jsonb; recent jsonb; sequences jsonb;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  scripts := caption_selected_scripts(r.event_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceTerm',source_term,'aliases',aliases,'en',en,'ja',ja,'zh-CN',"zh-CN",'priority',priority,'revision',revision) ORDER BY priority DESC,source_term),'[]'::jsonb)
    INTO glossary FROM (SELECT * FROM caption_glossary_entries WHERE event_id=r.event_id ORDER BY priority DESC,source_term LIMIT 100) q;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('segmentId',segment_id,'segmentOrder',segment_order,'sourceRevision',source_revision,'text',text,'status',status,'providerItemId',provider_item_id) ORDER BY segment_order),'[]'::jsonb)
    INTO recent FROM (SELECT * FROM caption_source_segments WHERE run_id=p_run_id ORDER BY segment_order DESC LIMIT 20) q;
  SELECT COALESCE(jsonb_object_agg(language,message_seq),'{}'::jsonb) INTO sequences FROM caption_channel_sequences WHERE run_id=p_run_id;
  RETURN jsonb_build_object('runId',r.id,'modeGeneration',r.mode_generation,'scripts',scripts,'glossary',glossary,'recentSources',recent,'messageSeqByLanguage',sequences);
END;
$fn$;

DO $do$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.proname,n.nspname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'caption_utf16_length','caption_script_reference_length','caption_scripts_payload','caption_list_scripts',
      'caption_selected_scripts','caption_upsert_script','caption_select_scripts','caption_runtime_context'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',f.nspname,f.proname,f.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',f.nspname,f.proname,f.args);
  END LOOP;
END;
$do$;

COMMIT;
