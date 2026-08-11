-- ============================================================
-- Christy & Mitchell Wedding · Supabase Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. MASTER GUESTS TABLE (pre-seeded from verbal invites)
CREATE TABLE IF NOT EXISTS guests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_number    INTEGER,
  name            TEXT NOT NULL,
  group_name      TEXT,
  side            TEXT,          -- '男方' or '女方'
  invited         TEXT DEFAULT 'Pending',
  rsvp_status     TEXT DEFAULT 'Pending', -- Yes / No / Pending
  dietary         TEXT,
  is_kid          BOOLEAN DEFAULT FALSE,
  table_number    INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WEBSITE RSVP SUBMISSIONS (from invitation website form)
CREATE TABLE IF NOT EXISTS rsvp (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT,
  email           TEXT,
  attendance      BOOLEAN,
  plus_one_name   TEXT,
  dietary         TEXT,
  song_request    TEXT,
  message         TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Row Level Security
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvp   ENABLE ROW LEVEL SECURITY;

-- NOTE: these four are the Phase 1 policies. Phase 3 below drops them and
-- replaces them with the admin/service policies — "Public read guests" in
-- particular is NOT the final state (anon must not read the guest list).
-- Dropped first so the whole file can be re-run without erroring.
DROP POLICY IF EXISTS "Public read guests"   ON guests;
DROP POLICY IF EXISTS "Service write guests" ON guests;
DROP POLICY IF EXISTS "Public insert rsvp"   ON rsvp;
DROP POLICY IF EXISTS "Service manage rsvp"  ON rsvp;

-- Allow public read on guests (for seating display etc.)
CREATE POLICY "Public read guests"
  ON guests FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Service write guests"
  ON guests FOR ALL USING (auth.role() = 'service_role');

-- Allow anyone to INSERT rsvp (website form submissions)
CREATE POLICY "Public insert rsvp"
  ON rsvp FOR INSERT WITH CHECK (true);

-- Allow service role to read/manage rsvp
CREATE POLICY "Service manage rsvp"
  ON rsvp FOR ALL USING (auth.role() = 'service_role');

-- 4. Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guests_updated_at ON guests;
CREATE TRIGGER guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ------------------------------------------------------------
-- SEED: the master roster, keyed on guest_number.
--
-- guest_number is the stable identity for a guest — NOT name, which
-- genuinely repeats in this list (four separate 'Anthony Yip and Family'
-- rows, etc., each standing for one seat).
--
-- Re-running this file upserts the roster: it refreshes the roster columns
-- (name / group_name / side / invited / is_kid) and deliberately leaves the
-- live columns alone — rsvp_status, dietary, table_number, seat_number,
-- invitation_code and the outreach_* fields are owned by the website, the
-- seating planner and the WhatsApp tool, and must survive a re-seed.
--
-- To change the guest list: edit the VALUES below and re-run this file.
--   · add a guest    → append a row with the next unused guest_number
--   · rename/regroup → edit that guest_number's row in place
--   · remove a guest → see uninvite_guest() at the end of this file
-- ------------------------------------------------------------

-- Self-heal: an earlier version of this file had no unique key and used
-- ON CONFLICT DO NOTHING, so re-running it inserted a second copy of all
-- 198 guests. Collapse any such duplicates before the unique index goes on.
-- Keeps the richest row per guest_number (one with an RSVP, else a seat,
-- else the oldest) and re-points any rsvp rows at the survivor.
DO $$
DECLARE
  dupes INTEGER;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT guest_number FROM guests
    WHERE guest_number IS NOT NULL
    GROUP BY guest_number HAVING count(*) > 1
  ) d;

  IF dupes = 0 THEN RETURN; END IF;

  RAISE NOTICE 'Collapsing duplicate rows for % guest_number(s) from an earlier re-seed', dupes;

  CREATE TEMP TABLE _keep ON COMMIT DROP AS
  SELECT DISTINCT ON (g.guest_number) g.guest_number, g.id
  FROM guests g
  WHERE g.guest_number IS NOT NULL
  ORDER BY g.guest_number,
           (EXISTS (SELECT 1 FROM rsvp r WHERE r.guest_id = g.id)) DESC,
           (g.table_number IS NOT NULL) DESC,
           (g.invitation_code IS NOT NULL) DESC,
           g.created_at ASC;

  UPDATE rsvp r
  SET guest_id = k.id
  FROM guests g
  JOIN _keep k ON k.guest_number = g.guest_number
  WHERE r.guest_id = g.id AND g.id <> k.id;

  DELETE FROM guests g
  USING _keep k
  WHERE g.guest_number = k.guest_number AND g.id <> k.id;
END $$;

-- The key that makes the upsert below possible. Partial, because the
-- [PREVIEW] admin rows at the end of this file carry no guest_number.
CREATE UNIQUE INDEX IF NOT EXISTS guests_guest_number_uniq
  ON guests(guest_number)
  WHERE guest_number IS NOT NULL;

INSERT INTO guests (guest_number, name, group_name, side, invited, rsvp_status, dietary, is_kid, table_number)
VALUES
  (1, 'Susana Lo', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (2, 'David Chow', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (3, 'Hugo Chow', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (4, 'Grandma', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (5, 'Auntie7', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (6, 'Lisa', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('No pork',''), FALSE, NULL),
  (7, '大伯伯', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (8, '大伯娘', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (9, 'Edith Chau', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (10, '肥仔', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (11, '大姑', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (12, 'Christine YKT', 'Uni Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (13, 'Michael Chan Tsz King', 'Uni Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (14, 'Kwingthy Tsang', 'Uni Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (15, 'Miss Ku', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (16, 'Charlie Lee', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (17, 'Sukji', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (18, 'LST', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (19, 'Joey Lau Kawai', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (20, 'DearMe MPL', 'Secondary School Friends', '女方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (21, 'Jennifer Yu', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (22, 'Claire Yu', 'Secondary School Friends', '女方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (23, 'Toby Ho', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (24, 'Venus', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (25, 'Ho Shuk Ching', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (26, 'Phoebe Lai', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (27, 'LSY Alison', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (28, 'LK Sara', 'Secondary School Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (29, 'Flora Ding plus one', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (30, 'Flora Ding plus one', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (31, 'Mark Robson plus one', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (32, 'Mark Robson plus one', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (33, 'Evelyn Yau', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (34, 'Joanne Chan', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('vegetarian',''), FALSE, NULL),
  (35, 'Simon Yu', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (36, 'Carina Wu', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (37, 'Esther Yam', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (38, 'Rachel', 'Christy Ex-Colleague', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (39, 'Pui & BigG', 'Christy Church Friends', '女方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (40, 'Sophia Yik & Joseph & Luca', 'Christy Church Friends', '女方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (41, 'Grandma 婆婆', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (42, '舅父', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (43, '舅母', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (44, '傑 & Tracy Family', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (45, '傑 & Tracy Family', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (46, '傑 & Tracy Family', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), TRUE, NULL),
  (47, '傑 & Tracy Family', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), TRUE, NULL),
  (48, '表姨', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (49, '表姨丈', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (50, '熙信', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (51, '鳳姐', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (52, '表舅公', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (53, 'Maria Lo Ka Man', 'Christy Church Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (54, 'Esther', 'Christy Church Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (55, 'Rosita', 'Christy Church Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (56, 'Lo Shing Chau', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (57, 'Lo Shing Chau', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (58, 'Lai Kam Biu', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (59, 'Lai Kam Biu', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (60, 'Lee Chi Wah', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (61, 'Lee Chi Wah', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (62, 'Wu Man Kit', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (63, 'Wu Man Kit', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (64, 'Wong Shu Tong', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (65, 'Chris Fung', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (66, 'Li Kwok Kit', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (67, 'Li Kwok Kit', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (68, 'Wong Ping Keung', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (69, 'Kelvin Lo', 'Christy Dad Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (70, 'Ramen Ma', 'Christy Dad Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (71, 'Tommy Hui', 'Christy Dad Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (72, 'Yick Kin Wah & Shirely Cheung & Lok', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (73, 'Yick Kin Wah & Shirely Cheung & Lok', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (74, 'Yick Kin Wah & Shirely Cheung & Lok', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (75, 'William Tsang & Phoneix Lee', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (76, 'William Tsang & Phoneix Lee', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (77, 'Anthony Yip and Family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (78, 'Anthony Yip and Family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (79, 'Anthony Yip and Family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), TRUE, NULL),
  (80, 'Anthony Yip and Family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), TRUE, NULL),
  (81, 'Ho Yuk Ha', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (82, 'Mrs Yau & Agnes Yau', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (83, 'Mrs Yau & Agnes Yau', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (84, 'Andrew Wong & Teresa Yau', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (85, 'Andrew Wong & Teresa Yau', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (86, 'Biddy & Mother', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (87, 'Biddy & Mother', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (88, 'Tai Wai Fu', 'Christy Dad Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (89, 'Portia Young', 'Christy Dad Friends', '女方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (90, 'Franca Siu', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (91, 'Rita Kong', 'Christy Dad Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (92, 'Alan Kam', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (93, '大表姐 （穗禾苑）', 'Christy Dad Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (94, 'Auntie Lisa Au （三舅婆）', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (95, 'Candy Mak and family (表姑姐)', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (96, 'Candy Mak and family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (97, 'Chris Mak and family (表叔)', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (98, 'Chris Mak and family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (99, 'Chris Mak and family', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (100, 'Karen Chan', 'Christy Mom Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (101, 'Jeanette Chan', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (102, 'Anita Han', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (103, 'Virgina Lau', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (104, 'Virgina Lau', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (105, 'Yun Tak Keung & wife', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (106, 'Yun Tak Keung & wife', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (107, 'Gloria Szeto', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (108, 'Maria Fan', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (109, 'Wendy Foo', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (110, 'Marie Kwong', 'Christy Mom Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (111, 'Selina Mak', 'Christy Mom Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (112, 'Sharry Tong', 'Christy Mom Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (113, 'Evelyn Li', 'Christy Mom Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (114, 'Dick Chan', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (115, 'Maria Lo', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (116, 'Marco Chan', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (117, 'Adrian Lake & Nice Chan', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (118, 'Adrian Lake & Nice Chan', 'Christy Relatives', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (119, 'Ben Lo', 'Christy Relatives', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (120, 'Alice Wong & So Kwok Hung', 'Christy Mom Friends', '女方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (121, 'Cat 姐', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (122, 'Cat 姐', 'Christy Dad Friends', '女方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (123, 'Mitch Mom', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (124, 'Dalen', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (125, 'Vivian Ngai', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (126, 'Sam Li', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (127, 'Ben', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (128, 'Toby', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (129, 'Elaine', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (130, 'Jaysley Hung', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('No beef',''), FALSE, NULL),
  (131, 'Jenifer Gugufa', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (132, 'Carol Tam', 'Uni Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (133, 'Heather', 'Uni Friends', '男方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (134, 'Austin', 'Uni Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (135, 'Isabel Tam', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('No red meat',''), FALSE, NULL),
  (136, 'Steven Leung', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (137, 'Aggie', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (138, 'Juddy', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (139, 'SoSo', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (140, 'CCP Vivian', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (141, 'Anthony', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (142, 'Pinky Chiu', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('No beef',''), FALSE, NULL),
  (143, 'Andi & Fung', 'HK Macau Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (144, 'Andi & Fung', 'HK Macau Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (145, 'Steve Yip', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (146, 'Shirley', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (147, 'Chu jai Howard', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (148, 'Roku', 'UK Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (149, 'Adelia Su', 'UK Friends', '男方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (150, 'Mickey Wong', 'UK Friends', '男方', 'No', 'No', NULLIF('',''), FALSE, NULL),
  (151, 'Katie', 'UK Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (152, 'Mark Chan', 'UK Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (153, 'Veron Ma', 'UK Friends', '女方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (154, 'Elvin', 'UK Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (155, 'Lena', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (156, 'Charli Z', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (157, 'Janet', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (158, 'Charles', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (159, 'David', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (160, 'XY', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (161, 'Wu', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (162, '77', 'UK Friends (China)', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (163, 'Michael Lam', 'Secondary School Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (164, 'Kenneth Fung', 'Secondary School Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (165, 'Wong Man Chun', 'Secondary School Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (166, 'Wong Man Chun Mom', 'Mitch Mom Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (167, 'Minnie Choi', 'Secondary School Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (168, 'Calvin Tang', 'Secondary School Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (169, 'Winki', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (170, 'Leo', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (171, 'Wini', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (172, 'Peter', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (173, 'CanCan', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (174, 'Erica', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (175, 'Sam', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (176, 'Kelly', 'Foodie Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (177, 'Billy', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (178, 'Gina', 'HK Macau Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (179, 'Takaya', 'UK Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (180, 'Ella', 'UK Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (181, 'Ise Jun', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (182, '富士先生', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (183, 'DC', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (184, 'Casey', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (185, 'Max', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (186, 'Joyce', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (187, '黑柴', 'Mitch Work Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (188, 'Gentle', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (189, 'Gentle老婆', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (190, 'Ben Iu', 'Mitch Colleague', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL),
  (191, 'Kalista', 'UK Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (192, 'Charlene', 'UK Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (193, '紅紅姐姐', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (194, '菊菊阿姨', 'Mitch Family', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (195, 'Zeno', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (196, 'Charine', 'Mitch Work Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (197, 'Jia Jhang', 'Uni Friends', '男方', 'Yes', 'Yes', NULLIF('',''), FALSE, NULL),
  (198, 'Huang Jia', 'Uni Friends', '男方', 'Pending', 'Pending', NULLIF('',''), FALSE, NULL)
ON CONFLICT (guest_number) WHERE guest_number IS NOT NULL
DO UPDATE SET
  name       = EXCLUDED.name,
  group_name = EXCLUDED.group_name,
  side       = EXCLUDED.side,
  invited    = EXCLUDED.invited,
  is_kid     = EXCLUDED.is_kid;
  -- rsvp_status / dietary / table_number / seat_number / invitation_code /
  -- outreach_* are intentionally absent: they are live state, not roster data.


-- ============================================================
-- Phase 2: Code-based RSVP + Seat Assignment integration
-- Idempotent — safe to run multiple times.
-- ============================================================

-- 5. Extend tables with invitation code + seat slot
ALTER TABLE guests ADD COLUMN IF NOT EXISTS invitation_code TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS seat_number     INTEGER;
ALTER TABLE rsvp   ADD COLUMN IF NOT EXISTS guest_id        UUID REFERENCES guests(id);
ALTER TABLE rsvp   ADD COLUMN IF NOT EXISTS invitation_code TEXT;

-- One guest per (table, seat); allows multiple NULLs
CREATE UNIQUE INDEX IF NOT EXISTS guests_table_seat_uniq
  ON guests(table_number, seat_number)
  WHERE table_number IS NOT NULL AND seat_number IS NOT NULL;

-- Invitation code lookup (NOT unique — couples share codes)
CREATE INDEX IF NOT EXISTS guests_invitation_code_idx ON guests(invitation_code);


-- 6. Code generator: 'MC-' + 5 chars from 31-symbol alphabet (no 0/O/1/I/L)
CREATE OR REPLACE FUNCTION generate_invitation_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result   TEXT := 'MC-';
  i INT;
BEGIN
  FOR i IN 1..5 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- 7. Trigger: auto-fill invitation_code on new guest INSERT (if not provided)
CREATE OR REPLACE FUNCTION ensure_invitation_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  attempt INT := 0;
BEGIN
  IF NEW.invitation_code IS NULL THEN
    LOOP
      NEW.invitation_code := generate_invitation_code();
      attempt := attempt + 1;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM guests WHERE invitation_code = NEW.invitation_code
      );
      IF attempt > 20 THEN
        RAISE EXCEPTION 'Could not generate unique invitation code after 20 attempts';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guests_invitation_code_trigger ON guests;
CREATE TRIGGER guests_invitation_code_trigger
  BEFORE INSERT ON guests
  FOR EACH ROW EXECUTE FUNCTION ensure_invitation_code();

-- 8. Backfill: assign codes to existing guests missing one.
DO $$
DECLARE
  g RECORD;
  new_code TEXT;
  attempt  INT;
BEGIN
  FOR g IN SELECT id FROM guests WHERE invitation_code IS NULL LOOP
    attempt := 0;
    LOOP
      new_code := generate_invitation_code();
      attempt  := attempt + 1;
      IF NOT EXISTS (SELECT 1 FROM guests WHERE invitation_code = new_code) THEN
        UPDATE guests SET invitation_code = new_code WHERE id = g.id;
        EXIT;
      END IF;
      IF attempt > 20 THEN
        RAISE EXCEPTION 'Backfill failed: too many collisions for guest %', g.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;


-- 9. Helper: merge two guests onto one shared invitation code (for couples).
--    The first arg's code is kept; the second guest is merged onto it.
--    Usage: SELECT pair_invitation('Mark Chan', 'Sarah Chan');
CREATE OR REPLACE FUNCTION pair_invitation(p_keep_name TEXT, p_merge_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  shared_code TEXT;
BEGIN
  SELECT invitation_code INTO shared_code
  FROM guests
  WHERE name = p_keep_name
  LIMIT 1;
  IF shared_code IS NULL THEN
    RAISE EXCEPTION 'Guest "%" not found or has no code', p_keep_name;
  END IF;
  UPDATE guests SET invitation_code = shared_code WHERE name = p_merge_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest "%" not found', p_merge_name;
  END IF;
  RETURN shared_code;
END;
$$;


-- 10. Admin allowlist (Christy + Mitchell)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.email(), '') IN (
    'christychowtc@gmail.com',
    'mitchell.tsui.mc@gmail.com'
  );
$$;


-- 11. Lock down direct table access — replace blanket public read with RPC-only.
DROP POLICY IF EXISTS "Public read guests"   ON guests;
DROP POLICY IF EXISTS "Service write guests" ON guests;
DROP POLICY IF EXISTS "Public insert rsvp"   ON rsvp;
DROP POLICY IF EXISTS "Service manage rsvp"  ON rsvp;
DROP POLICY IF EXISTS "Admin all guests"     ON guests;
DROP POLICY IF EXISTS "Admin all rsvp"       ON rsvp;
DROP POLICY IF EXISTS "Service all guests"   ON guests;
DROP POLICY IF EXISTS "Service all rsvp"     ON rsvp;

CREATE POLICY "Admin all guests" ON guests FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admin all rsvp" ON rsvp FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Service all guests" ON guests FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service all rsvp" ON rsvp FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- 12. Public RPCs (SECURITY DEFINER — return only the matched household)

-- lookup_invitation(code) → household members for prefill (no seat info)
CREATE OR REPLACE FUNCTION lookup_invitation(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  members JSONB;
  norm    TEXT;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  norm := upper(trim(p_code));

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',         g.id,
      'name',       g.name,
      'side',       g.side,
      'has_rsvpd',  EXISTS (SELECT 1 FROM rsvp r WHERE r.guest_id = g.id)
    )
    ORDER BY g.guest_number
  )
  INTO members
  FROM guests g
  WHERE g.invitation_code = norm;

  IF members IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found',   true,
    'code',    norm,
    'members', members
  );
END;
$$;

-- lookup_seats(code) → seat info (only after at least one household RSVP)
CREATE OR REPLACE FUNCTION lookup_seats(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  any_rsvp BOOLEAN;
  members  JSONB;
  norm     TEXT;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  norm := upper(trim(p_code));

  SELECT EXISTS(
    SELECT 1 FROM rsvp r
    JOIN guests g ON r.guest_id = g.id
    WHERE g.invitation_code = norm
  ) INTO any_rsvp;

  IF NOT any_rsvp THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'name',         g.name,
      'table_number', g.table_number,
      'seat_number',  g.seat_number,
      'attendance',   (SELECT r.attendance FROM rsvp r
                       WHERE r.guest_id = g.id
                       ORDER BY r.submitted_at DESC LIMIT 1),
      'has_seat',     g.table_number IS NOT NULL AND g.seat_number IS NOT NULL,
      'has_rsvpd',    EXISTS (SELECT 1 FROM rsvp r WHERE r.guest_id = g.id)
    )
    ORDER BY g.guest_number
  )
  INTO members
  FROM guests g
  WHERE g.invitation_code = norm;

  RETURN jsonb_build_object('available', true, 'members', members);
END;
$$;

-- submit_rsvp(...) → adds RSVP linked to guest_id; validates ownership of code.
CREATE OR REPLACE FUNCTION submit_rsvp(
  p_code           TEXT,
  p_guest_id       UUID,
  p_email          TEXT,
  p_attendance     BOOLEAN,
  p_plus_one_name  TEXT,
  p_dietary        TEXT,
  p_song_request   TEXT,
  p_message        TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  guest_name TEXT;
  norm       TEXT;
BEGIN
  norm := upper(trim(coalesce(p_code, '')));

  SELECT name INTO guest_name
  FROM guests
  WHERE id = p_guest_id AND invitation_code = norm;

  IF guest_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid guest or invitation code.');
  END IF;

  -- Replace any prior RSVP from the same guest (latest wins)
  DELETE FROM rsvp WHERE guest_id = p_guest_id;

  INSERT INTO rsvp (
    guest_id, invitation_code, name, email, attendance,
    plus_one_name, dietary, song_request, message
  ) VALUES (
    p_guest_id, norm, guest_name, p_email, p_attendance,
    p_plus_one_name, p_dietary, p_song_request, p_message
  );

  -- Mirror status onto guests.rsvp_status for the admin tracker
  UPDATE guests
  SET rsvp_status = CASE WHEN p_attendance THEN 'Yes' ELSE 'No' END,
      dietary     = COALESCE(NULLIF(trim(p_dietary), ''), dietary)
  WHERE id = p_guest_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- 13. Grants — public RPC surface
GRANT EXECUTE ON FUNCTION lookup_invitation(TEXT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION lookup_seats(TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_rsvp(TEXT, UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
                                                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pair_invitation(TEXT, TEXT) TO authenticated;


-- 14. Pending plus-one queue — RSVPs naming a plus-one not in master list.
CREATE OR REPLACE VIEW pending_plus_ones AS
SELECT
  r.id              AS rsvp_id,
  r.name            AS rsvp_name,
  r.plus_one_name,
  r.dietary,
  r.submitted_at,
  r.guest_id        AS host_guest_id,
  g.table_number    AS host_table,
  g.seat_number     AS host_seat,
  g.invitation_code AS host_code
FROM rsvp r
LEFT JOIN guests g ON g.id = r.guest_id
WHERE r.plus_one_name IS NOT NULL
  AND length(trim(r.plus_one_name)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM guests gp
    WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(r.plus_one_name))
  );

GRANT SELECT ON pending_plus_ones TO authenticated;


-- 15. Printable code list — for hand-writing / printing onto invitations.
--     Run: SELECT * FROM invitation_print_list ORDER BY guest_number;
CREATE OR REPLACE VIEW invitation_print_list AS
SELECT
  guest_number,
  name,
  group_name,
  side,
  invitation_code,
  CASE WHEN COUNT(*) OVER (PARTITION BY invitation_code) > 1
       THEN 'shared' ELSE 'solo' END AS code_type
FROM guests
WHERE invitation_code IS NOT NULL;

GRANT SELECT ON invitation_print_list TO authenticated;


-- ============================================================
-- Phase 3: Admin retrieval views for guest submissions
-- (RLS on rsvp/guests still applies — only admin emails can read)
-- ============================================================

-- 16. Master review feed: every RSVP joined with guest details and seat.
CREATE OR REPLACE VIEW admin_rsvps AS
SELECT
  r.submitted_at,
  g.guest_number,
  g.name             AS guest_name,
  g.side,
  g.group_name,
  r.attendance,
  r.email,
  r.plus_one_name,
  r.dietary,
  r.song_request,
  r.message,
  g.table_number,
  g.seat_number,
  g.invitation_code
FROM rsvp r
LEFT JOIN guests g ON g.id = r.guest_id
ORDER BY r.submitted_at DESC;

GRANT SELECT ON admin_rsvps TO authenticated;

-- 17. Song requests only (for the band).
CREATE OR REPLACE VIEW admin_song_requests AS
SELECT
  r.submitted_at,
  g.name AS requested_by,
  g.side,
  r.song_request
FROM rsvp r
LEFT JOIN guests g ON g.id = r.guest_id
WHERE r.song_request IS NOT NULL
  AND length(trim(r.song_request)) > 0
ORDER BY r.submitted_at DESC;

GRANT SELECT ON admin_song_requests TO authenticated;

-- 18. Messages to the couple only.
CREATE OR REPLACE VIEW admin_messages AS
SELECT
  r.submitted_at,
  g.name AS from_name,
  g.side,
  r.message
FROM rsvp r
LEFT JOIN guests g ON g.id = r.guest_id
WHERE r.message IS NOT NULL
  AND length(trim(r.message)) > 0
ORDER BY r.submitted_at DESC;

GRANT SELECT ON admin_messages TO authenticated;


-- ============================================================
-- Phase 4: Floor plan tap-to-reveal
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


-- ============================================================
-- Phase 5: WhatsApp / outreach tracker
-- Idempotent — safe to re-run.
-- ============================================================

-- 20. Per-guest contact + outreach state
ALTER TABLE guests ADD COLUMN IF NOT EXISTS phone            TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS outreach_status  TEXT DEFAULT 'Not Contacted';
ALTER TABLE guests ADD COLUMN IF NOT EXISTS outreach_channel TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS outreach_sent_at TIMESTAMPTZ;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS outreach_notes   TEXT;

-- Keep existing rows on the canonical "Not Contacted" default if NULL
UPDATE guests SET outreach_status = 'Not Contacted'
 WHERE outreach_status IS NULL;

-- 21. Outreach planning view — one row per guest, with code_type so the
--     admin tool can collapse couples onto a single household row.
CREATE OR REPLACE VIEW outreach_list AS
SELECT
  g.id, g.guest_number, g.name, g.group_name, g.side,
  g.invited, g.rsvp_status, g.invitation_code, g.phone,
  g.outreach_status, g.outreach_channel, g.outreach_sent_at, g.outreach_notes,
  CASE WHEN COUNT(*) OVER (PARTITION BY g.invitation_code) > 1
       THEN 'shared' ELSE 'solo' END AS code_type
FROM guests g;

GRANT SELECT ON outreach_list TO authenticated;

-- 22. Bulk-mark every guest sharing an invitation code (admin only). Used
--     when a couple share one code and you message just one of them.
CREATE OR REPLACE FUNCTION mark_household_sent(p_code TEXT, p_channel TEXT DEFAULT 'WhatsApp')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm TEXT;
  affected INTEGER;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  norm := upper(trim(coalesce(p_code, '')));
  UPDATE guests
     SET outreach_status  = 'Sent',
         outreach_channel = p_channel,
         outreach_sent_at = NOW()
   WHERE invitation_code = norm
     AND outreach_status <> 'Responded';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_household_sent(TEXT, TEXT) TO authenticated;

-- ============================================================
-- Phase 6: Admin preview invitation codes
-- Idempotent — safe to re-run.
-- ============================================================

-- 22. Two preview "guests" the couple can use to spot-check the invitation
--     flow without borrowing a real guest's code. Each is wired up like a
--     normal household entry, pre-seated at Table 2 so the seat card shows
--     real table/seat info. Re-running the script leaves existing rows
--     untouched (matched by invitation_code).

INSERT INTO guests (name, group_name, side, invited, rsvp_status, invitation_code, table_number, seat_number)
SELECT '[PREVIEW] Bride', 'Admin Preview', '女方', true, NULL, 'MC-BRIDE', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM guests WHERE invitation_code = 'MC-BRIDE');

INSERT INTO guests (name, group_name, side, invited, rsvp_status, invitation_code, table_number, seat_number)
SELECT '[PREVIEW] Groom', 'Admin Preview', '男方', true, NULL, 'MC-GROOM', 2, 2
WHERE NOT EXISTS (SELECT 1 FROM guests WHERE invitation_code = 'MC-GROOM');


-- ============================================================
-- Phase 7: Roster maintenance helpers
-- Idempotent — safe to re-run.
-- ============================================================

-- 23. uninvite_guest(guest_number) → removes a guest from the roster.
--     Deleting the row from the seed VALUES list is not enough: the upsert
--     only adds and updates, it never deletes. Run this once for anyone who
--     drops off the list, then remove their row from the VALUES block so the
--     file and the database agree.
--
--     Clears their RSVP rows first (rsvp.guest_id has no ON DELETE rule) and
--     frees their seat. Returns the name removed, or NULL if not found.
CREATE OR REPLACE FUNCTION uninvite_guest(p_guest_number INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gid       UUID;
  gname     TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT id, name INTO gid, gname
  FROM guests WHERE guest_number = p_guest_number;

  IF gid IS NULL THEN
    RETURN NULL;
  END IF;

  DELETE FROM rsvp   WHERE guest_id = gid;
  DELETE FROM guests WHERE id = gid;

  RETURN gname;
END;
$$;

GRANT EXECUTE ON FUNCTION uninvite_guest(INTEGER) TO authenticated;


-- 24. next_guest_number() → the next free guest_number, for adding guests.
--     Use it to pick the number for a new row in the seed VALUES block.
CREATE OR REPLACE FUNCTION next_guest_number()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$ SELECT COALESCE(MAX(guest_number), 0) + 1 FROM guests $$;

GRANT EXECUTE ON FUNCTION next_guest_number() TO authenticated;


-- 25. roster_diff → rows whose live state disagrees with expectations,
--     as a quick sanity check after editing the guest list.
CREATE OR REPLACE VIEW roster_diff AS
SELECT
  g.guest_number,
  g.name,
  g.group_name,
  g.side,
  g.rsvp_status,
  g.invitation_code,
  g.table_number,
  g.seat_number,
  EXISTS (SELECT 1 FROM rsvp r WHERE r.guest_id = g.id) AS has_rsvp
FROM guests g
WHERE g.invitation_code IS NULL          -- code never generated
   OR g.name IS NULL
   OR length(trim(g.name)) = 0
ORDER BY g.guest_number;

GRANT SELECT ON roster_diff TO authenticated;
