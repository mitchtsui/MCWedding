-- 2026-08-25 — Centralise the WhatsApp outreach templates in Supabase.
--
-- Why: the templates lived in each admin's localStorage. An edit never left the
-- browser it was typed in, and worse, the stored copy was spread OVER the
-- deployed DEFAULT_TEMPLATES on load — so it shadowed every future deploy. A
-- browser that had ever touched the editor kept serving its own stale copy
-- indefinitely (this is how a 7:45pm dinner time survived a day past the fix).
--
-- Safe to re-run. The seed is ON CONFLICT DO NOTHING on purpose: re-running this
-- file must never clobber copy the couple has since edited in the UI.
--
-- ⚠ Apply with psql (session-pooler connection string) rather than the
-- dashboard SQL editor — its statement splitter has broken dollar-quoted bodies
-- before (see CLAUDE.md, the 2026-08-17 submit_rsvp incident). If you must use
-- the dashboard: fresh query tab, nothing selected, run the whole file at once.

CREATE TABLE IF NOT EXISTS outreach_templates (
  key         TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Stamp who last touched a template, so the tool can show it and the two
-- admins can tell whose copy they are looking at.
CREATE OR REPLACE FUNCTION touch_outreach_template()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.email(), NEW.updated_by);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_touch_outreach_template ON outreach_templates;
CREATE TRIGGER trg_touch_outreach_template
  BEFORE INSERT OR UPDATE ON outreach_templates
  FOR EACH ROW EXECUTE FUNCTION touch_outreach_template();

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;

-- Admin-only, reusing the same is_admin() allowlist every other admin surface
-- uses. Guests must never read these — they contain the invite-link wording.
DROP POLICY IF EXISTS "Admin all outreach_templates"   ON outreach_templates;
DROP POLICY IF EXISTS "Service all outreach_templates" ON outreach_templates;

CREATE POLICY "Admin all outreach_templates" ON outreach_templates FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Service all outreach_templates" ON outreach_templates FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON outreach_templates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON outreach_templates TO authenticated;

-- Seed. These strings are the same ones held as DEFAULT_TEMPLATES in
-- whatsapp-outreach.html; both come from one generator, so they cannot drift.
INSERT INTO outreach_templates (key, body) VALUES
  ('bilingual', $tpl$Hi {name}!

Christy & Mitchell here — we'd love to have you celebrate our wedding with us on Thursday, 12 November 2026 at The Salisbury Room, The Peninsula Hong Kong.

We've made a personal invitation page just for you (please don't share — it's tied to your seat):
{link}

Kindly RSVP by {deadline}. Once you've RSVP'd, this page will keep evolving — please check back about two weeks before the wedding for your seating and any final details.

——
Hi {name}!

徐文俊 & 周芷晴 誠意邀請你出席我們的婚禮:

• 日期: 2026年11月12日 (星期四)
• 地點: 香港半島酒店 The Salisbury Room
• 時間: 5:00pm 賓客到場 · 6:30pm 證婚 · 8:00pm 晚宴

{link}
請於 {deadline} 前透過上面的連結回覆,謝謝!婚禮前兩星期請重新查看此連結,以獲取座位安排及最新資訊。

With love,
Christy, Mitchell & Chambolle$tpl$),
  ('friends', $tpl$Hey {name}!

Christy & Mitch here — saving the date didn't quite cover the full picture, so here's the real one:

• Thursday, 12 November 2026
• The Salisbury Room, The Peninsula Hong Kong
• Arrival 5:00pm · Ceremony 6:30pm · Dinner 8:00pm
• Elegant evening attire

We've set up a personalised invitation page for you — it remembers your name, plus-one and dietary, and later shows your seat:

{link}

Please RSVP by {deadline} so we can finalise seating. Then check the link again about two weeks before the wedding — that's when your seat will show up (plus any last-minute updates).

Chambolle the corgi will not be attending (Peninsula policy) but sends his regards and is hoping you'll bring him stinky treats afterwards.

Can't wait to celebrate with you!
Christy & Mitchell$tpl$),
  ('formal', $tpl$Dear {fullname},

Christy and Mitchell would be honoured by your presence at their wedding celebration:

• Date: Thursday, 12 November 2026
• Venue: The Salisbury Room, The Peninsula Hong Kong
         Salisbury Road, Tsim Sha Tsui, Kowloon
• Schedule: Guest Arrival 5:00 pm
            Ceremony 6:30 pm
            Dinner Reception 8:00 pm
• Attire: Elegant Evening Attire

A personal invitation page has been prepared for you, with full details and an RSVP form:
{link}

We would be most grateful if you could kindly confirm your attendance by {deadline}. Your personal invitation page will be updated with your seating arrangement and any final details approximately two weeks prior to the event.

With warm regards,
Christy Chow & Mitchell Tsui$tpl$)
ON CONFLICT (key) DO NOTHING;
