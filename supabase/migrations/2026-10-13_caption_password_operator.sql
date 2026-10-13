-- Keep service-role uplink ticket ownership internally consistent for the
-- server-authenticated caption operator. The original function wrote a NULL
-- publisher_id but a zero-UUID ticket user when auth.uid() was absent, so the
-- matching consume function correctly rejected that ticket as a takeover.

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
  IF v.state NOT IN ('live','degraded') THEN RAISE EXCEPTION 'run is not accepting audio' USING ERRCODE='22023'; END IF;
  raw_token := encode(gen_random_bytes(32),'base64');
  UPDATE caption_runs
  SET publisher_id=v_user_id,fencing_token=fencing_token+1,channel_epoch=gen_random_uuid(),lease_expires_at=v_exp
  WHERE id=p_run_id RETURNING * INTO v;
  DELETE FROM caption_channel_sequences WHERE run_id=p_run_id;
  INSERT INTO caption_channel_sequences(run_id,language,message_seq,allocated_through)
    VALUES(p_run_id,'en',0,0),(p_run_id,'ja',0,0),(p_run_id,'zh-CN',0,0);
  INSERT INTO caption_uplink_tickets(run_id,user_id,mode_generation,fencing_token,token_hash,allowed_origin,expires_at)
  VALUES(p_run_id,v_user_id,v.mode_generation,v.fencing_token,digest(raw_token,'sha256'),p_origin,v_exp);
  RETURN jsonb_build_object('token',raw_token,'expires_at',v_exp,'run_id',v.id,'event_id',v.event_id,
    'mode_generation',v.mode_generation,'fencing_token',v.fencing_token,'channel_epoch',v.channel_epoch);
END;
$fn$;

REVOKE ALL ON FUNCTION caption_issue_uplink_ticket(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION caption_issue_uplink_ticket(uuid,text) TO authenticated, service_role;
