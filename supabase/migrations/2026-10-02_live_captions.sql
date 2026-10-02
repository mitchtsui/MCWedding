-- Live captions subsystem. Additive and safe to apply without touching the roster.
-- Apply to a non-production Supabase project first. This file does not change any
-- project-level Auth or Realtime setting (anonymous Auth/private channels remain
-- deployment prerequisites).

-- Supabase keeps pgcrypto in the extensions schema; the four functions that hash tokens add it to their search_path.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS caption_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  source_languages text[] NOT NULL DEFAULT ARRAY['yue','en'],
  target_languages text[] NOT NULL DEFAULT ARRAY['en','ja','zh-CN'],
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','live','paused','ended','stopped')),
  current_run_id uuid,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(settings) <= 32768),
  retention_days integer NOT NULL DEFAULT 7 CHECK (retention_days BETWEEN 1 AND 90),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caption_event_members (
  event_id uuid NOT NULL REFERENCES caption_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('guest','operator','admin')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS caption_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES caption_events(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 60 CHECK (max_uses BETWEEN 1 AND 500),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS caption_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES caption_events(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('live','manual','script')),
  mode_generation integer NOT NULL DEFAULT 1 CHECK (mode_generation > 0),
  state text NOT NULL DEFAULT 'starting' CHECK (state IN ('starting','live','paused','ending','ended','stopped','degraded')),
  channel_epoch uuid NOT NULL DEFAULT gen_random_uuid(),
  message_seq bigint NOT NULL DEFAULT 0 CHECK (message_seq >= 0),
  next_segment_order bigint NOT NULL DEFAULT 0 CHECK (next_segment_order >= 0),
  publisher_id uuid,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_expires_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_by uuid
);
ALTER TABLE caption_runs ADD COLUMN IF NOT EXISTS next_segment_order bigint NOT NULL DEFAULT 0;

ALTER TABLE caption_events DROP CONSTRAINT IF EXISTS caption_events_current_run_id_fkey;
ALTER TABLE caption_events ADD CONSTRAINT caption_events_current_run_id_fkey
  FOREIGN KEY (current_run_id) REFERENCES caption_runs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS caption_one_open_run_per_event
  ON caption_runs(event_id) WHERE state IN ('starting','live','paused','ending','degraded');
CREATE INDEX IF NOT EXISTS caption_members_user_idx ON caption_event_members(user_id, event_id);
CREATE INDEX IF NOT EXISTS caption_runs_event_idx ON caption_runs(event_id, started_at DESC);

CREATE TABLE IF NOT EXISTS caption_source_segments (
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL,
  segment_order bigint NOT NULL CHECK (segment_order >= 0),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  text text NOT NULL CHECK (char_length(text) <= 12000),
  status text NOT NULL CHECK (status IN ('draft','final','corrected','unavailable')),
  capture_start_sample bigint CHECK (capture_start_sample IS NULL OR capture_start_sample >= 0),
  capture_end_sample bigint CHECK (capture_end_sample IS NULL OR capture_end_sample >= capture_start_sample),
  provider_session_id text,
  provider_item_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, segment_id),
  UNIQUE (run_id, segment_order)
);

CREATE TABLE IF NOT EXISTS caption_captions (
  run_id uuid NOT NULL,
  segment_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('en','ja','zh-CN')),
  text text NOT NULL CHECK (char_length(text) <= 12000),
  status text NOT NULL CHECK (status IN ('draft','final','corrected','unavailable')),
  caption_revision integer NOT NULL CHECK (caption_revision > 0),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  origin text NOT NULL CHECK (origin IN ('ai_live','script_assist','manual','system')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, segment_id, language),
  FOREIGN KEY (run_id, segment_id) REFERENCES caption_source_segments(run_id, segment_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS caption_draft_checkpoints (
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL,
  segment_order bigint NOT NULL CHECK (segment_order >= 0),
  language text NOT NULL CHECK (language IN ('en','ja','zh-CN')),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  caption_revision integer NOT NULL CHECK (caption_revision > 0),
  text text NOT NULL CHECK (char_length(text) <= 12000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, segment_id, language)
);
CREATE INDEX IF NOT EXISTS caption_draft_recent_idx
  ON caption_draft_checkpoints(run_id, language, segment_order DESC);

CREATE TABLE IF NOT EXISTS caption_channel_sequences (
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','ja','zh-CN')),
  message_seq bigint NOT NULL DEFAULT 0 CHECK (message_seq >= 0),
  allocated_through bigint NOT NULL DEFAULT 0 CHECK (allocated_through >= message_seq),
  PRIMARY KEY (run_id, language)
);
ALTER TABLE caption_channel_sequences ADD COLUMN IF NOT EXISTS allocated_through bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS caption_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES caption_events(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','ja','zh-CN')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 240),
  payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 131072),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (run_id, language, idempotency_key)
);
CREATE INDEX IF NOT EXISTS caption_outbox_pending_idx
  ON caption_outbox_events(status, available_at, created_at) WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS caption_uplink_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  mode_generation integer NOT NULL CHECK (mode_generation > 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  token_hash bytea NOT NULL UNIQUE,
  allowed_origin text NOT NULL CHECK (char_length(allowed_origin) BETWEEN 8 AND 500),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
ALTER TABLE caption_uplink_tickets ADD COLUMN IF NOT EXISTS mode_generation integer;
ALTER TABLE caption_uplink_tickets ADD COLUMN IF NOT EXISTS fencing_token bigint;

CREATE TABLE IF NOT EXISTS caption_glossary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES caption_events(id) ON DELETE CASCADE,
  source_term text NOT NULL CHECK (char_length(source_term) BETWEEN 1 AND 240),
  aliases text[] NOT NULL DEFAULT '{}',
  en text, ja text, "zh-CN" text,
  pronunciation_note text,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, source_term)
);

CREATE TABLE IF NOT EXISTS caption_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES caption_events(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200000),
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE caption_scripts ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS caption_scripts_event_sequence_idx ON caption_scripts(event_id, sequence, updated_at);

CREATE TABLE IF NOT EXISTS caption_script_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES caption_runs(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL,
  segment_order bigint NOT NULL DEFAULT 0 CHECK (segment_order >= 0),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  provider_item_id text,
  original_text text NOT NULL CHECK (char_length(original_text) <= 12000),
  proposed_text text CHECK (char_length(proposed_text) <= 12000),
  matched_script_id uuid REFERENCES caption_scripts(id) ON DELETE SET NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected','uncertain')),
  decided_by uuid,
  decided_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  applied_at timestamptz,
  apply_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, segment_id, source_revision)
);
ALTER TABLE caption_script_reviews ADD COLUMN IF NOT EXISTS claimed_by text;
ALTER TABLE caption_script_reviews ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE caption_script_reviews ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE caption_script_reviews ADD COLUMN IF NOT EXISTS apply_error_code text;
ALTER TABLE caption_script_reviews ADD COLUMN IF NOT EXISTS segment_order bigint NOT NULL DEFAULT 0;
ALTER TABLE caption_script_reviews ADD COLUMN IF NOT EXISTS provider_item_id text;

CREATE TABLE IF NOT EXISTS caption_operational_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id uuid REFERENCES caption_events(id) ON DELETE CASCADE,
  run_id uuid REFERENCES caption_runs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 100),
  details_safe jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details_safe) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caption_ops_run_idx ON caption_operational_events(run_id, created_at DESC);

-- All application tables are RLS protected. Guests use scoped RPCs rather than
-- direct table reads; administrators retain inspectability through is_admin().
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'caption_events','caption_event_members','caption_invites','caption_runs',
    'caption_source_segments','caption_captions','caption_draft_checkpoints','caption_channel_sequences',
    'caption_outbox_events','caption_uplink_tickets','caption_glossary_entries',
    'caption_scripts','caption_script_reviews','caption_operational_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Caption admins ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', 'Caption admins ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Caption service ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'Caption service ' || t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
  -- The API reads an event's current run directly when a second start is refused (api/captions.js);
  -- every other server access goes through the functions below. Stated here, not left to default privileges.
  GRANT SELECT ON public.caption_events TO service_role;
END;
$do$;

CREATE OR REPLACE FUNCTION caption_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

DROP TRIGGER IF EXISTS caption_events_touch ON caption_events;
CREATE TRIGGER caption_events_touch BEFORE UPDATE ON caption_events
FOR EACH ROW EXECUTE FUNCTION caption_touch_updated_at();

CREATE OR REPLACE FUNCTION caption_require_operator(p_event_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.role() = 'service_role' OR is_admin() OR EXISTS (
    SELECT 1 FROM caption_event_members
    WHERE event_id = p_event_id AND user_id = auth.uid()
      AND role IN ('operator','admin') AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN; END IF;
  RAISE EXCEPTION 'caption operator required' USING ERRCODE = '42501';
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_create_event(p_title text, p_settings jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v caption_events;
BEGIN
  PERFORM caption_require_operator(NULL);
  INSERT INTO caption_events(title, settings, created_by)
  VALUES (trim(p_title), COALESCE(p_settings, '{}'::jsonb), auth.uid()) RETURNING * INTO v;
  RETURN jsonb_build_object('event_id',v.id,'status',v.status);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_start_run(p_event_id uuid, p_mode text DEFAULT 'live')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v caption_runs;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  IF EXISTS (SELECT 1 FROM caption_runs WHERE event_id=p_event_id AND state IN ('starting','live','paused','ending','degraded')) THEN
    RAISE EXCEPTION 'event already has an open run' USING ERRCODE='23505';
  END IF;
  INSERT INTO caption_runs(event_id,mode,state,created_by) VALUES(p_event_id,p_mode,'live',auth.uid()) RETURNING * INTO v;
  UPDATE caption_events SET current_run_id=v.id,status='live' WHERE id=p_event_id;
  RETURN jsonb_build_object('run_id',v.id,'event_id',v.event_id,'state',v.state,'mode_generation',v.mode_generation,'channel_epoch',v.channel_epoch,'fencing_token',v.fencing_token);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_transition_run(p_run_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v caption_runs; next_state text; next_event text; lang text; seq bigint; outbox_id uuid; outbox_ids jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO v FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(v.event_id);
  next_state := CASE p_action
    WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'live'
    WHEN 'end' THEN 'ended' WHEN 'stop' THEN 'stopped' ELSE NULL END;
  IF next_state IS NULL OR (p_action='pause' AND v.state<>'live') OR
     (p_action='resume' AND v.state<>'paused') OR
     (p_action IN ('end','stop') AND v.state NOT IN ('starting','live','paused','degraded')) THEN
    RAISE EXCEPTION 'invalid run transition' USING ERRCODE='22023';
  END IF;
  UPDATE caption_runs SET state=next_state, mode_generation=mode_generation+1,
    lease_expires_at=NULL, publisher_id=NULL,
    ended_at=CASE WHEN next_state IN ('ended','stopped') THEN now() ELSE ended_at END
  WHERE id=p_run_id RETURNING * INTO v;
  next_event := CASE WHEN next_state='live' THEN 'live' WHEN next_state='paused' THEN 'paused'
    WHEN next_state='ended' THEN 'ended' ELSE 'stopped' END;
  UPDATE caption_events SET status=next_event,
    current_run_id=CASE WHEN next_state IN ('ended','stopped') THEN NULL ELSE p_run_id END
  WHERE id=v.event_id;
  FOR lang IN SELECT unnest(target_languages) FROM caption_events WHERE id=v.event_id LOOP
    INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through) VALUES(p_run_id,lang,0,1)
    ON CONFLICT(run_id,language) DO UPDATE SET allocated_through=caption_channel_sequences.allocated_through+1 RETURNING allocated_through INTO seq;
    INSERT INTO caption_outbox_events(event_id,run_id,language,idempotency_key,payload)
    VALUES(v.event_id,p_run_id,lang,'status:'||p_action||':'||v.mode_generation::text||':'||lang,
      jsonb_build_object('schemaVersion',1,'type','caption.batch','eventId',v.event_id,'runId',v.id,
        'modeGeneration',v.mode_generation,'channelEpoch',v.channel_epoch,'messageSeq',seq,'language',lang,
        'status',v.state,'updates','[]'::jsonb,'_fencingToken',v.fencing_token))
    ON CONFLICT(run_id,language,idempotency_key) DO UPDATE SET payload=EXCLUDED.payload
    RETURNING id INTO outbox_id;
    outbox_ids := outbox_ids || jsonb_build_array(outbox_id);
  END LOOP;
  RETURN jsonb_build_object('run_id',v.id,'event_id',v.event_id,'state',v.state,'mode_generation',v.mode_generation,'channel_epoch',v.channel_epoch,'fencing_token',v.fencing_token,'delivery_outbox_ids',outbox_ids);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_create_invite(p_event_id uuid, p_expires_at timestamptz, p_max_uses integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE raw_token text; v_id uuid;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  raw_token := encode(gen_random_bytes(32),'base64');
  INSERT INTO caption_invites(event_id,token_hash,expires_at,max_uses,created_by)
  VALUES(p_event_id,digest(raw_token,'sha256'),p_expires_at,p_max_uses,auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('invite_id',v_id,'token',raw_token,'expires_at',p_expires_at,'max_uses',p_max_uses);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_redeem_invite(p_event_id uuid, p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v caption_invites; current_run uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM caption_invites WHERE event_id=p_event_id AND token_hash=digest(p_token,'sha256') FOR UPDATE;
  IF NOT FOUND OR NOT v.active OR v.expires_at<=now() OR v.use_count>=v.max_uses THEN
    RAISE EXCEPTION 'invite unavailable' USING ERRCODE='22023';
  END IF;
  INSERT INTO caption_event_members(event_id,user_id,role,expires_at)
  VALUES(p_event_id,auth.uid(),'guest',v.expires_at)
  ON CONFLICT(event_id,user_id) DO UPDATE SET expires_at=GREATEST(caption_event_members.expires_at,EXCLUDED.expires_at);
  UPDATE caption_invites SET use_count=use_count+1 WHERE id=v.id;
  SELECT current_run_id INTO current_run FROM caption_events WHERE id=p_event_id;
  RETURN jsonb_build_object('event_id',p_event_id,'run_id',current_run,'role','guest','expires_at',v.expires_at);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_issue_uplink_ticket(p_run_id uuid, p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v caption_runs; raw_token text; v_exp timestamptz := now()+interval '90 seconds';
BEGIN
  SELECT * INTO v FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(v.event_id);
  IF v.state NOT IN ('live','degraded') THEN RAISE EXCEPTION 'run is not accepting audio' USING ERRCODE='22023'; END IF;
  raw_token := encode(gen_random_bytes(32),'base64');
  UPDATE caption_runs SET publisher_id=auth.uid(),fencing_token=fencing_token+1,channel_epoch=gen_random_uuid(),lease_expires_at=v_exp WHERE id=p_run_id RETURNING * INTO v;
  DELETE FROM caption_channel_sequences WHERE run_id=p_run_id;
  INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through)
    VALUES(p_run_id,'en',0,0),(p_run_id,'ja',0,0),(p_run_id,'zh-CN',0,0);
  INSERT INTO caption_uplink_tickets(run_id,user_id,mode_generation,fencing_token,token_hash,allowed_origin,expires_at)
  VALUES(p_run_id,COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'),v.mode_generation,v.fencing_token,digest(raw_token,'sha256'),p_origin,v_exp);
  RETURN jsonb_build_object('token',raw_token,'expires_at',v_exp,'run_id',v.id,'event_id',v.event_id,'mode_generation',v.mode_generation,'fencing_token',v.fencing_token,'channel_epoch',v.channel_epoch);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_consume_uplink_ticket(p_token text, p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE t caption_uplink_tickets; r caption_runs;
BEGIN
  SELECT * INTO t FROM caption_uplink_tickets WHERE token_hash=digest(p_token,'sha256') FOR UPDATE;
  IF NOT FOUND OR t.used_at IS NOT NULL OR t.expires_at<=now() OR t.allowed_origin<>p_origin THEN
    RAISE EXCEPTION 'uplink ticket unavailable' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM caption_runs WHERE id=t.run_id FOR UPDATE;
  IF r.state NOT IN ('live','degraded') OR r.lease_expires_at<=now() OR r.publisher_id IS DISTINCT FROM t.user_id
     OR r.mode_generation<>t.mode_generation OR r.fencing_token<>t.fencing_token THEN
    RAISE EXCEPTION 'publisher lease unavailable' USING ERRCODE='40001';
  END IF;
  UPDATE caption_uplink_tickets SET used_at=now() WHERE id=t.id;
  RETURN jsonb_build_object('event_id',r.event_id,'run_id',r.id,'user_id',t.user_id,'mode_generation',t.mode_generation,'fencing_token',t.fencing_token,'channel_epoch',r.channel_epoch);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_assert_fence(p_run_id uuid,p_generation integer,p_fence bigint)
RETURNS caption_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs;
BEGIN
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  IF r.mode_generation<>p_generation OR r.fencing_token<>p_fence OR r.state NOT IN ('live','degraded')
     OR r.lease_expires_at IS NULL OR r.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'stale publisher generation or fence' USING ERRCODE='40001';
  END IF;
  RETURN r;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_renew_publisher_lease(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  UPDATE caption_runs SET lease_expires_at=now()+interval '90 seconds' WHERE id=p_run_id RETURNING * INTO r;
  RETURN jsonb_build_object('run_id',r.id,'mode_generation',r.mode_generation,'fencing_token',r.fencing_token,'lease_expires_at',r.lease_expires_at);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_reserve_segment_order(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; reserved bigint; sid uuid:=gen_random_uuid();
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  UPDATE caption_runs SET next_segment_order=next_segment_order+1 WHERE id=p_run_id
    RETURNING next_segment_order-1 INTO reserved;
  RETURN jsonb_build_object('run_id',p_run_id,'segment_order',reserved,'segment_id',sid);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_reserve_message_sequence_block(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint,p_size integer DEFAULT 128)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; lang text; finish bigint; ranges jsonb:='{}'::jsonb; safe_size integer;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  safe_size := LEAST(GREATEST(p_size,1),512);
  FOREACH lang IN ARRAY ARRAY['en','ja','zh-CN'] LOOP
    INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through) VALUES(p_run_id,lang,0,safe_size)
    ON CONFLICT(run_id,language) DO UPDATE SET allocated_through=caption_channel_sequences.allocated_through+safe_size
    RETURNING allocated_through INTO finish;
    ranges := ranges || jsonb_build_object(lang,jsonb_build_object('start',finish-safe_size+1,'end',finish));
  END LOOP;
  RETURN jsonb_build_object('run_id',p_run_id,'channel_epoch',r.channel_epoch,'ranges',ranges);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_checkpoint_source(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint,p_source_segment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; sid uuid; sord bigint; srev integer;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  sid := (p_source_segment->>'segmentId')::uuid; sord := (p_source_segment->>'segmentOrder')::bigint; srev := (p_source_segment->>'sourceRevision')::integer;
  INSERT INTO caption_source_segments(run_id,segment_id,segment_order,source_revision,text,status,capture_start_sample,capture_end_sample,provider_session_id,provider_item_id)
  VALUES(p_run_id,sid,sord,srev,p_source_segment->>'text',COALESCE(p_source_segment->>'status','final'),
    NULLIF(p_source_segment->>'captureStartSample','')::bigint,NULLIF(p_source_segment->>'captureEndSample','')::bigint,
    p_source_segment->>'providerSessionId',p_source_segment->>'providerItemId')
  ON CONFLICT(run_id,segment_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,text=EXCLUDED.text,status=EXCLUDED.status,
    capture_start_sample=EXCLUDED.capture_start_sample,capture_end_sample=EXCLUDED.capture_end_sample,
    provider_session_id=EXCLUDED.provider_session_id,provider_item_id=EXCLUDED.provider_item_id,updated_at=now()
  WHERE caption_source_segments.source_revision<=EXCLUDED.source_revision;
  RETURN jsonb_build_object('run_id',p_run_id,'segment_id',sid,'segment_order',sord,'source_revision',srev);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_checkpoint_draft(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint,p_segment jsonb,p_captions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; c jsonb; sid uuid; sord bigint; seq bigint; seqs jsonb:='{}'::jsonb; changed integer; allocated bigint;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  sid := (p_segment->>'segmentId')::uuid; sord := (p_segment->>'segmentOrder')::bigint;
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_captions,'[]'::jsonb)) LOOP
    INSERT INTO caption_draft_checkpoints(run_id,segment_id,segment_order,language,source_revision,caption_revision,text)
    VALUES(p_run_id,sid,sord,c->>'language',(c->>'sourceRevision')::integer,(c->>'captionRevision')::integer,c->>'text')
    ON CONFLICT(run_id,segment_id,language) DO UPDATE SET
      segment_order=EXCLUDED.segment_order,source_revision=EXCLUDED.source_revision,
      caption_revision=EXCLUDED.caption_revision,text=EXCLUDED.text,updated_at=now()
    WHERE caption_draft_checkpoints.source_revision<=EXCLUDED.source_revision
      AND caption_draft_checkpoints.caption_revision<=EXCLUDED.caption_revision
      AND (caption_draft_checkpoints.source_revision<EXCLUDED.source_revision OR caption_draft_checkpoints.caption_revision<EXCLUDED.caption_revision);
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed > 0 THEN
      seq := NULLIF(c->>'messageSeq','')::bigint;
      SELECT allocated_through INTO allocated FROM caption_channel_sequences WHERE run_id=p_run_id AND language=c->>'language' FOR UPDATE;
      IF seq IS NULL OR allocated IS NULL OR seq<1 OR seq>allocated THEN
        RAISE EXCEPTION 'draft sequence was not reserved' USING ERRCODE='40001';
      END IF;
      UPDATE caption_channel_sequences SET message_seq=GREATEST(message_seq,seq)
        WHERE run_id=p_run_id AND language=c->>'language';
      seqs := seqs || jsonb_build_object(c->>'language',seq);
    END IF;
    DELETE FROM caption_draft_checkpoints d WHERE d.run_id=p_run_id AND d.language=c->>'language'
      AND d.segment_id NOT IN (SELECT x.segment_id FROM caption_draft_checkpoints x WHERE x.run_id=p_run_id AND x.language=c->>'language' ORDER BY x.segment_order DESC LIMIT 2);
  END LOOP;
  RETURN jsonb_build_object('run_id',p_run_id,'checkpointed',jsonb_array_length(COALESCE(p_captions,'[]'::jsonb)),
    'message_sequences',seqs,'channel_epoch',r.channel_epoch,'mode_generation',r.mode_generation);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_persist_final_and_enqueue(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint,p_source_segment jsonb,p_captions jsonb,p_payloads jsonb,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; c jsonb; p jsonb; sid uuid; sord bigint; srev integer; seq bigint; seqs jsonb:='{}'::jsonb; idem text; allocated bigint;
  changed integer; accepted_languages text[]:='{}'::text[]; canonical_update jsonb; enqueued integer:=0;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  sid := (p_source_segment->>'segmentId')::uuid; sord := (p_source_segment->>'segmentOrder')::bigint; srev := (p_source_segment->>'sourceRevision')::integer;
  INSERT INTO caption_source_segments(run_id,segment_id,segment_order,source_revision,text,status,capture_start_sample,capture_end_sample,provider_session_id,provider_item_id)
  VALUES(p_run_id,sid,sord,srev,p_source_segment->>'text',COALESCE(p_source_segment->>'status','final'),
    NULLIF(p_source_segment->>'captureStartSample','')::bigint,NULLIF(p_source_segment->>'captureEndSample','')::bigint,
    p_source_segment->>'providerSessionId',p_source_segment->>'providerItemId')
  ON CONFLICT(run_id,segment_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,text=EXCLUDED.text,status=EXCLUDED.status,
    capture_start_sample=EXCLUDED.capture_start_sample,capture_end_sample=EXCLUDED.capture_end_sample,
    provider_session_id=EXCLUDED.provider_session_id,provider_item_id=EXCLUDED.provider_item_id,updated_at=now()
  WHERE caption_source_segments.source_revision<=EXCLUDED.source_revision;
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_captions,'[]'::jsonb)) LOOP
    INSERT INTO caption_captions(run_id,segment_id,language,text,status,caption_revision,source_revision,origin)
    VALUES(p_run_id,sid,c->>'language',c->>'text',COALESCE(c->>'status','final'),(c->>'captionRevision')::integer,(c->>'sourceRevision')::integer,COALESCE(c->>'origin','ai_live'))
    ON CONFLICT(run_id,segment_id,language) DO UPDATE SET text=EXCLUDED.text,status=EXCLUDED.status,
      caption_revision=CASE
        WHEN caption_captions.status='unavailable' AND EXCLUDED.status='final'
          AND caption_captions.source_revision=EXCLUDED.source_revision
        THEN GREATEST(caption_captions.caption_revision+1,EXCLUDED.caption_revision)
        ELSE EXCLUDED.caption_revision
      END,
      source_revision=EXCLUDED.source_revision,origin=EXCLUDED.origin,updated_at=now()
    WHERE caption_captions.source_revision<=EXCLUDED.source_revision
      AND caption_captions.caption_revision<=EXCLUDED.caption_revision AND caption_captions.status<>'corrected'
      AND NOT (caption_captions.status='final' AND EXCLUDED.status='unavailable'
        AND caption_captions.source_revision=EXCLUDED.source_revision);
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed>0 THEN accepted_languages := array_append(accepted_languages,c->>'language'); END IF;
  END LOOP;
  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(p_payloads,'[]'::jsonb)) LOOP
    idem := COALESCE(p->>'idempotencyKey',p_idempotency_key);
    SELECT (payload->>'messageSeq')::bigint INTO seq FROM caption_outbox_events
      WHERE run_id=p_run_id AND language=p->>'language' AND idempotency_key=idem;
    IF NOT FOUND AND array_position(accepted_languages,p->>'language') IS NOT NULL THEN
      SELECT jsonb_build_object('segmentId',cc.segment_id,'segmentOrder',ss.segment_order,
        'sourceRevision',cc.source_revision,'captionRevision',cc.caption_revision,'status',cc.status,
        'origin',cc.origin,'text',cc.text,'language',cc.language)
      INTO canonical_update FROM caption_captions cc JOIN caption_source_segments ss USING(run_id,segment_id)
      WHERE cc.run_id=p_run_id AND cc.segment_id=sid AND cc.language=p->>'language';
      seq := NULLIF(p->'payload'->>'messageSeq','')::bigint;
      SELECT allocated_through INTO allocated FROM caption_channel_sequences WHERE run_id=p_run_id AND language=p->>'language' FOR UPDATE;
      IF seq IS NULL OR allocated IS NULL OR seq<1 OR seq>allocated THEN
        INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through) VALUES(p_run_id,p->>'language',0,1)
        ON CONFLICT(run_id,language) DO UPDATE SET allocated_through=caption_channel_sequences.allocated_through+1
        RETURNING allocated_through INTO seq;
      END IF;
      INSERT INTO caption_outbox_events(event_id,run_id,language,idempotency_key,payload)
      VALUES(r.event_id,p_run_id,p->>'language',idem,
        COALESCE(p->'payload','{}'::jsonb) || jsonb_build_object('schemaVersion',1,'type','caption.batch',
          'eventId',r.event_id,'runId',p_run_id,'language',p->>'language','messageSeq',seq,'channelEpoch',r.channel_epoch,
          'modeGeneration',r.mode_generation,'updates',jsonb_build_array(canonical_update)));
      enqueued := enqueued+1;
    END IF;
    IF seq IS NOT NULL THEN seqs := seqs || jsonb_build_object(p->>'language',seq); END IF;
    seq := NULL;
  END LOOP;
  DELETE FROM caption_draft_checkpoints WHERE run_id=p_run_id AND segment_id=sid;
  RETURN jsonb_build_object('event_id',r.event_id,'run_id',p_run_id,'segment_id',sid,'outbox_count',enqueued,
    'message_sequences',seqs,'channel_epoch',r.channel_epoch,'mode_generation',r.mode_generation);
END;
$fn$;

DROP FUNCTION IF EXISTS caption_claim_outbox(uuid,integer,text);
CREATE OR REPLACE FUNCTION caption_claim_outbox(p_run_id uuid,p_limit integer,p_worker_id text,p_mode_generation integer,p_fencing_token bigint)
RETURNS SETOF caption_outbox_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; o caption_outbox_events; seq bigint;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  FOR o IN SELECT * FROM caption_outbox_events WHERE run_id=p_run_id AND available_at<=now()
      AND (status IN ('pending','failed') OR (status='processing' AND locked_at<now()-interval '30 seconds'))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),100)
  LOOP
    IF o.payload ? 'status' AND (
      COALESCE((o.payload->>'modeGeneration')::integer,-1)<>r.mode_generation
      OR COALESCE(o.payload->>'status','')<>r.state
    ) THEN
      UPDATE caption_outbox_events SET status='sent',sent_at=now(),last_error_code='STALE_STATE_SKIPPED',
        locked_by=NULL,locked_at=NULL WHERE id=o.id;
      CONTINUE;
    END IF;
    IF COALESCE(o.payload->>'channelEpoch','')<>r.channel_epoch::text THEN
      INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through) VALUES(p_run_id,o.language,0,1)
      ON CONFLICT(run_id,language) DO UPDATE SET allocated_through=caption_channel_sequences.allocated_through+1
      RETURNING allocated_through INTO seq;
      o.payload := o.payload || jsonb_build_object('channelEpoch',r.channel_epoch,'modeGeneration',r.mode_generation,'messageSeq',seq);
    ELSE
      seq := (o.payload->>'messageSeq')::bigint;
    END IF;
    UPDATE caption_channel_sequences SET message_seq=GREATEST(message_seq,seq) WHERE run_id=p_run_id AND language=o.language;
    UPDATE caption_outbox_events SET status='processing',locked_by=p_worker_id,locked_at=now(),attempts=attempts+1,payload=o.payload
      WHERE id=o.id RETURNING * INTO o;
    RETURN NEXT o;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_complete_outbox(p_outbox_id uuid,p_worker_id text,p_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE o caption_outbox_events;
BEGIN
  UPDATE caption_outbox_events SET status=CASE WHEN p_error_code IS NULL THEN 'sent' ELSE 'failed' END,
    sent_at=CASE WHEN p_error_code IS NULL THEN now() ELSE NULL END,last_error_code=p_error_code,
    available_at=CASE WHEN p_error_code IS NULL THEN available_at ELSE now()+make_interval(secs=>LEAST(60,attempts*2)) END,
    locked_by=NULL,locked_at=NULL WHERE id=p_outbox_id AND status='processing' AND locked_by=p_worker_id RETURNING * INTO o;
  IF NOT FOUND THEN RAISE EXCEPTION 'outbox claim not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('outbox_id',o.id,'status',o.status,'attempts',o.attempts);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_claim_http_outbox(p_outbox_ids uuid[],p_worker_id text)
RETURNS SETOF caption_outbox_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE o caption_outbox_events; r caption_runs; seq bigint;
BEGIN
  FOR o IN SELECT * FROM caption_outbox_events
    WHERE id=ANY(COALESCE(p_outbox_ids,'{}'::uuid[])) AND status IN ('pending','failed') AND available_at<=now()
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 6
  LOOP
    SELECT * INTO r FROM caption_runs WHERE id=o.run_id;
    IF r.id IS NULL OR (o.payload->>'modeGeneration')::integer<>r.mode_generation
       OR COALESCE(o.payload->>'channelEpoch','')<>r.channel_epoch::text
       OR COALESCE((o.payload->>'_fencingToken')::bigint,-1)<>r.fencing_token THEN
      CONTINUE;
    END IF;
    seq := (o.payload->>'messageSeq')::bigint;
    UPDATE caption_channel_sequences SET message_seq=GREATEST(message_seq,seq)
      WHERE run_id=o.run_id AND language=o.language;
    UPDATE caption_outbox_events SET status='processing',locked_by=p_worker_id,locked_at=now(),attempts=attempts+1
      WHERE id=o.id RETURNING * INTO o;
    RETURN NEXT o;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_validate_http_outbox(p_outbox_id uuid,p_worker_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE o caption_outbox_events; r caption_runs; valid boolean;
BEGIN
  SELECT * INTO o FROM caption_outbox_events WHERE id=p_outbox_id AND status='processing' AND locked_by=p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO r FROM caption_runs WHERE id=o.run_id;
  valid := r.id IS NOT NULL AND (o.payload->>'modeGeneration')::integer=r.mode_generation
    AND COALESCE(o.payload->>'channelEpoch','')=r.channel_epoch::text
    AND COALESCE((o.payload->>'_fencingToken')::bigint,-1)=r.fencing_token;
  IF NOT valid THEN
    UPDATE caption_outbox_events SET status='pending',locked_by=NULL,locked_at=NULL WHERE id=o.id;
  END IF;
  RETURN valid;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_run_state(p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT jsonb_build_object('run_id',id,'event_id',event_id,'state',state,'mode',mode,'mode_generation',mode_generation,'channel_epoch',channel_epoch,'message_seq',message_seq,'fencing_token',fencing_token,'lease_expires_at',lease_expires_at)
  FROM caption_runs WHERE id=p_run_id;
$fn$;

CREATE OR REPLACE FUNCTION caption_runtime_context(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; scripts jsonb; glossary jsonb; recent jsonb; sequences jsonb;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'sequence',sequence,'text',left(content,4000)) ORDER BY sequence,updated_at),'[]'::jsonb)
    INTO scripts FROM (SELECT * FROM caption_scripts WHERE event_id=r.event_id AND active ORDER BY sequence,updated_at LIMIT 50) q;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceTerm',source_term,'aliases',aliases,'en',en,'ja',ja,'zh-CN',"zh-CN",'priority',priority,'revision',revision) ORDER BY priority DESC,source_term),'[]'::jsonb)
    INTO glossary FROM (SELECT * FROM caption_glossary_entries WHERE event_id=r.event_id ORDER BY priority DESC,source_term LIMIT 100) q;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('segmentId',segment_id,'segmentOrder',segment_order,'sourceRevision',source_revision,'text',text,'status',status,'providerItemId',provider_item_id) ORDER BY segment_order),'[]'::jsonb)
    INTO recent FROM (SELECT * FROM caption_source_segments WHERE run_id=p_run_id ORDER BY segment_order DESC LIMIT 20) q;
  SELECT COALESCE(jsonb_object_agg(language,message_seq),'{}'::jsonb) INTO sequences FROM caption_channel_sequences WHERE run_id=p_run_id;
  RETURN jsonb_build_object('runId',r.id,'modeGeneration',r.mode_generation,'scripts',scripts,'glossary',glossary,'recentSources',recent,'messageSeqByLanguage',sequences);
END;
$fn$;

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
      'captionRevision',c.caption_revision,'status',c.status,'origin',c.origin,'text',c.text,'language',c.language) x
    FROM caption_captions c JOIN caption_source_segments s USING(run_id,segment_id)
    WHERE c.run_id=p_run_id AND c.language=p_language ORDER BY s.segment_order DESC LIMIT 50
  ) q;
  SELECT updates || COALESCE(jsonb_agg(jsonb_build_object('segmentId',segment_id,'segmentOrder',segment_order,'sourceRevision',source_revision,
    'captionRevision',caption_revision,'status','draft','origin','ai_live','text',text,'language',language) ORDER BY segment_order),'[]'::jsonb)
  INTO updates FROM caption_draft_checkpoints WHERE run_id=p_run_id AND language=p_language;
  RETURN jsonb_build_object('eventId',p_event_id,'runId',r.id,'currentRunId',current_run,'modeGeneration',r.mode_generation,'channelEpoch',r.channel_epoch,
    'messageSeq',COALESCE((SELECT message_seq FROM caption_channel_sequences WHERE run_id=p_run_id AND language=p_language),0),
    'status',CASE WHEN r.state='live' AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=now()) THEN 'disconnected' ELSE r.state END,
    'language',p_language,'topic','caption:'||p_event_id::text||':'||p_language,'updates',COALESCE(updates,'[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_recover_pending(p_run_id uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $fn$
  SELECT jsonb_build_object('outbox',COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM (SELECT * FROM caption_outbox_events WHERE run_id=p_run_id AND status<>'sent' ORDER BY created_at LIMIT LEAST(GREATEST(p_limit,1),500)) o),'[]'::jsonb),
    'drafts',COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (SELECT * FROM caption_draft_checkpoints WHERE run_id=p_run_id ORDER BY segment_order) d),'[]'::jsonb),
    'finalSources',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
      SELECT src.* FROM caption_source_segments src JOIN caption_runs r ON r.id=src.run_id JOIN caption_events e ON e.id=r.event_id
      WHERE src.run_id=p_run_id AND src.status IN ('final','corrected') AND EXISTS(
        SELECT 1 FROM unnest(e.target_languages) lang WHERE NOT EXISTS(
          SELECT 1 FROM caption_captions c WHERE c.run_id=src.run_id AND c.segment_id=src.segment_id AND c.language=lang AND c.source_revision=src.source_revision AND c.status IN ('final','corrected')
        )
      ) ORDER BY src.segment_order LIMIT LEAST(GREATEST(p_limit,1),500)
    ) s),'[]'::jsonb));
$fn$;

CREATE OR REPLACE FUNCTION caption_record_operational_event(p_run_id uuid,p_type text,p_details_safe jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_event uuid; v_id bigint;
BEGIN
  SELECT event_id INTO v_event FROM caption_runs WHERE id=p_run_id;
  INSERT INTO caption_operational_events(event_id,run_id,type,details_safe) VALUES(v_event,p_run_id,p_type,COALESCE(p_details_safe,'{}')) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_manual_publish(p_run_id uuid,p_language text,p_text text,p_segment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs; sid uuid:=COALESCE(p_segment_id,gen_random_uuid()); seg_order bigint; source_rev integer; caption_rev integer; seq bigint; outbox_id uuid;
BEGIN
  SELECT * INTO r FROM caption_runs WHERE id=p_run_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'run not found' USING ERRCODE='P0002'; END IF;
  PERFORM caption_require_operator(r.event_id);
  SELECT segment_order,source_revision INTO seg_order,source_rev FROM caption_source_segments WHERE run_id=p_run_id AND segment_id=sid FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE caption_runs SET next_segment_order=next_segment_order+1 WHERE id=p_run_id RETURNING next_segment_order-1 INTO seg_order;
    source_rev := 1;
    INSERT INTO caption_source_segments(run_id,segment_id,segment_order,source_revision,text,status)
      VALUES(p_run_id,sid,seg_order,source_rev,'','final');
  END IF;
  SELECT caption_revision+1 INTO caption_rev FROM caption_captions WHERE run_id=p_run_id AND segment_id=sid AND language=p_language;
  caption_rev := COALESCE(caption_rev,1);
  INSERT INTO caption_captions(run_id,segment_id,language,text,status,caption_revision,source_revision,origin)
  VALUES(p_run_id,sid,p_language,p_text,'corrected',caption_rev,source_rev,'manual')
  ON CONFLICT(run_id,segment_id,language) DO UPDATE SET text=EXCLUDED.text,status='corrected',caption_revision=caption_captions.caption_revision+1,
    source_revision=EXCLUDED.source_revision,origin='manual',updated_at=now();
  SELECT caption_revision,source_revision INTO caption_rev,source_rev FROM caption_captions WHERE run_id=p_run_id AND segment_id=sid AND language=p_language;
  INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through) VALUES(p_run_id,p_language,0,1)
  ON CONFLICT(run_id,language) DO UPDATE SET allocated_through=caption_channel_sequences.allocated_through+1 RETURNING allocated_through INTO seq;
  INSERT INTO caption_outbox_events(event_id,run_id,language,idempotency_key,payload)
  VALUES(r.event_id,p_run_id,p_language,'manual:'||sid::text||':'||caption_rev,jsonb_build_object(
    'schemaVersion',1,'type','caption.batch','eventId',r.event_id,'runId',r.id,'modeGeneration',r.mode_generation,
    'channelEpoch',r.channel_epoch,'messageSeq',seq,'language',p_language,
    'updates',jsonb_build_array(jsonb_build_object('segmentId',sid,'segmentOrder',seg_order,
      'sourceRevision',source_rev,'captionRevision',caption_rev,'status','corrected','origin','manual','text',p_text,'language',p_language)),
    '_fencingToken',r.fencing_token)) RETURNING id INTO outbox_id;
  RETURN jsonb_build_object('segment_id',sid,'segment_order',seg_order,'source_revision',source_rev,'caption_revision',caption_rev,'message_seq',seq,'delivery_outbox_ids',jsonb_build_array(outbox_id));
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_review_suggestion(p_review_id uuid,p_decision text,p_corrected_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v caption_script_reviews; r caption_runs;
BEGIN
  SELECT * INTO v FROM caption_script_reviews WHERE id=p_review_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'review not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO r FROM caption_runs WHERE id=v.run_id; PERFORM caption_require_operator(r.event_id);
  IF p_decision NOT IN ('accepted','rejected','uncertain') THEN RAISE EXCEPTION 'invalid review decision' USING ERRCODE='22023'; END IF;
  IF p_decision='accepted' AND nullif(trim(COALESCE(p_corrected_text,v.proposed_text)), '') IS NULL THEN
    RAISE EXCEPTION 'accepted review requires corrected text' USING ERRCODE='22023';
  END IF;
  UPDATE caption_script_reviews SET decision=p_decision,decided_by=auth.uid(),decided_at=now(),proposed_text=COALESCE(p_corrected_text,proposed_text) WHERE id=p_review_id RETURNING * INTO v;
  RETURN jsonb_build_object('review_id',v.id,'decision',v.decision,'proposed_text',v.proposed_text);
END;
$fn$;

DROP FUNCTION IF EXISTS caption_record_script_review(uuid,uuid,integer,text,text,uuid);
CREATE OR REPLACE FUNCTION caption_record_script_review(p_run_id uuid,p_segment_id uuid,p_segment_order bigint,p_source_revision integer,p_original_text text,p_proposed_text text,p_matched_script_id uuid DEFAULT NULL,p_provider_item_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v caption_script_reviews;
BEGIN
  INSERT INTO caption_script_reviews(run_id,segment_id,segment_order,source_revision,original_text,proposed_text,matched_script_id,provider_item_id)
  VALUES(p_run_id,p_segment_id,p_segment_order,p_source_revision,p_original_text,p_proposed_text,p_matched_script_id,p_provider_item_id)
  ON CONFLICT(run_id,segment_id,source_revision) DO UPDATE SET
    proposed_text=CASE WHEN caption_script_reviews.decision='pending' THEN EXCLUDED.proposed_text ELSE caption_script_reviews.proposed_text END,
    matched_script_id=CASE WHEN caption_script_reviews.decision='pending' THEN EXCLUDED.matched_script_id ELSE caption_script_reviews.matched_script_id END,
    segment_order=EXCLUDED.segment_order,provider_item_id=EXCLUDED.provider_item_id
  RETURNING * INTO v;
  RETURN jsonb_build_object('review_id',v.id,'decision',v.decision,'segment_id',v.segment_id,'source_revision',v.source_revision);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_claim_approved_reviews(p_run_id uuid,p_mode_generation integer,p_fencing_token bigint,p_worker_id text,p_limit integer DEFAULT 10)
RETURNS SETOF caption_script_reviews LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE r caption_runs;
BEGIN
  r := caption_assert_fence(p_run_id,p_mode_generation,p_fencing_token);
  RETURN QUERY WITH picked AS (
    SELECT id FROM caption_script_reviews WHERE run_id=p_run_id AND decision='accepted' AND applied_at IS NULL
      AND (claimed_at IS NULL OR claimed_at<now()-interval '30 seconds')
    ORDER BY decided_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),50)
  ) UPDATE caption_script_reviews v SET claimed_by=p_worker_id,claimed_at=now(),apply_error_code=NULL
    FROM picked WHERE v.id=picked.id RETURNING v.*;
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_complete_approved_review(p_review_id uuid,p_worker_id text,p_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v caption_script_reviews;
BEGIN
  UPDATE caption_script_reviews SET applied_at=CASE WHEN p_error_code IS NULL THEN now() ELSE NULL END,
    apply_error_code=p_error_code,claimed_by=NULL,claimed_at=NULL
  WHERE id=p_review_id AND claimed_by=p_worker_id AND decision='accepted' RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'review claim not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('review_id',v.id,'applied',v.applied_at IS NOT NULL,'error_code',v.apply_error_code);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_upsert_glossary(p_event_id uuid,p_entry jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v caption_glossary_entries;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  INSERT INTO caption_glossary_entries(event_id,source_term,aliases,en,ja,"zh-CN",pronunciation_note,priority,updated_by)
  VALUES(p_event_id,p_entry->>'sourceTerm',ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_entry->'aliases','[]'))),p_entry->>'en',p_entry->>'ja',p_entry->>'zh-CN',p_entry->>'pronunciationNote',COALESCE((p_entry->>'priority')::integer,0),auth.uid())
  ON CONFLICT(event_id,source_term) DO UPDATE SET aliases=EXCLUDED.aliases,en=EXCLUDED.en,ja=EXCLUDED.ja,"zh-CN"=EXCLUDED."zh-CN",pronunciation_note=EXCLUDED.pronunciation_note,priority=EXCLUDED.priority,revision=caption_glossary_entries.revision+1,updated_by=auth.uid(),updated_at=now() RETURNING * INTO v;
  RETURN jsonb_build_object('id',v.id,'revision',v.revision,'source_term',v.source_term);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_upsert_script(p_event_id uuid,p_script jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v caption_scripts;
BEGIN
  PERFORM caption_require_operator(p_event_id);
  IF p_script ? 'id' THEN
    UPDATE caption_scripts SET title=p_script->>'title',content=p_script->>'content',sequence=COALESCE((p_script->>'sequence')::integer,sequence),active=COALESCE((p_script->>'active')::boolean,true),revision=revision+1,updated_by=auth.uid(),updated_at=now()
    WHERE id=(p_script->>'id')::uuid AND event_id=p_event_id RETURNING * INTO v;
  ELSE
    INSERT INTO caption_scripts(event_id,title,content,sequence,active,updated_by) VALUES(p_event_id,p_script->>'title',p_script->>'content',COALESCE((p_script->>'sequence')::integer,0),COALESCE((p_script->>'active')::boolean,true),auth.uid()) RETURNING * INTO v;
  END IF;
  IF v.id IS NULL THEN RAISE EXCEPTION 'script not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v.id,'revision',v.revision,'active',v.active);
END;
$fn$;

CREATE OR REPLACE FUNCTION caption_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT jsonb_build_object('database','ok','open_runs',(SELECT count(*) FROM caption_runs WHERE state IN ('starting','live','paused','degraded')),'pending_outbox',(SELECT count(*) FROM caption_outbox_events WHERE status IN ('pending','failed')));
$fn$;

-- Realtime Authorization. These policies do not enable private channels at the
-- project level; that dashboard setting must be reviewed separately.
CREATE OR REPLACE FUNCTION caption_can_receive_topic(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT CASE
    WHEN p_topic LIKE 'caption:%:%' THEN EXISTS(SELECT 1 FROM caption_event_members m WHERE m.user_id=auth.uid() AND m.event_id::text=split_part(p_topic,':',2) AND (m.expires_at IS NULL OR m.expires_at>now())) OR is_admin()
    WHEN p_topic LIKE 'caption-admin:%' THEN is_admin() OR EXISTS(SELECT 1 FROM caption_event_members m WHERE m.user_id=auth.uid() AND m.event_id::text=split_part(p_topic,':',2) AND m.role IN ('operator','admin') AND (m.expires_at IS NULL OR m.expires_at>now()))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION caption_can_send_topic(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT p_topic LIKE 'caption-admin:%' AND (is_admin() OR EXISTS(SELECT 1 FROM caption_event_members m WHERE m.user_id=auth.uid() AND m.event_id::text=split_part(p_topic,':',2) AND m.role IN ('operator','admin') AND (m.expires_at IS NULL OR m.expires_at>now())));
$fn$;

DROP POLICY IF EXISTS "Caption receive authorized topics" ON realtime.messages;
CREATE POLICY "Caption receive authorized topics" ON realtime.messages FOR SELECT TO authenticated
USING (public.caption_can_receive_topic(realtime.topic()));
DROP POLICY IF EXISTS "Caption operators send admin topic" ON realtime.messages;
CREATE POLICY "Caption operators send admin topic" ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (public.caption_can_send_topic(realtime.topic()));

DO $do$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.proname,n.nspname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'caption_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',f.nspname,f.proname,f.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',f.nspname,f.proname,f.args);
  END LOOP;
END;
$do$;
GRANT EXECUTE ON FUNCTION caption_redeem_invite(uuid,text),caption_snapshot(uuid,uuid,text),caption_can_receive_topic(text),caption_can_send_topic(text),caption_issue_uplink_ticket(uuid,text) TO authenticated;
