-- ============================================================
-- RSVP data-consistency audit — read-only, safe to run anytime
-- ============================================================
-- Run as Christy or Mitchell (the is_admin() allowlist) in the
-- Supabase SQL editor. Nothing here writes; every statement is a
-- SELECT. Run them one block at a time and read the notes.
--
-- Background: admin_rsvps is a VIEW over rsvp (LEFT JOIN guests),
-- not a second table. A submission is never "added to both lists" —
-- it is written to rsvp once, and admin_rsvps renders it. The checks
-- below look for rows where that rendering LOSES information, plus
-- the places where rsvp and guests genuinely diverge.
-- ============================================================


-- 1. Row parity. These two numbers MUST match.
--    A LEFT JOIN cannot drop rows from rsvp, so any mismatch means
--    something is very wrong (duplicate guests rows fanning out the join).
SELECT
  (SELECT COUNT(*) FROM rsvp)        AS rsvp_rows,
  (SELECT COUNT(*) FROM admin_rsvps) AS admin_rsvps_rows;


-- 2. Orphan RSVPs — the main way data goes "missing" in admin_rsvps.
--    These rows DO appear in the view, but guest_name, side, group_name,
--    table_number, seat_number and invitation_code all render as NULL,
--    so they read as blank lines. Anything submitted before guest_id
--    existed, or inserted by hand, lands here.
SELECT r.id, r.name AS name_on_rsvp, r.email, r.phone,
       r.invitation_code AS code_on_rsvp, r.attendance, r.submitted_at,
       CASE WHEN r.guest_id IS NULL THEN 'no guest_id'
            ELSE 'guest_id points at a deleted guest' END AS reason
FROM rsvp r
WHERE r.guest_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM guests g WHERE g.id = r.guest_id)
ORDER BY r.submitted_at DESC;


-- 3. Name / code drift between the two tables.
--    admin_rsvps shows guests.name and guests.invitation_code, NOT the
--    values stored on the rsvp row. If these ever disagree, the view is
--    showing you the guests-table version and hiding the rsvp version.
SELECT r.id, r.name AS name_on_rsvp, g.name AS name_shown_in_view,
       r.invitation_code AS code_on_rsvp, g.invitation_code AS code_shown_in_view
FROM rsvp r
JOIN guests g ON g.id = r.guest_id
WHERE LOWER(TRIM(COALESCE(r.name,'')))  IS DISTINCT FROM LOWER(TRIM(COALESCE(g.name,'')))
   OR UPPER(TRIM(COALESCE(r.invitation_code,''))) IS DISTINCT FROM UPPER(TRIM(COALESCE(g.invitation_code,'')));


-- 4. Duplicate replies for one guest.
--    submit_rsvp deletes by guest_id before inserting, so this should be
--    empty. A non-empty result means rows arrived by another path.
SELECT guest_id, COUNT(*) AS rows_for_this_guest
FROM rsvp
WHERE guest_id IS NOT NULL
GROUP BY guest_id
HAVING COUNT(*) > 1;


-- 5. guests says Yes/No but there is no reply on file.
--    Expected for anyone whose status was set from the spreadsheet
--    rather than through the website. These people are NOT in
--    admin_rsvps at all — this is the biggest "missing from one list".
SELECT g.guest_number, g.name, g.side, g.group_name,
       g.rsvp_status, g.invitation_code
FROM guests g
WHERE g.rsvp_status IN ('Yes','No')
  AND NOT EXISTS (SELECT 1 FROM rsvp r WHERE r.guest_id = g.id)
ORDER BY g.guest_number;


-- 6. The reverse: a reply on file, but guests.rsvp_status disagrees.
--    submit_rsvp keeps these in step, so a hit means the status was
--    edited afterwards (seating planner, outreach tool, or by hand).
SELECT g.guest_number, g.name, g.rsvp_status AS status_in_guests,
       r.attendance AS said_on_website, r.submitted_at
FROM rsvp r
JOIN guests g ON g.id = r.guest_id
WHERE g.rsvp_status IS DISTINCT FROM CASE WHEN r.attendance THEN 'Yes' ELSE 'No' END
ORDER BY r.submitted_at DESC;


-- 7. Phone numbers stranded on the rsvp row.
--    The form writes the WhatsApp number to rsvp.phone. submit_rsvp does
--    NOT copy it to guests.phone, and the outreach tool reads ONLY
--    guests.phone — so these numbers are invisible there.
SELECT g.guest_number, g.name, r.phone AS phone_guest_gave_us,
       g.phone AS phone_in_outreach_list, r.submitted_at
FROM rsvp r
JOIN guests g ON g.id = r.guest_id
WHERE COALESCE(NULLIF(TRIM(r.phone),''), '') <> ''
  AND COALESCE(NULLIF(TRIM(g.phone),''), '') IS DISTINCT FROM COALESCE(NULLIF(TRIM(r.phone),''), '')
ORDER BY r.submitted_at DESC;

-- 7b. One-line fix for the above, if you want the numbers carried across.
--     Review query 7 first — this overwrites guests.phone where it is blank.
-- UPDATE guests g SET phone = TRIM(r.phone)
-- FROM rsvp r
-- WHERE r.guest_id = g.id
--   AND COALESCE(NULLIF(TRIM(r.phone),''),'') <> ''
--   AND COALESCE(NULLIF(TRIM(g.phone),''),'') = '';


-- 8. Plus-ones named on a reply who are not yet guests.
--    By design they live only on the rsvp row until you add them, so they
--    are in NOBODY's headcount. This is the same as pending_plus_ones.
SELECT * FROM pending_plus_ones ORDER BY submitted_at DESC;


-- 9. Dietary notes that never made it onto the guest record.
--    submit_rsvp uses COALESCE(NULLIF(...)), so a note can be added but
--    never cleared — and it is skipped entirely when a guest declines.
SELECT g.guest_number, g.name, r.dietary AS dietary_on_reply,
       g.dietary AS dietary_on_guest, r.attendance
FROM rsvp r
JOIN guests g ON g.id = r.guest_id
WHERE COALESCE(NULLIF(TRIM(r.dietary),''),'')
      IS DISTINCT FROM COALESCE(NULLIF(TRIM(g.dietary),''),'')
ORDER BY g.guest_number;


-- 10. Replies missing contact details entirely.
SELECT g.guest_number, g.name, r.email, r.phone, r.submitted_at
FROM rsvp r
LEFT JOIN guests g ON g.id = r.guest_id
WHERE COALESCE(NULLIF(TRIM(r.email),''),'') = ''
  AND COALESCE(NULLIF(TRIM(r.phone),''),'') = ''
ORDER BY r.submitted_at DESC;


-- 11. outreach_status = 'Responded' is a dead state.
--     mark_household_sent() protects it, but nothing ever SETS it —
--     submit_rsvp updates rsvp_status only. Expect 0 rows.
SELECT outreach_status, COUNT(*) FROM guests GROUP BY outreach_status;


-- 12. Headline numbers, for a quick sanity read against the tracker.
SELECT
  (SELECT COUNT(*) FROM guests)                                AS guests_total,
  (SELECT COUNT(*) FROM guests WHERE rsvp_status = 'Yes')      AS guests_yes,
  (SELECT COUNT(*) FROM guests WHERE rsvp_status = 'No')       AS guests_no,
  (SELECT COUNT(*) FROM guests WHERE rsvp_status NOT IN ('Yes','No')
                                  OR rsvp_status IS NULL)      AS guests_pending,
  (SELECT COUNT(*) FROM rsvp)                                  AS website_replies,
  (SELECT COUNT(*) FROM rsvp WHERE attendance)                 AS website_replies_yes,
  (SELECT COUNT(*) FROM rsvp WHERE guest_id IS NULL)           AS website_replies_orphaned,
  (SELECT COUNT(*) FROM pending_plus_ones)                     AS plus_ones_not_yet_guests;
