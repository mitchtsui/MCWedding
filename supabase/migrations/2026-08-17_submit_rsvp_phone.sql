-- 2026-08-17 — Applied to the live DB the same night (verified working).
--
-- Brings the live submit_rsvp up to the repo schema: the website started
-- sending p_phone on 2026-08-13, but the live function still had the old
-- 8-param signature, so EVERY submit failed with PGRST202 (function not
-- found) and guests saw "Something went wrong".
--
-- Applied in two steps because the dashboard SQL editor's statement
-- splitter choked on the original combined patch, committing the DROP of
-- the old 8-param overload but failing the CREATE — which left production
-- with NO submit_rsvp at all for a few minutes. Lesson recorded in
-- CLAUDE.md: paste function bodies into the dashboard with nothing
-- selected, no interleaved comments, and a named dollar tag.
--
-- Idempotent: safe to re-run.

ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS phone TEXT;

DROP FUNCTION IF EXISTS submit_rsvp(TEXT, UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION submit_rsvp(
  p_code TEXT, p_guest_id UUID, p_email TEXT, p_phone TEXT,
  p_attendance BOOLEAN, p_plus_one_name TEXT, p_dietary TEXT,
  p_song_request TEXT, p_message TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  guest_name TEXT;
  norm TEXT;
BEGIN
  norm := upper(trim(coalesce(p_code, '')));
  SELECT name INTO guest_name FROM guests
    WHERE id = p_guest_id AND invitation_code = norm;
  IF guest_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid guest or invitation code.');
  END IF;
  DELETE FROM rsvp WHERE guest_id = p_guest_id;
  INSERT INTO rsvp (guest_id, invitation_code, name, email, phone, attendance,
                    plus_one_name, dietary, song_request, message)
  VALUES (p_guest_id, norm, guest_name, p_email, p_phone, p_attendance,
          p_plus_one_name, p_dietary, p_song_request, p_message);
  UPDATE guests
    SET rsvp_status = CASE WHEN p_attendance THEN 'Yes' ELSE 'No' END,
        dietary = COALESCE(NULLIF(trim(p_dietary), ''), dietary)
    WHERE id = p_guest_id;
  RETURN jsonb_build_object('success', true);
END;
$fn$;

GRANT EXECUTE ON FUNCTION submit_rsvp(TEXT, UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;

DROP VIEW IF EXISTS admin_rsvps;
CREATE VIEW admin_rsvps AS
SELECT r.submitted_at, g.guest_number, g.name AS guest_name, g.side, g.group_name,
       r.attendance, r.email, r.phone, r.plus_one_name, r.dietary,
       r.song_request, r.message, g.table_number, g.seat_number, g.invitation_code
FROM rsvp r LEFT JOIN guests g ON g.id = r.guest_id
ORDER BY r.submitted_at DESC;

GRANT SELECT ON admin_rsvps TO authenticated;

NOTIFY pgrst, 'reload schema';
