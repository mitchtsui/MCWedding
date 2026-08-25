-- 2026-08-25 — Separate a real RSVP from a spreadsheet estimate.
--
-- guests.rsvp_status was seeded from the couple's planning spreadsheet
-- (156 Yes / 20 No / 22 Pending). Those were never replies — they were
-- the couple's expectation of who would come, recorded before a single
-- invitation went out. The outreach tool counted them as confirmed, so
-- its header read "156 Attending" while the true number was zero.
--
-- Per the couple: attendance is what the guest answered through their
-- invitation link. A reply the couple takes by WhatsApp or in person
-- counts too, but only once they record it deliberately.
--
-- So there are exactly three ways to read a guest's attendance:
--   1. a row in `rsvp`            -> the guest answered on the website
--   2. rsvp_confirmed_at is set   -> the couple recorded a reply by hand
--   3. neither                    -> No Reply, whatever rsvp_status says
--
-- This column is what makes (2) distinguishable from a leftover
-- spreadsheet value, since both live in rsvp_status. NOTHING is deleted:
-- the spreadsheet's Yes/No stays in rsvp_status and the outreach tool
-- still shows it as an "expected" hint. It simply stops counting as an
-- answer nobody actually gave.
--
-- submit_rsvp deliberately does NOT set this column — a website reply is
-- detected from the `rsvp` table itself, which keeps the two sources
-- cleanly separate.
--
-- Idempotent: safe to re-run.

ALTER TABLE guests ADD COLUMN IF NOT EXISTS rsvp_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN guests.rsvp_confirmed_at IS
  'Set when an admin records this guest''s answer by hand (WhatsApp, in person). NULL means rsvp_status is either a website reply mirrored by submit_rsvp, or an un-actioned spreadsheet estimate — check the rsvp table to tell which.';

DROP VIEW IF EXISTS outreach_list;
CREATE VIEW outreach_list AS
SELECT
  g.id, g.guest_number, g.name, g.group_name, g.side,
  g.invited, g.rsvp_status, g.rsvp_confirmed_at, g.invitation_code, g.phone,
  g.outreach_status, g.outreach_channel, g.outreach_sent_at, g.outreach_notes,
  CASE WHEN COUNT(*) OVER (PARTITION BY g.invitation_code) > 1
       THEN 'shared' ELSE 'solo' END AS code_type
FROM guests g;

GRANT SELECT ON outreach_list TO authenticated;

-- Who has actually answered, by which route. Read this, not rsvp_status.
CREATE OR REPLACE VIEW attendance_truth AS
SELECT
  guest_number, name, side, group_name,
  CASE
    WHEN web_wins        THEN CASE WHEN r_att THEN 'Yes' ELSE 'No' END
    WHEN manual_at IS NOT NULL AND rsvp_status IN ('Yes','No') THEN rsvp_status
    WHEN rid IS NOT NULL THEN CASE WHEN r_att THEN 'Yes' ELSE 'No' END
    ELSE 'Pending'
  END AS attendance,
  CASE
    WHEN web_wins        THEN 'website'
    WHEN manual_at IS NOT NULL AND rsvp_status IN ('Yes','No') THEN 'recorded by admin'
    WHEN rid IS NOT NULL THEN 'website'
    ELSE 'no reply'
  END AS answered_via,
  rsvp_status AS spreadsheet_estimate,
  CASE WHEN web_wins THEN r_at ELSE COALESCE(manual_at, r_at) END AS answered_at,
  outreach_status,
  invitation_code
FROM (
  SELECT
    g.guest_number, g.name, g.side, g.group_name, g.rsvp_status,
    g.outreach_status, g.invitation_code,
    g.rsvp_confirmed_at AS manual_at,
    r.id AS rid, r.attendance AS r_att, r.submitted_at AS r_at,
    -- The later answer wins. That is what lets an admin override a
    -- website reply, and equally lets a guest who replies afterwards
    -- have the last word. Mirrors attendanceOf() in whatsapp-outreach.html.
    (r.id IS NOT NULL
     AND (g.rsvp_confirmed_at IS NULL
          OR r.submitted_at IS NULL
          OR r.submitted_at >= g.rsvp_confirmed_at)) AS web_wins
  FROM guests g
  LEFT JOIN rsvp r ON r.guest_id = g.id
  WHERE g.group_name IS DISTINCT FROM 'Admin Preview'
) s
ORDER BY guest_number;

GRANT SELECT ON attendance_truth TO authenticated;

NOTIFY pgrst, 'reload schema';
