-- ============================================================
-- swap_tables(a, b) — exchange the guests seated at two tables
--
-- Everyone at table A moves to table B and everyone at table B moves to
-- table A, each keeping their seat number. If one table is empty this is
-- simply a move.
--
-- Run this file ONCE in the Supabase SQL Editor to install the function.
-- It only defines functions — it moves nobody on its own. The actual
-- swaps are the SELECT statements at the bottom, which you run when
-- you're ready.
--
-- Safe to re-run.
-- ============================================================

-- guests has a unique index on (table_number, seat_number), so a direct
-- A->B / B->A update collides the moment the first row lands on a seat the
-- other table still occupies. Park one side on a negative scratch number
-- first — no real table is negative — then bring it back. The whole thing
-- runs inside the function's transaction, so nothing else ever sees the
-- scratch value, and any failure rolls the swap back entirely.
CREATE OR REPLACE FUNCTION swap_tables(p_a INTEGER, p_b INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  moved INTEGER := 0;
  n     INTEGER;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_a IS NULL OR p_b IS NULL THEN
    RAISE EXCEPTION 'swap_tables: both table numbers are required';
  END IF;

  IF p_a = p_b THEN
    RAISE EXCEPTION 'swap_tables: table numbers must differ (both were %)', p_a;
  END IF;

  IF p_a <= 0 OR p_b <= 0 THEN
    RAISE EXCEPTION 'swap_tables: table numbers must be positive (got %, %)', p_a, p_b;
  END IF;

  UPDATE guests SET table_number = -p_a WHERE table_number = p_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved + n;

  UPDATE guests SET table_number = p_a WHERE table_number = p_b;
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved + n;

  UPDATE guests SET table_number = p_b WHERE table_number = -p_a;

  RETURN moved;
END;
$$;

GRANT EXECUTE ON FUNCTION swap_tables(INTEGER, INTEGER) TO authenticated;


-- A read-only look at who is where, for checking before and after.
CREATE OR REPLACE VIEW table_occupancy AS
SELECT
  g.table_number,
  count(*)                                  AS seated,
  string_agg(g.name, ', ' ORDER BY g.seat_number) AS guests
FROM guests g
WHERE g.table_number IS NOT NULL
GROUP BY g.table_number
ORDER BY g.table_number;

GRANT SELECT ON table_occupancy TO authenticated;


-- ============================================================
-- THE SWAPS
--
-- Look before you leap:
--     SELECT * FROM table_occupancy;
--
-- Then run all four together — they succeed or fail as one:
-- ============================================================

-- BEGIN;
--   SELECT swap_tables(1, 2);
--   SELECT swap_tables(3, 5);
--   SELECT swap_tables(6, 7);
--   SELECT swap_tables(9, 8);
-- COMMIT;

-- Then check the result:
--     SELECT * FROM table_occupancy;
--
-- These four are left/right mirror pairs on the floor plan, so running all
-- of them flips the top half of the room.
--
-- They stay commented out on purpose: this file is safe to re-run to
-- reinstall the function, and a swap left live here would silently undo
-- itself on the next run. Copy the block out to run it.
--
-- To undo a swap, run it again — swapping twice restores the original.
