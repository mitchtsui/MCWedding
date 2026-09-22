# Christy & Mitchell — Wedding Website

**12 November 2026 · The Salisbury Room, The Peninsula Hong Kong**

---

## What's in this repo

| File | Description |
|------|-------------|
| `wedding-invitation.html` | Main guest site — one HTML entry (~1 MB). Photos live under `photos/` and the Supabase credentials come from `/api/config.js`; English in the DOM, 繁體中文 + 日本語 via the built-in i18n block |
| `admin.html` | Admin hub — links to the tools below and to the live site; holds no guest data, no sign-in |
| `seating-planner.html` | Drag-and-drop guest seating manager (13 tables × 12 seats = 156); magic-link sign-in |
| `whatsapp-outreach.html` | Admin tool: per-guest WhatsApp invitation links + outreach tracker; magic-link sign-in |
| `preview.html` | Admin preview of the invitation page (no sign-in) |
| `wedding-day.html` + `wedding-day.js`, `wedding-day-now.js`, `wedding-day-data.js` | Read-only wedding-party rundown for the day itself — see [Wedding day rundown](#wedding-day-rundown-wedding-dayhtml). Timing tests: `tests/wedding-day-now.test.cjs`; spec: `docs/wedding-day-prototype.md` |
| `api/config.js` | Vercel serverless function that injects `SUPABASE_URL` / `SUPABASE_ANON_KEY` into the browser at runtime — nothing is hardcoded in the HTML |
| `vercel.json` | Vercel project config: no build step, the repo root is served as-is, `/` rewrites to `wedding-invitation.html` |
| `supabase/schema_seed.sql` | Supabase schema, RLS, RPCs + the roster **snapshot as of 2026-08-31** (regenerated from the live database 2026-08-25, last edited 2026-08-31: 165 numbered guests + 2 `[PREVIEW]` rows). The database is the live truth — re-export before trusting a count |
| `supabase/migrations/` | Standalone SQL you can run without re-seeding the roster (incl. `export_roster_as_seed.sql`, `swap_tables.sql`) |
| `supabase/audit_rsvp_consistency.sql` | Read-only, 13-query consistency check between `guests` and `rsvp` — run as admin, one block at a time |
| `supabase/seed-guests.js` | **July leftover — never run.** Holds the 198-row pre-uninvite list and upserts on `guest_number`; running it would re-add the guests the couple uninvited. `schema_seed.sql` is the only seed |
| `CLAUDE.md` | Rules + routing for AI-assisted work (short; loaded into every session) |
| `docs/BUILD_LOG.md` | The dated build journal — history, measurements and the reasoning behind each decision |
| `docs/wedding-day-prototype.md` | Spec, decisions and acceptance record for the wedding-day rundown |

---

## Setup

### 1. Deploy the website

The site is a **Vercel project**, not a single-file upload. There is no build step (`vercel.json` sets `buildCommand: null` and serves the repo root), but the site is more than one file:

- the HTML pages at the repo root — `/` is rewritten to `wedding-invitation.html`;
- `api/config.js`, a serverless function that hands the Supabase URL + anon key to the browser at runtime (step 2). A plain static host would not run it and the site would stay in demo mode;
- `photos/` — the hero, gallery and Our Story images have been external files since 2026-08-12. Only the two script fonts (Liana, Besotted Love), the Chambolle slideshow and the easter-egg images are still base64 inside the HTML;
- Cormorant Garamond, Raleway and the Alex Brush fallback load from the Google Fonts CDN.

Deploy by pushing to the GitHub repo connected to the Vercel project (or `vercel deploy` from the Vercel CLI).

### 2. Connect Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema_seed.sql` in the Supabase SQL Editor
   - Creates both tables, seeds the roster snapshot (165 numbered guests + 2 preview rows as of 2026-08-31), **and** generates a unique invitation code per guest, sets up RLS, and creates the public RPCs (`lookup_invitation`, `lookup_seats`, `submit_rsvp`, `lookup_my_table`).
   - The script is idempotent — safe to run multiple times. The guest seed upserts on `guest_number` and never overwrites live RSVP, seating or outreach state. See [Updating the guest list](#updating-the-guest-list).
3. In Vercel → Project → **Settings → Environment Variables**, add:
   - `SUPABASE_URL` → `https://yourproject.supabase.co`
   - `SUPABASE_ANON_KEY` → the anon public JWT (starts `eyJ…`)

   Both values come from Supabase → Project Settings → API. Apply to all environments (Production / Preview / Development).
4. Redeploy on Vercel (or push any commit) so `/api/config.js` picks up the new vars.
5. In Supabase → **Authentication → URL Configuration**:
   - **Site URL** → your Vercel domain (e.g. `https://mcwedding.vercel.app`)
   - **Redirect URLs** → add `https://your-domain/seating-planner.html` **and** `https://your-domain/whatsapp-outreach.html`

   Without these, the magic links for the seating planner and the outreach tool won't redirect correctly. (The outreach entry is what that tool's own magic-link flow needs; whether the live Supabase project already lists it was not checked when this was written, 2026-09-22.)

> The HTML files load `/api/config.js`, a Vercel serverless function that reads the env vars at runtime and exposes them on `window`. Nothing secret is hardcoded; the anon key is designed to be public (security comes from RLS).
>
> Until env vars are set, both files run in demo mode. The RSVP page accepts `?code=MC-DEMO1` (single guest) or `?code=MC-DEMO2` (couple) for end-to-end UI testing without a database.

> **Local dev**: static-server tools won't run `/api/*.js`. Use `vercel dev` (from the Vercel CLI) to serve the project including the serverless function locally.

### 3. Pair couples onto a shared invitation code (optional)

By default each guest gets their own code. To share one envelope between a couple:

```sql
SELECT pair_invitation('Mark Chan', 'Sarah Chan');
-- Sarah is merged onto Mark's code. Both seats display together.
```

### 4. Print the code list

```sql
SELECT * FROM invitation_print_list ORDER BY guest_number;
```

Export this as CSV, then write the per-guest URL onto each printed invitation:

```
https://yourdomain.com/?code=MC-XXXXX
```

### 5. (Optional) Seed via Node.js

> ⚠️ **Don't.** `supabase/seed-guests.js` is a stale July seed: it still carries the 198-row list from before the couple uninvited 34 guests, and it upserts on `guest_number`, so re-running it would re-add every one of them (and the DB trigger would issue them invitation codes). It is kept only as a record of the original list. `supabase/schema_seed.sql` is the only seed — see [Updating the guest list](#updating-the-guest-list).

---

## RSVP & seating flow

1. **Each guest gets a personalised URL**: `https://[host]/?code=MC-XXXXX`
2. Guest opens the link → invitation looked up via `lookup_invitation` RPC → form prefills with their name (and household, for couples).
3. Guest submits RSVP → `submit_rsvp` RPC writes a row linked by `guest_id` and mirrors `rsvp_status` onto `guests`.
4. Confirmation page shows the table number for everyone on that invitation, pulled via `lookup_seats`. (Seat numbers are deliberately not displayed anywhere post-RSVP — they move until the final seating pass.)
5. Guest can revisit the same URL anytime to see their table or update their RSVP.
6. **You assign seats** in `seating-planner.html` (magic-link sign-in for `christychowtc@gmail.com` / `mitchell.tsui.mc@gmail.com`). Drag-drop persists `table_number` + `seat_number` to Supabase.
7. `pending_plus_ones` still exists but no longer receives new rows — the RSVP form's plus-one field was removed on 2026-08-25, so a plus-one has to be added to the `guests` master list directly. Historical rows are still listed.
8. To move a whole table's worth of guests at once, install `supabase/migrations/swap_tables.sql` and call `SELECT swap_tables(1, 2);` — everyone swaps places, keeping their seat numbers. Dragging them one by one in the planner works too, but `guests` has a unique index on `(table_number, seat_number)`, so a bulk hand-written `UPDATE` collides; the function parks one side on a scratch number to get around it. Running a swap twice undoes it, and `SELECT * FROM table_occupancy;` shows who is where.

### What a guest can see of the seating plan

A guest sees **only their own table**. Opening "View Seating Plan" calls `lookup_my_table`, which returns the occupants of the table(s) that guest's own invitation is seated at and nothing else. Every other table is drawn on the plan for orientation — so they can find their way across the room — but is greyed out, not tappable, and carries no names. Guests who have RSVP'd "No" are excluded from the list, so the table doesn't show absences.

This replaces the earlier `lookup_all_table_assignments`, which handed the entire seating chart to anyone holding any valid code. That function is dropped by `schema_seed.sql`; re-running the file removes it.

The anon key never has direct read access to `guests` — it can only call the SECURITY DEFINER RPCs, which return at most one household (or, for the floor plan, one table).

---

## Updating the guest list

`supabase/schema_seed.sql` is the source of truth for **who is invited**. The database is the source of truth for **everything that happens to them** — RSVP status, dietary notes, table and seat, invitation code, outreach state.

> ⚠️ **If you have edited the `guests` table by hand in Supabase**, the seed file is now behind the database. Running the full `schema_seed.sql` will push the file's older `name` / `group_name` / `side` / `invited` / `is_kid` values back over your manual edits, and will re-add anyone you deleted. Before you run it, sync the file to reality with `supabase/migrations/export_roster_as_seed.sql`: it prints the live table as a ready-to-paste `VALUES` block (plus a few sanity queries for rows with no `guest_number` or no invitation code). Live state — RSVP, dietary, seats, codes, outreach — is never at risk either way.
>
> To apply a schema change **without** touching the roster at all, run the standalone file in `supabase/migrations/` instead of the full seed.

Editing the `VALUES` block and re-running the whole file is the intended workflow. The seed upserts on `guest_number`, so a re-run refreshes the roster columns (`name`, `group_name`, `side`, `invited`, `is_kid`) and leaves live state untouched. Guests keep their invitation codes and their seats.

**`guest_number` is the identity, not `name`.** Names repeat across rows on purpose — a family invited as several seats appears as several rows carrying the same name, one row per seat — and the numbers are sparse (1–202 with gaps as of the 2026-08-31 snapshot, because uninviting deletes the row and never renumbers). Never key anything off the name, and never assume `guest_number` is contiguous or that `MAX` equals the headcount.

| Change | How |
|--------|-----|
| **Add a guest** | `SELECT next_guest_number();` for the next free number, append a row to the `VALUES` block, re-run the file. The DB trigger generates their invitation code automatically. |
| **Rename / regroup / fix a side** | Edit that `guest_number`'s row in place, re-run the file. |
| **Remove a guest** | `SELECT uninvite_guest(<guest_number>);` — deletes them and any RSVP rows, frees their seat — **then** delete their row from the `VALUES` block. Skipping the second step means the next re-run re-adds them. |
| **Change someone's RSVP by hand** | Do it in the database (Supabase Table Editor), not the seed file. The seed deliberately never overwrites `rsvp_status`. |
| **Bulk changes (10+ rows)** | Edit the `VALUES` block in your editor and re-run once. |
| **One or two quick changes** | Supabase Table Editor is faster, but mirror the edit back into the seed file or the two drift apart. |

Re-running `schema_seed.sql` is genuinely safe — first verified (when the file still held the original 198-row list) by running it three times against a fresh Postgres with seats, RSVPs and outreach state in place, and diffing: guest count stayed at 200 (198 + the 2 preview rows), live state byte-identical. Re-verified 2026-08-25 after the roster was regenerated from the live database: 165 rows (163 numbered + 2 preview at the time), and still 165 after a second run. The 2026-08-31 snapshot is 165 numbered + 2 preview = 167 rows.

> **If you ran the old version of this file more than once**, you have a duplicate copy of all 198 guests. The seed now self-heals: it collapses duplicate `guest_number` rows before applying the unique index, keeping the richest row (one with an RSVP, else a seat, else the oldest) and re-pointing RSVP rows at the survivor. Check with:
> ```sql
> SELECT guest_number, count(*) FROM guests
> WHERE guest_number IS NOT NULL
> GROUP BY guest_number HAVING count(*) > 1;
> ```

---

## WhatsApp invitations (`whatsapp-outreach.html`)

Admin-only tool for sending out the personal RSVP links by WhatsApp and tracking who you've reached.

1. Open `https://[host]/whatsapp-outreach.html` and sign in with `christychowtc@gmail.com` or `mitchell.tsui.mc@gmail.com` (same magic-link auth as the seating planner).
2. Three editable message templates ship with the tool:
   - **Bilingual (中英)** — auto-selected for relatives and church friends
   - **Friends · English** — auto-selected for friends / colleagues / classmates
   - **Formal** — auto-selected for parents' friends (`*Dad Friends` / `*Mom Friends`)
   - Templates support placeholders: `{name}`, `{fullname}`, `{link}`, `{code}`, `{deadline}`. **Edits are shared** — they save to the `outreach_templates` table (admin-only RLS) and both admins see the same copy, with a `last edited by` line and a **Reload** button. `DEFAULT_TEMPLATES` in the HTML is only a fallback. (Before 2026-08-25 these lived in per-browser localStorage, so edits never synced *and* a stale local copy shadowed every deploy.) Per-guest overrides are still possible, but which template a *group* defaults to is still stored per-browser.
3. Each guest row shows their personal `?code=MC-XXXXX` URL, a copy button, the rendered WhatsApp link, and:
   - **Attending** (segmented Yes / No / No reply → `guests.rsvp_status`) and **Outreach** (dropdown: Not Contacted / Sent / Responded / Bounced / Skip → `guests.outreach_status`) — two different things: whether the guest is coming vs whether you have messaged them. (The dropdown was labelled just "Status" until 2026-08-25.) Clicking the green "Send via WhatsApp" button auto-flips a guest from `Not Contacted` → `Sent` and stamps `outreach_sent_at`; recording a Yes/No moves `Sent` → `Responded`. The spreadsheet's pre-invitation Yes/No shows only as a greyed hint and is never counted — the header counts answered guests (`attendance_truth`) only.
   - **Phone** — if filled, the WhatsApp link opens that contact directly (`wa.me/<phone>?text=…`); if blank, WhatsApp lets you pick the recipient.
   - **Notes** — free-text per guest.
   - **Mark household sent** — for couples on a shared invitation code, one click stamps everyone in the household.
4. Filters: search, outreach status, attendance, side (女方/男方), group, plus a **one-row-per-household** toggle so you don't message both halves of a couple.
5. `Export CSV` produces a snapshot of every guest with their URL and outreach state — handy as a backup or for sharing.

State persists in the `guests` table (`outreach_status`, `outreach_channel`, `outreach_sent_at`, `outreach_notes`, `phone`) via the same admin RLS policy as the seating planner. Re-running `schema_seed.sql` is idempotent and adds these columns if missing.

---

## Wedding day rundown (`wedding-day.html`)

A read-only rundown of the wedding party's day, for 12 November 2026 — also linked from `admin.html`. It has no sign-in and lists the wedding party and the day's itinerary, so share the URL deliberately. It is a static snapshot of the couple's planning workbook, not a live sheet, and not yet the final operating schedule.

- **Horizontal day timeline** (scrolls sideways inside itself; the page itself scrolls vertically), rows The day → Bride → Bridesmaids → Groom → Groomsmen, with bride/groom activities, bridesmaid/groomsman duties and locations, plus the tea, photo-order and supplies reference lists.
- **Current / next panel** under the date: the current task(s) and the next two events for the selected person or team, computed for 12 Nov 2026 in **Hong Kong time (UTC+8)** whatever the viewer's timezone — before the day it shows only the first upcoming events, never an invented "current task"; a labelled "Preview a time" control scrubs through the day.
- Data is one file, `wedding-day-data.js` (update source row references and participation mappings together; never overwrite source timings to hide a conflict); timing logic is `wedding-day-now.js`; page logic is `wedding-day.js`. No build step, no dependencies.
- Tests: `node --test tests/wedding-day-now.test.cjs` — before/during/after the day, the UTC/HKT date boundary, end-exclusive intervals, overlaps, gaps and milestones. Run it after touching the timing logic.
- Spec, decisions, what was and wasn't verified: `docs/wedding-day-prototype.md`.

---

## Website sections

`Home → Wedding Day → Travel → Q&A → RSVP → Gallery → More (Our Story / Chambolle)`

- **Live countdown** to 12 November 2026, 17:00 HKT
- **Chambolle easter egg** — Pembroke Welsh Corgi pops up as you scroll
- **Personalised RSVP** — code-based, prefilled, returns the guest's table (seat numbers are never shown)
- **SVG map** of Tsim Sha Tsui with The Peninsula marked
- **Fully responsive** with touch swipe support

---

## Supabase tables

```
guests  — master guest list (roster snapshot 2026-08-31: 165 numbered guests + 2 preview rows; the live DB is the truth)
rsvp    — live form submissions from the website
```

Row-level security is enabled, and the final policy set gives the public **no** direct read on either table — the early "Public read guests" policy is dropped later in the same file. Anonymous visitors reach data only through the SECURITY DEFINER RPCs (`lookup_invitation`, `lookup_seats`, `submit_rsvp`, `lookup_my_table`), each of which is scoped to a single invitation code. Full read/write belongs to the two admin emails and the service role.

`guests` also carries a partial unique index on `guest_number` (the roster key) and one on `(table_number, seat_number)` (one guest per seat).

---

## Roster snapshot (seed as of 2026-08-31)

These are the couple's **pre-invitation expectations**, seeded into `guests.rsvp_status` — not replies. The real headcount is the `attendance_truth` view (website replies + answers recorded by an admin, preview rows excluded).

| | Count |
|-|-------|
| Numbered guests in the seed | 165 (+ 2 `[PREVIEW]` rows, never counted) |
| Expected Yes | 155 |
| Expected No | 3 |
| Pending | 7 |
| Venue capacity | 156 seats (13 tables × 12) |
| Headroom | 1 seat if every Expected Yes comes, −6 if all Pending say yes as well — confirm against `attendance_truth` and with the couple before seating |

---

## Pending before go-live

- [x] Run `supabase/schema_seed.sql` in the Supabase SQL Editor — schema deployed (verified 2026-08-17); roster regenerated from the live DB 2026-08-25, last updated 2026-08-31
- [x] Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` to Vercel env vars — injected via `/api/config.js`, demo mode off in production (verified 2026-08-17)
- [x] Add the Vercel domain to Supabase Auth → Site URL, and `seating-planner.html` to Redirect URLs — verified: the seating planner's magic link is in use
- [ ] Confirm `whatsapp-outreach.html` is also in Redirect URLs (it has its own magic-link gate) — not re-checked as of 2026-09-22; a failed sign-in on the outreach tool is the symptom
- [x] Pair couples onto shared codes via `pair_invitation()` — every row has a code; households share where wanted
- [x] Per-guest URL list — `whatsapp-outreach.html` renders and tracks every guest's link (sending progress lives in `outreach_status`)
- [x] Sign in to seating planner and assign tables/seats — in use
- [x] Upload pre-wedding photos to Gallery section — done 2026-08-12
- [ ] Confirm the pending guests (7)
- [ ] Decide on a contact route — the site currently has no `mailto:` / `tel:` / `wa.me` link anywhere (couple's choice, 2026-08-17)

---

*Built with Claude · Type: Besotted Love (licensed, embedded) + Liana + Cormorant Garamond + Raleway · Palette: Gardenia, Olive, Golden Fleece*
