-- ============================================================
-- Export the CURRENT guests table as a ready-to-paste VALUES block.
--
-- Use this after editing guests by hand in the Supabase Table Editor,
-- so schema_seed.sql matches reality. Without it, the next full run of
-- schema_seed.sql will overwrite your manual edits to name / group_name
-- / side / invited / is_kid with the older values still in the file.
--
-- Run in the SQL Editor, copy the single text result, and paste it over
-- the VALUES block in supabase/schema_seed.sql (between "VALUES" and
-- "ON CONFLICT").
--
-- Read-only — changes nothing.
-- ============================================================

SELECT string_agg(row_sql, E',\n' ORDER BY guest_number) AS values_block
FROM (
  SELECT
    guest_number,
    format(
      '  (%s, %L, %L, %L, %L, %L, NULLIF(%L,''''), %s, NULL)',
      guest_number,
      name,
      COALESCE(group_name, ''),
      COALESCE(side, ''),
      COALESCE(invited, 'Pending'),
      COALESCE(rsvp_status, 'Pending'),
      COALESCE(dietary, ''),
      CASE WHEN is_kid THEN 'TRUE' ELSE 'FALSE' END
    ) AS row_sql
  FROM guests
  WHERE guest_number IS NOT NULL      -- skips the [PREVIEW] admin rows
) t;


-- Sanity checks worth running alongside it:

-- Guests you added by hand with no guest_number — the seed cannot manage
-- these, and they will be invisible to any roster re-run. Give them a
-- number with:  UPDATE guests SET guest_number = next_guest_number() WHERE id = '...';
SELECT id, name, group_name, invitation_code
FROM guests
WHERE guest_number IS NULL
  AND COALESCE(group_name, '') <> 'Admin Preview';

-- Guests with no invitation code (they cannot be sent a personal link).
SELECT guest_number, name FROM guests WHERE invitation_code IS NULL;

-- Duplicate guest_numbers left over from an old double-seed.
SELECT guest_number, count(*)
FROM guests
WHERE guest_number IS NOT NULL
GROUP BY guest_number HAVING count(*) > 1;
