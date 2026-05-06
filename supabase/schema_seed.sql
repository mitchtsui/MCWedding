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

CREATE TRIGGER guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- SEED: Insert all 198 guests
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
ON CONFLICT DO NOTHING;
