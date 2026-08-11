-- ============================================================
-- Migration · 2026-08-11 · Seating privacy
--
-- Run this ALONE in the Supabase SQL Editor to enable the
-- "guests see only their own table" behaviour.
--
-- It touches FUNCTIONS ONLY. It does not read, write, add or remove a
-- single guest row, so any manual edits you have made in the guests
-- table are completely unaffected.
--
-- Safe to run more than once.
-- ============================================================

-- 19. lookup_my_table(code) → returns the occupants of ONLY the table(s) the
--     caller's own invitation is seated at. Used by the floor-plan modal so a
--     guest can see who they're sitting with, without seeing any other table.
--
--     Replaces the earlier lookup_all_table_assignments(), which returned the
--     whole room to any valid code holder. That function is dropped below —
--     leaving it in place would keep the full guest list readable by anyone
--     holding a single invitation code.
--
--     Validates that the supplied code exists (i.e. the caller is one of our
--     invited guests) before returning anything. Excludes guests who have
--     RSVP'd 'No' so the chart doesn't show absences.
DROP FUNCTION IF EXISTS lookup_all_table_assignments(TEXT);

CREATE OR REPLACE FUNCTION lookup_my_table(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm     TEXT;
  is_valid BOOLEAN;
  my_tables INTEGER[];
  result   JSONB;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  norm := upper(trim(p_code));

  SELECT EXISTS (SELECT 1 FROM guests WHERE invitation_code = norm)
  INTO is_valid;

  IF NOT is_valid THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  -- The table(s) this invitation is seated at. Normally one, but a household
  -- split across two tables gets both.
  SELECT COALESCE(array_agg(DISTINCT g.table_number), '{}'::INTEGER[])
  INTO my_tables
  FROM guests g
  WHERE g.invitation_code = norm
    AND g.table_number IS NOT NULL;

  IF array_length(my_tables, 1) IS NULL THEN
    -- Seats not assigned yet: valid code, nothing to reveal.
    RETURN jsonb_build_object('valid', true, 'tables', '{}'::jsonb, 'my_tables', '[]'::jsonb);
  END IF;

  SELECT jsonb_object_agg(table_number::text, members)
  INTO result
  FROM (
    SELECT
      g.table_number,
      jsonb_agg(
        jsonb_build_object(
          'name', g.name,
          'seat', g.seat_number
        )
        ORDER BY g.seat_number NULLS LAST
      ) AS members
    FROM guests g
    WHERE g.table_number = ANY(my_tables)
      AND COALESCE(g.rsvp_status, '') NOT IN ('No', 'no')
    GROUP BY g.table_number
  ) t;

  RETURN jsonb_build_object(
    'valid',     true,
    'tables',    COALESCE(result, '{}'::jsonb),
    'my_tables', to_jsonb(my_tables)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_my_table(TEXT) TO anon, authenticated;
