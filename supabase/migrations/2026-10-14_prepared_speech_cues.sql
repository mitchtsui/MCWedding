-- Human-reviewed prepared caption blocks for manual-mode fallback. Safe to re-run
-- after 2026-10-14_saved_speech_scripts.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS caption_prepared_cues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES caption_scripts(id) ON DELETE CASCADE,
  script_revision integer NOT NULL CHECK (script_revision>0),
  cue_order integer NOT NULL CHECK (cue_order>=0 AND cue_order<120),
  source_text text NOT NULL,
  en text,
  ja text,
  "zh-CN" text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','review_pending','ready')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(script_id,script_revision,cue_order),
  CHECK (caption_utf16_length(source_text) BETWEEN 1 AND 200),
  CHECK (en IS NULL OR caption_utf16_length(en) BETWEEN 1 AND 2000),
  CHECK (ja IS NULL OR caption_utf16_length(ja) BETWEEN 1 AND 2000),
  CHECK ("zh-CN" IS NULL OR caption_utf16_length("zh-CN") BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS caption_prepared_cues_script_idx
  ON caption_prepared_cues(script_id,script_revision,cue_order);

CREATE TABLE IF NOT EXISTS caption_prepared_run_state (
  run_id uuid PRIMARY KEY REFERENCES caption_runs(id) ON DELETE CASCADE,
  script_id uuid NOT NULL REFERENCES caption_scripts(id) ON DELETE CASCADE,
  script_revision integer NOT NULL CHECK (script_revision>0),
  cursor integer NOT NULL DEFAULT -1 CHECK (cursor>=-1),
  current_cue_id uuid REFERENCES caption_prepared_cues(id) ON DELETE SET NULL,
  current_segment_id uuid,
  state_revision integer NOT NULL DEFAULT 1 CHECK (state_revision>0),
  last_operation_id uuid,
  last_operation_type text,
  last_operation_result jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE caption_prepared_run_state ADD COLUMN IF NOT EXISTS last_operation_id uuid;
ALTER TABLE caption_prepared_run_state ADD COLUMN IF NOT EXISTS last_operation_type text;
ALTER TABLE caption_prepared_run_state ADD COLUMN IF NOT EXISTS last_operation_result jsonb;
ALTER TABLE caption_prepared_run_state ADD COLUMN IF NOT EXISTS state_revision integer NOT NULL DEFAULT 1;

-- Keep every deliberate manual action so a delayed retry cannot execute again
-- after another operator has published or cleared in the meantime.
CREATE TABLE IF NOT EXISTS caption_prepared_operations (
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('publish','clear')),
  cue_id uuid,
  expected_script_id uuid NOT NULL,
  expected_cursor integer NOT NULL CHECK (expected_cursor>=-1),
  script_revision integer NOT NULL CHECK (script_revision>0),
  expected_state_revision integer NOT NULL CHECK (expected_state_revision>0),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,operation_id)
);
ALTER TABLE caption_prepared_operations ADD COLUMN IF NOT EXISTS expected_cursor integer;
ALTER TABLE caption_prepared_operations ADD COLUMN IF NOT EXISTS script_revision integer;
ALTER TABLE caption_prepared_operations ADD COLUMN IF NOT EXISTS expected_script_id uuid;
ALTER TABLE caption_prepared_operations ADD COLUMN IF NOT EXISTS expected_state_revision integer;

ALTER TABLE caption_prepared_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE caption_prepared_run_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE caption_prepared_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Caption admins caption_prepared_cues" ON caption_prepared_cues;
CREATE POLICY "Caption admins caption_prepared_cues" ON caption_prepared_cues FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Caption service caption_prepared_cues" ON caption_prepared_cues;
CREATE POLICY "Caption service caption_prepared_cues" ON caption_prepared_cues FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Caption admins caption_prepared_run_state" ON caption_prepared_run_state;
CREATE POLICY "Caption admins caption_prepared_run_state" ON caption_prepared_run_state FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Caption service caption_prepared_run_state" ON caption_prepared_run_state;
CREATE POLICY "Caption service caption_prepared_run_state" ON caption_prepared_run_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Caption admins caption_prepared_operations" ON caption_prepared_operations;
CREATE POLICY "Caption admins caption_prepared_operations" ON caption_prepared_operations FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Caption service caption_prepared_operations" ON caption_prepared_operations;
CREATE POLICY "Caption service caption_prepared_operations" ON caption_prepared_operations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON caption_prepared_cues,caption_prepared_run_state,caption_prepared_operations FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON caption_prepared_cues,caption_prepared_run_state,caption_prepared_operations TO authenticated,service_role;

CREATE OR REPLACE FUNCTION caption_prepared_payload(p_event_id uuid,p_script_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  WITH current_script AS (
    SELECT id,revision FROM caption_scripts WHERE id=p_script_id AND event_id=p_event_id
  ), current_cues AS (
    SELECT c.* FROM caption_prepared_cues c JOIN current_script s
      ON s.id=c.script_id AND s.revision=c.script_revision
  ), summary AS (
    SELECT count(*)::integer total,
      count(*) FILTER (WHERE status<>'pending')::integer translated,
      count(*) FILTER (WHERE status='ready')::integer reviewed,
      COALESCE(bool_and(status='ready'),false) all_ready,
      COALESCE(bool_or(status='pending'),false) has_pending
    FROM current_cues
  )
  SELECT jsonb_build_object(
    'scriptId',s.id,'scriptRevision',s.revision,
    'status',CASE WHEN z.total=0 THEN 'empty' WHEN z.has_pending THEN 'preparing'
      WHEN z.all_ready THEN 'ready' ELSE 'review_pending' END,
    'progress',jsonb_build_object('translated',z.translated,'reviewed',z.reviewed,'total',z.total),
    'cues',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'sequence',cue_order,'sourceText',source_text,'en',en,'ja',ja,'zh-CN',"zh-CN",
      'status',status,'revision',revision
    ) ORDER BY cue_order) FROM current_cues),'[]'::jsonb)
  ) FROM current_script s CROSS JOIN summary z;
$fn$;

CREATE OR REPLACE FUNCTION caption_prepared_context(p_event_id uuid,p_script_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE s caption_scripts; glossary jsonb;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  SELECT * INTO s FROM caption_scripts WHERE id=p_script_id AND event_id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'script not found' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceTerm',source_term,'aliases',aliases,
    'en',en,'ja',ja,'zh-CN',"zh-CN",'priority',priority) ORDER BY priority DESC,source_term),'[]'::jsonb)
    INTO glossary FROM caption_glossary_entries WHERE event_id=p_event_id;
  RETURN jsonb_build_object('scriptId',s.id,'scriptRevision',s.revision,'content',s.content,
    'glossary',glossary,'prepared',caption_prepared_payload(p_event_id,p_script_id));
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_sync_prepared_cues(p_event_id uuid,p_script_id uuid,p_script_revision integer,p_cues jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE s caption_scripts; stored jsonb;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  PERFORM 1 FROM caption_events WHERE id=p_event_id FOR UPDATE;
  SELECT * INTO s FROM caption_scripts WHERE id=p_script_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'script not found' USING ERRCODE='P0002'; END IF;
  IF s.revision<>p_script_revision THEN RAISE EXCEPTION 'script revision is stale' USING ERRCODE='PT409'; END IF;
  IF jsonb_typeof(p_cues) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cues) NOT BETWEEN 1 AND 120 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_cues) value
    WHERE caption_utf16_length(trim(value)) NOT BETWEEN 1 AND 200
  ) THEN RAISE EXCEPTION 'prepared cues are invalid' USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(source_text ORDER BY cue_order) INTO stored FROM caption_prepared_cues
    WHERE script_id=p_script_id AND script_revision=p_script_revision;
  IF stored IS NOT NULL AND stored<>p_cues THEN
    RAISE EXCEPTION 'prepared cue split changed' USING ERRCODE='PT409';
  END IF;
  IF stored IS NULL THEN
    INSERT INTO caption_prepared_cues(script_id,script_revision,cue_order,source_text,updated_by)
    SELECT p_script_id,p_script_revision,(ordinality-1)::integer,trim(value),auth.uid()
    FROM jsonb_array_elements_text(p_cues) WITH ORDINALITY AS cue(value,ordinality);
  END IF;
  RETURN caption_prepared_payload(p_event_id,p_script_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_store_prepared_translation(p_event_id uuid,p_cue_id uuid,p_revision integer,p_translations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE c caption_prepared_cues; s caption_scripts; v_en text:=trim(p_translations->>'en');
  v_ja text:=trim(p_translations->>'ja'); v_zh text:=trim(p_translations->>'zh-CN');
BEGIN
  PERFORM caption_require_operator(p_event_id);
  SELECT * INTO c FROM caption_prepared_cues WHERE id=p_cue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prepared cue not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO s FROM caption_scripts WHERE id=c.script_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR s.revision<>c.script_revision THEN RAISE EXCEPTION 'prepared cue is stale' USING ERRCODE='PT409'; END IF;
  IF c.revision<>p_revision OR c.status<>'pending' THEN RAISE EXCEPTION 'prepared cue revision is stale' USING ERRCODE='PT409'; END IF;
  IF v_en IS NULL OR caption_utf16_length(v_en) NOT BETWEEN 1 AND 2000 OR
     v_ja IS NULL OR caption_utf16_length(v_ja) NOT BETWEEN 1 AND 2000 OR
     v_zh IS NULL OR caption_utf16_length(v_zh) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'prepared translations are invalid' USING ERRCODE='22023';
  END IF;
  UPDATE caption_prepared_cues SET en=v_en,ja=v_ja,"zh-CN"=v_zh,status='review_pending',
    revision=revision+1,updated_by=auth.uid(),updated_at=now() WHERE id=p_cue_id;
  RETURN caption_prepared_payload(p_event_id,c.script_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_update_prepared_cue(p_event_id uuid,p_cue_id uuid,p_revision integer,p_translations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE c caption_prepared_cues; s caption_scripts; v_en text:=trim(p_translations->>'en');
  v_ja text:=trim(p_translations->>'ja'); v_zh text:=trim(p_translations->>'zh-CN');
BEGIN
  PERFORM caption_require_operator(p_event_id);
  SELECT * INTO c FROM caption_prepared_cues WHERE id=p_cue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prepared cue not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO s FROM caption_scripts WHERE id=c.script_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR s.revision<>c.script_revision OR c.revision<>p_revision THEN
    RAISE EXCEPTION 'prepared cue revision is stale' USING ERRCODE='PT409';
  END IF;
  IF c.status='pending' OR v_en IS NULL OR caption_utf16_length(v_en) NOT BETWEEN 1 AND 2000 OR
     v_ja IS NULL OR caption_utf16_length(v_ja) NOT BETWEEN 1 AND 2000 OR
     v_zh IS NULL OR caption_utf16_length(v_zh) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'prepared translations are invalid' USING ERRCODE='22023';
  END IF;
  UPDATE caption_prepared_cues SET en=v_en,ja=v_ja,"zh-CN"=v_zh,status='review_pending',
    revision=revision+1,updated_by=auth.uid(),updated_at=now() WHERE id=p_cue_id;
  RETURN caption_prepared_payload(p_event_id,c.script_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_review_prepared_cue(p_event_id uuid,p_cue_id uuid,p_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE c caption_prepared_cues; s caption_scripts;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  SELECT * INTO c FROM caption_prepared_cues WHERE id=p_cue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prepared cue not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO s FROM caption_scripts WHERE id=c.script_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR s.revision<>c.script_revision OR c.revision<>p_revision THEN
    RAISE EXCEPTION 'prepared cue revision is stale' USING ERRCODE='PT409';
  END IF;
  IF c.status<>'review_pending' OR c.en IS NULL OR c.ja IS NULL OR c."zh-CN" IS NULL THEN
    RAISE EXCEPTION 'prepared cue is not reviewable' USING ERRCODE='22023';
  END IF;
  UPDATE caption_prepared_cues SET status='ready',revision=revision+1,
    updated_by=auth.uid(),updated_at=now() WHERE id=p_cue_id;
  RETURN caption_prepared_payload(p_event_id,c.script_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_prepared_run_payload(p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT jsonb_build_object('runId',r.id,'mode',r.mode,'state',r.state,
    'scriptId',st.script_id,'scriptRevision',st.script_revision,
    'stateRevision',st.state_revision,
    'cursor',st.cursor,'currentCueId',st.current_cue_id,'currentSegmentId',st.current_segment_id,
    'total',(SELECT count(*) FROM caption_prepared_cues c WHERE c.script_id=st.script_id AND c.script_revision=st.script_revision),
    'complete',st.cursor >= (SELECT count(*)-1 FROM caption_prepared_cues c WHERE c.script_id=st.script_id AND c.script_revision=st.script_revision))
  FROM caption_prepared_run_state st JOIN caption_runs r ON r.id=st.run_id WHERE st.run_id=p_run_id;
$fn$;

CREATE OR REPLACE FUNCTION caption_select_prepared_script(p_run_id uuid,p_script_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; s caption_scripts; prepared jsonb;
BEGIN
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(r.event_id);
  IF r.mode<>'manual' OR r.state NOT IN ('live','degraded') THEN
    RAISE EXCEPTION 'prepared captions require an active manual run' USING ERRCODE='22023';
  END IF;
  SELECT * INTO s FROM caption_scripts WHERE id=p_script_id AND event_id=r.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'script not found' USING ERRCODE='P0002'; END IF;
  prepared:=caption_prepared_payload(r.event_id,p_script_id);
  IF prepared IS NULL OR prepared->>'status'<>'ready' THEN
    RAISE EXCEPTION 'all prepared cues must be reviewed and ready' USING ERRCODE='22023';
  END IF;
  INSERT INTO caption_prepared_run_state(run_id,script_id,script_revision,cursor,current_cue_id,current_segment_id,updated_by)
    VALUES(p_run_id,p_script_id,s.revision,-1,NULL,NULL,auth.uid())
  ON CONFLICT(run_id) DO UPDATE SET script_id=EXCLUDED.script_id,script_revision=EXCLUDED.script_revision,
    cursor=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.cursor ELSE -1 END,
    current_cue_id=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.current_cue_id ELSE NULL END,
    current_segment_id=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.current_segment_id ELSE NULL END,
    last_operation_id=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.last_operation_id ELSE NULL END,
    last_operation_type=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.last_operation_type ELSE NULL END,
    last_operation_result=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.last_operation_result ELSE NULL END,
    state_revision=CASE WHEN caption_prepared_run_state.script_id=EXCLUDED.script_id AND
      caption_prepared_run_state.script_revision=EXCLUDED.script_revision THEN caption_prepared_run_state.state_revision
      ELSE caption_prepared_run_state.state_revision+1 END,
    updated_by=auth.uid(),updated_at=now();
  RETURN caption_prepared_run_payload(p_run_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_get_prepared_run(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs;
BEGIN
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(r.event_id);
  IF NOT EXISTS (SELECT 1 FROM caption_prepared_run_state WHERE run_id=p_run_id) THEN
    RAISE EXCEPTION 'prepared script is not selected' USING ERRCODE='P0002';
  END IF;
  RETURN caption_prepared_run_payload(p_run_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_publish_prepared_cue(p_run_id uuid,p_operation_id uuid,p_cue_id uuid,
  p_expected_script_id uuid,p_expected_cursor integer,p_script_revision integer,p_expected_state_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; st caption_prepared_run_state; c caption_prepared_cues;
  op caption_prepared_operations; en_result jsonb; ja_result jsonb; zh_result jsonb; sid uuid; result jsonb;
BEGIN
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(r.event_id);
  IF r.mode<>'manual' OR r.state NOT IN ('live','degraded') THEN
    RAISE EXCEPTION 'prepared captions require an active manual run' USING ERRCODE='22023';
  END IF;
  SELECT * INTO st FROM caption_prepared_run_state WHERE run_id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prepared script is not selected' USING ERRCODE='P0002'; END IF;
  SELECT * INTO op FROM caption_prepared_operations
    WHERE run_id=p_run_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF op.operation_type<>'publish' OR op.cue_id IS DISTINCT FROM p_cue_id OR
       op.expected_script_id IS DISTINCT FROM p_expected_script_id OR op.expected_cursor IS DISTINCT FROM p_expected_cursor OR
       op.script_revision IS DISTINCT FROM p_script_revision OR op.expected_state_revision IS DISTINCT FROM p_expected_state_revision THEN
      RAISE EXCEPTION 'operation id was already used for different input' USING ERRCODE='22023';
    END IF;
    RETURN caption_prepared_run_payload(p_run_id)||jsonb_build_object(
      'delivery_outbox_ids',op.result->'delivery_outbox_ids','replayed',true,
      'operationSegmentId',op.result->'currentSegmentId');
  END IF;
  IF p_expected_script_id IS NULL OR p_expected_cursor IS NULL OR p_script_revision IS NULL OR p_expected_state_revision IS NULL OR
     st.script_id<>p_expected_script_id OR st.cursor<>p_expected_cursor OR st.script_revision<>p_script_revision OR
     st.state_revision<>p_expected_state_revision THEN
    RAISE EXCEPTION 'prepared run state is stale' USING ERRCODE='PT409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM caption_scripts WHERE id=st.script_id AND event_id=r.event_id AND revision=st.script_revision) THEN
    RAISE EXCEPTION 'prepared script revision is stale' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO c FROM caption_prepared_cues WHERE script_id=st.script_id AND script_revision=st.script_revision
    AND ((p_cue_id IS NULL AND cue_order=st.cursor+1) OR (p_cue_id IS NOT NULL AND id=p_cue_id))
    AND status='ready' FOR UPDATE;
  IF NOT FOUND THEN
    IF p_cue_id IS NOT NULL THEN
      RAISE EXCEPTION 'prepared cue is not ready for this script' USING ERRCODE='P0002';
    ELSIF EXISTS (SELECT 1 FROM caption_prepared_cues WHERE script_id=st.script_id AND script_revision=st.script_revision AND cue_order>st.cursor) THEN
      RAISE EXCEPTION 'next prepared cue is not ready' USING ERRCODE='22023';
    END IF;
    UPDATE caption_prepared_run_state SET last_operation_id=p_operation_id,last_operation_type='publish',
      state_revision=state_revision+1,updated_at=now() WHERE run_id=p_run_id;
    result:=caption_prepared_run_payload(p_run_id) || jsonb_build_object('delivery_outbox_ids','[]'::jsonb,'complete',true);
    UPDATE caption_prepared_run_state SET last_operation_result=result WHERE run_id=p_run_id;
    INSERT INTO caption_prepared_operations(run_id,operation_id,operation_type,cue_id,expected_script_id,expected_cursor,
      script_revision,expected_state_revision,result)
      VALUES(p_run_id,p_operation_id,'publish',p_cue_id,p_expected_script_id,p_expected_cursor,p_script_revision,p_expected_state_revision,result);
    RETURN result;
  END IF;
  en_result:=caption_manual_publish(p_run_id,'en',c.en,NULL);
  sid:=(en_result->>'segment_id')::uuid;
  ja_result:=caption_manual_publish(p_run_id,'ja',c.ja,sid);
  zh_result:=caption_manual_publish(p_run_id,'zh-CN',c."zh-CN",sid);
  UPDATE caption_prepared_run_state SET cursor=c.cue_order,current_cue_id=c.id,current_segment_id=sid,
    state_revision=state_revision+1,updated_by=auth.uid(),updated_at=now() WHERE run_id=p_run_id;
  result:=caption_prepared_run_payload(p_run_id);
  result:=result || jsonb_build_object('delivery_outbox_ids',
    (en_result->'delivery_outbox_ids')||(ja_result->'delivery_outbox_ids')||(zh_result->'delivery_outbox_ids'));
  UPDATE caption_prepared_run_state SET last_operation_id=p_operation_id,last_operation_type='publish',
    last_operation_result=result,updated_at=now() WHERE run_id=p_run_id;
  INSERT INTO caption_prepared_operations(run_id,operation_id,operation_type,cue_id,expected_script_id,expected_cursor,
    script_revision,expected_state_revision,result)
    VALUES(p_run_id,p_operation_id,'publish',p_cue_id,p_expected_script_id,p_expected_cursor,p_script_revision,p_expected_state_revision,result);
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_clear_prepared(p_run_id uuid,p_operation_id uuid,
  p_expected_script_id uuid,p_expected_cursor integer,p_script_revision integer,p_expected_state_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; st caption_prepared_run_state; op caption_prepared_operations;
  lang text; published jsonb; sid uuid;
  outbox_ids jsonb:='[]'::jsonb; outbox_id uuid;
BEGIN
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(r.event_id);
  IF r.mode<>'manual' OR r.state NOT IN ('live','degraded') THEN
    RAISE EXCEPTION 'prepared captions require an active manual run' USING ERRCODE='22023';
  END IF;
  SELECT * INTO st FROM caption_prepared_run_state WHERE run_id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prepared script is not selected' USING ERRCODE='P0002'; END IF;
  SELECT * INTO op FROM caption_prepared_operations
    WHERE run_id=p_run_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF op.operation_type<>'clear' OR op.expected_script_id IS DISTINCT FROM p_expected_script_id OR
       op.expected_cursor IS DISTINCT FROM p_expected_cursor OR op.script_revision IS DISTINCT FROM p_script_revision OR
       op.expected_state_revision IS DISTINCT FROM p_expected_state_revision THEN
      RAISE EXCEPTION 'operation id was already used for different input' USING ERRCODE='22023';
    END IF;
    published:=caption_prepared_run_payload(p_run_id)||jsonb_build_object(
      'delivery_outbox_ids',op.result->'delivery_outbox_ids','replayed',true,
      'operationSegmentId',op.result->'currentSegmentId');
    RETURN published||jsonb_build_object('cleared',published->'currentSegmentId'=op.result->'currentSegmentId');
  END IF;
  IF p_expected_script_id IS NULL OR p_expected_cursor IS NULL OR p_script_revision IS NULL OR p_expected_state_revision IS NULL OR
     st.script_id<>p_expected_script_id OR st.cursor<>p_expected_cursor OR st.script_revision<>p_script_revision OR
     st.state_revision<>p_expected_state_revision THEN
    RAISE EXCEPTION 'prepared run state is stale' USING ERRCODE='PT409';
  END IF;
  -- Clear is its own ordered marker. Reusing a caption segment could let a late
  -- same-segment update resurrect text or make snapshot ordering ambiguous.
  sid:=NULL;
  FOREACH lang IN ARRAY ARRAY['en','ja','zh-CN'] LOOP
    published:=caption_manual_publish(p_run_id,lang,'',sid);
    sid:=COALESCE(sid,(published->>'segment_id')::uuid);
    outbox_id:=(published->'delivery_outbox_ids'->>0)::uuid;
    UPDATE caption_captions SET origin='system' WHERE run_id=p_run_id AND segment_id=sid AND language=lang;
    UPDATE caption_outbox_events SET payload=jsonb_set(jsonb_set(payload,'{updates,0,origin}','"system"'::jsonb),
      '{updates,0,clear}','true'::jsonb) WHERE id=outbox_id;
    outbox_ids:=outbox_ids||jsonb_build_array(outbox_id);
  END LOOP;
  UPDATE caption_prepared_run_state SET current_segment_id=sid,current_cue_id=NULL,
    state_revision=state_revision+1,updated_by=auth.uid(),updated_at=now() WHERE run_id=p_run_id;
  published:=caption_prepared_run_payload(p_run_id)||jsonb_build_object('delivery_outbox_ids',outbox_ids,'cleared',true);
  UPDATE caption_prepared_run_state SET last_operation_id=p_operation_id,last_operation_type='clear',
    last_operation_result=published WHERE run_id=p_run_id;
  INSERT INTO caption_prepared_operations(run_id,operation_id,operation_type,cue_id,expected_script_id,expected_cursor,
    script_revision,expected_state_revision,result)
    VALUES(p_run_id,p_operation_id,'clear',NULL,p_expected_script_id,p_expected_cursor,p_script_revision,p_expected_state_revision,published);
  RETURN published;
END;
$fn$;

-- Manual runs never issue audio uplink tickets.
CREATE OR REPLACE FUNCTION caption_issue_uplink_ticket(p_run_id uuid, p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v caption_runs;
  raw_token text;
  v_exp timestamptz := now()+interval '90 seconds';
  v_user_id uuid := COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  SELECT * INTO v FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(v.event_id);
  IF v.mode<>'live' OR v.state NOT IN ('live','degraded') THEN RAISE EXCEPTION 'run is not accepting audio' USING ERRCODE='22023'; END IF;
  raw_token := encode(gen_random_bytes(32),'base64');
  UPDATE caption_runs SET publisher_id=v_user_id,fencing_token=fencing_token+1,channel_epoch=gen_random_uuid(),lease_expires_at=v_exp WHERE id=p_run_id RETURNING * INTO v;
  DELETE FROM caption_channel_sequences WHERE run_id=p_run_id;
  INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through)
    VALUES(p_run_id,'en',0,0),(p_run_id,'ja',0,0),(p_run_id,'zh-CN',0,0);
  INSERT INTO caption_uplink_tickets(run_id,user_id,mode_generation,fencing_token,token_hash,allowed_origin,expires_at)
  VALUES(p_run_id,v_user_id,v.mode_generation,v.fencing_token,digest(raw_token,'sha256'),p_origin,v_exp);
  RETURN jsonb_build_object('token',raw_token,'expires_at',v_exp,'run_id',v.id,'event_id',v.event_id,'mode_generation',v.mode_generation,'fencing_token',v.fencing_token,'channel_epoch',v.channel_epoch);
END;
$fn$;

-- A system-origin blank caption is the durable clear marker consumed by the client.
CREATE OR REPLACE FUNCTION caption_snapshot(p_event_id uuid,p_run_id uuid,p_language text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; updates jsonb; current_run uuid;
BEGIN
  IF auth.role()<>'service_role' AND NOT is_admin() AND NOT EXISTS(
    SELECT 1 FROM caption_event_members WHERE event_id=p_event_id AND user_id=auth.uid() AND (expires_at IS NULL OR expires_at>now())
  ) THEN RAISE EXCEPTION 'caption membership required' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id AND event_id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  SELECT current_run_id INTO current_run FROM caption_events WHERE id=p_event_id;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'segmentOrder')::bigint),'[]'::jsonb) INTO updates FROM (
    SELECT jsonb_build_object('segmentId',s.segment_id,'segmentOrder',s.segment_order,'sourceRevision',c.source_revision,
      'captionRevision',c.caption_revision,'status',c.status,'origin',c.origin,'text',c.text,'language',c.language,
      'clear',(c.origin='system' AND c.text='')) x
    FROM caption_captions c JOIN caption_source_segments s USING(run_id,segment_id)
    WHERE c.run_id=p_run_id AND c.language=p_language ORDER BY s.segment_order DESC LIMIT 50
  ) q;
  SELECT updates || COALESCE(jsonb_agg(jsonb_build_object('segmentId',segment_id,'segmentOrder',segment_order,'sourceRevision',source_revision,
    'captionRevision',caption_revision,'status','draft','origin','ai_live','text',text,'language',language,'clear',false) ORDER BY segment_order),'[]'::jsonb)
  INTO updates FROM caption_draft_checkpoints WHERE run_id=p_run_id AND language=p_language;
  RETURN jsonb_build_object('eventId',p_event_id,'runId',r.id,'currentRunId',current_run,'modeGeneration',r.mode_generation,'channelEpoch',r.channel_epoch,
    'messageSeq',COALESCE((SELECT message_seq FROM caption_channel_sequences WHERE run_id=p_run_id AND language=p_language),0),
    'status',CASE WHEN r.mode='live' AND r.state='live' AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=now()) THEN 'disconnected' ELSE r.state END,
    'language',p_language,'topic','caption:'||p_event_id::text||':'||p_language,'updates',COALESCE(updates,'[]'::jsonb));
END;
$fn$;

DO $do$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.proname,n.nspname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'caption_prepared_payload','caption_prepared_context','caption_sync_prepared_cues',
      'caption_store_prepared_translation','caption_update_prepared_cue','caption_review_prepared_cue',
      'caption_prepared_run_payload','caption_select_prepared_script','caption_get_prepared_run','caption_publish_prepared_cue',
      'caption_clear_prepared','caption_issue_uplink_ticket','caption_snapshot'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',f.nspname,f.proname,f.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',f.nspname,f.proname,f.args);
  END LOOP;
END;
$do$;
GRANT EXECUTE ON FUNCTION caption_snapshot(uuid,uuid,text),caption_issue_uplink_ticket(uuid,text) TO authenticated;

COMMIT;
