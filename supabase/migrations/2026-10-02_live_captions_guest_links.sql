-- Live captions: account-free guest links (QR code). Additive and idempotent.
-- Depends on 2026-10-02_live_captions.sql (caption_invites, caption_events, pgcrypto); apply after it.
-- Guests never call this directly: the caption API calls it with the service role, then serves the
-- snapshot and the signed public Broadcast topic. No Auth or Realtime setting changes.

CREATE OR REPLACE FUNCTION caption_guest_access(p_event_id uuid, p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v caption_invites; current_run uuid;
BEGIN
  -- Read-only on purpose: an account-free link has no identity to count, so use_count is not
  -- incremented and max_uses is not enforced here. Expiry and the active flag still are.
  SELECT * INTO v FROM caption_invites
  WHERE event_id=p_event_id AND token_hash=digest(p_token,'sha256') AND active AND expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'guest link unavailable' USING ERRCODE='28000'; END IF;
  SELECT current_run_id INTO current_run FROM caption_events WHERE id=p_event_id;
  RETURN jsonb_build_object('event_id',p_event_id,'run_id',current_run,'expires_at',v.expires_at);
END;
$fn$;

REVOKE ALL ON FUNCTION caption_guest_access(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION caption_guest_access(uuid,text) TO service_role;
