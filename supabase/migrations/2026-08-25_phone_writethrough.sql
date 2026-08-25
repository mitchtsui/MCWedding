-- 2026-08-25 — Carry guest-supplied phone numbers into guests.phone
--
-- The RSVP form has collected a contact number into rsvp.phone since
-- 2026-08-13, but submit_rsvp never copied it onto the guest record —
-- and whatsapp-outreach.html reads ONLY guests.phone. Every number a
-- guest typed on the website was therefore invisible in the outreach
-- tool. This patches the leak at the database layer, so the outreach
-- tool needs no change.
--
-- Policy: NON-DESTRUCTIVE. A number already on the guest record wins;
-- the guest-supplied number only fills a blank. Where the two disagree
-- nothing is overwritten — the pair surfaces in the new phone_conflicts
-- view for the couple to judge. (Contrast dietary in the same function,
-- which does let the guest's value win; a wrong phone number costs more
-- than a wrong dietary note, and the couple's number is the one that
-- already successfully delivered the invitation.)
--
-- Signature is UNCHANGED from the 2026-08-17 9-param version, so this is
-- a plain CREATE OR REPLACE — no DROP, and therefore none of the
-- "production briefly had no submit_rsvp at all" risk from that night.
--
-- Idempotent: safe to re-run.

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
        dietary = COALESCE(NULLIF(trim(p_dietary), ''), dietary),
        phone   = COALESCE(NULLIF(trim(phone), ''), NULLIF(trim(p_phone), ''))
    WHERE id = p_guest_id;
  RETURN jsonb_build_object('success', true);
END;
$fn$;

GRANT EXECUTE ON FUNCTION submit_rsvp(TEXT, UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;


-- Numbers the guest gave us that differ from the one already on file.
-- Compared on the last 8 digits so formatting and a +852 country code do
-- not register as a disagreement (the outreach tool's waLink() strips
-- non-digits the same way). right(s, 8) returns the whole string when it
-- is shorter than 8, so short/overseas numbers still compare sanely.
CREATE OR REPLACE VIEW phone_conflicts AS
SELECT g.guest_number, g.name, g.side, g.group_name,
       g.phone AS phone_on_file,
       r.phone AS phone_guest_gave,
       r.submitted_at
FROM rsvp r
JOIN guests g ON g.id = r.guest_id
WHERE COALESCE(NULLIF(trim(r.phone), ''), '') <> ''
  AND COALESCE(NULLIF(trim(g.phone), ''), '') <> ''
  AND right(regexp_replace(g.phone, '[^0-9]', '', 'g'), 8)
      IS DISTINCT FROM
      right(regexp_replace(r.phone, '[^0-9]', '', 'g'), 8)
ORDER BY r.submitted_at DESC;

GRANT SELECT ON phone_conflicts TO authenticated;


-- Backfill: every number already sitting in rsvp.phone where the guest
-- record has none. Fills blanks only — overwrites nothing.
UPDATE guests g
   SET phone = trim(r.phone)
  FROM rsvp r
 WHERE r.guest_id = g.id
   AND COALESCE(NULLIF(trim(r.phone), ''), '') <> ''
   AND COALESCE(NULLIF(trim(g.phone), ''), '') = '';


-- OPTIONAL, run by hand only after reviewing phone_conflicts:
-- take the guest's number over the one already on file, for everyone.
--
-- UPDATE guests g
--    SET phone = trim(r.phone)
--   FROM rsvp r
--  WHERE r.guest_id = g.id
--    AND COALESCE(NULLIF(trim(r.phone), ''), '') <> '';

NOTIFY pgrst, 'reload schema';
