# Christy & Mitchell — Wedding Website

**12 November 2026 · The Salisbury Room, The Peninsula Hong Kong**

---

## What's in this repo

| File | Description |
|------|-------------|
| `wedding-invitation.html` | Main wedding invitation website — fully self-contained single file |
| `seating-planner.html` | Drag-and-drop guest seating manager (15 tables × 12 seats) |
| `whatsapp-outreach.html` | Admin tool: per-guest WhatsApp invitation links + outreach tracker |
| `supabase/schema_seed.sql` | Supabase database schema + all 198 guests pre-seeded |
| `supabase/seed-guests.js` | Node.js alternative seed script |
| `supabase/migrations/` | Standalone SQL you can run without re-seeding the roster |
| `CLAUDE.md` | Full project reference for AI-assisted development |

---

## Setup

### 1. Deploy the website

Both HTML files are **fully self-contained** — no build step, no dependencies, no CDN required for images (all assets are base64 embedded). Just host the HTML file anywhere:

- **Netlify / Vercel:** drag-and-drop `wedding-invitation.html`
- **GitHub Pages:** push to repo, enable Pages from `main` branch
- **Any static host:** upload the file directly

### 2. Connect Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema_seed.sql` in the Supabase SQL Editor
   - Creates both tables, seeds all 198 guests, **and** generates a unique invitation code per guest, sets up RLS, and creates the public RPCs (`lookup_invitation`, `lookup_seats`, `submit_rsvp`, `lookup_my_table`).
   - The script is idempotent — safe to run multiple times. The guest seed upserts on `guest_number` and never overwrites live RSVP, seating or outreach state. See [Updating the guest list](#updating-the-guest-list).
3. In Vercel → Project → **Settings → Environment Variables**, add:
   - `SUPABASE_URL` → `https://yourproject.supabase.co`
   - `SUPABASE_ANON_KEY` → the anon public JWT (starts `eyJ…`)

   Both values come from Supabase → Project Settings → API. Apply to all environments (Production / Preview / Development).
4. Redeploy on Vercel (or push any commit) so `/api/config.js` picks up the new vars.
5. In Supabase → **Authentication → URL Configuration**:
   - **Site URL** → your Vercel domain (e.g. `https://mcwedding.vercel.app`)
   - **Redirect URLs** → add `https://your-domain/seating-planner.html`

   Without this, the seating-planner magic link won't redirect correctly.

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

If you prefer seeding with JavaScript rather than SQL:

```bash
npm install @supabase/supabase-js
# Edit seed-guests.js — replace SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
node supabase/seed-guests.js
```

> The DB trigger auto-fills `invitation_code` for every new guest, so the seed script doesn't need to set it.

---

## RSVP & seating flow

1. **Each guest gets a personalised URL**: `https://[host]/?code=MC-XXXXX`
2. Guest opens the link → invitation looked up via `lookup_invitation` RPC → form prefills with their name (and household, for couples).
3. Guest submits RSVP → `submit_rsvp` RPC writes a row linked by `guest_id` and mirrors `rsvp_status` onto `guests`.
4. Confirmation page shows the table number for everyone on that invitation, pulled via `lookup_seats`. (Seat numbers are deliberately not displayed anywhere post-RSVP — they move until the final seating pass.)
5. Guest can revisit the same URL anytime to see their seat or update their RSVP.
6. **You assign seats** in `seating-planner.html` (magic-link sign-in for `christychowtc@gmail.com` / `mitchell.tsui.mc@gmail.com`). Drag-drop persists `table_number` + `seat_number` to Supabase.
7. `pending_plus_ones` still exists but no longer receives new rows — the RSVP form's plus-one field was removed on 2026-08-25, so a plus-one has to be added to the `guests` master list directly. Historical rows are still listed.
8. To move a whole table's worth of guests at once, install `supabase/migrations/swap_tables.sql` and call `SELECT swap_tables(1, 2);` — everyone swaps places, keeping their seat numbers. Dragging them one by one in the planner works too, but `guests` has a unique index on `(table_number, seat_number)`, so a bulk hand-written `UPDATE` collides; the function parks one side on a scratch number to get around it. Running a swap twice undoes it, and `SELECT * FROM table_occupancy;` shows who is where.

### What a guest can see of the seating plan

A guest sees **only their own table**. Opening "View Floor Plan" calls `lookup_my_table`, which returns the occupants of the table(s) that guest's own invitation is seated at and nothing else. Every other table is drawn on the plan for orientation — so they can find their way across the room — but is greyed out, not tappable, and carries no names. Guests who have RSVP'd "No" are excluded from the list, so the table doesn't show absences.

This replaces the earlier `lookup_all_table_assignments`, which handed the entire seating chart to anyone holding any valid code. That function is dropped by `schema_seed.sql`; re-running the file removes it.

The anon key never has direct read access to `guests` — it can only call the SECURITY DEFINER RPCs, which return at most one household (or, for the floor plan, one table).

---

## Updating the guest list

`supabase/schema_seed.sql` is the source of truth for **who is invited**. The database is the source of truth for **everything that happens to them** — RSVP status, dietary notes, table and seat, invitation code, outreach state.

> ⚠️ **If you have edited the `guests` table by hand in Supabase**, the seed file is now behind the database. Running the full `schema_seed.sql` will push the file's older `name` / `group_name` / `side` / `invited` / `is_kid` values back over your manual edits, and will re-add anyone you deleted. Before you run it, sync the file to reality with `supabase/migrations/export_roster_as_seed.sql`: it prints the live table as a ready-to-paste `VALUES` block (plus a few sanity queries for rows with no `guest_number` or no invitation code). Live state — RSVP, dietary, seats, codes, outreach — is never at risk either way.
>
> To apply a schema change **without** touching the roster at all, run the standalone file in `supabase/migrations/` instead of the full seed.

Editing the `VALUES` block and re-running the whole file is the intended workflow. The seed upserts on `guest_number`, so a re-run refreshes the roster columns (`name`, `group_name`, `side`, `invited`, `is_kid`) and leaves live state untouched. Guests keep their invitation codes and their seats.

**`guest_number` is the identity, not `name`.** 25 of the 198 rows share a name with another row — there are four separate `Anthony Yip and Family` rows, each standing for one seat. Never key anything off the name.

| Change | How |
|--------|-----|
| **Add a guest** | `SELECT next_guest_number();` for the next free number, append a row to the `VALUES` block, re-run the file. The DB trigger generates their invitation code automatically. |
| **Rename / regroup / fix a side** | Edit that `guest_number`'s row in place, re-run the file. |
| **Remove a guest** | `SELECT uninvite_guest(<guest_number>);` — deletes them and any RSVP rows, frees their seat — **then** delete their row from the `VALUES` block. Skipping the second step means the next re-run re-adds them. |
| **Change someone's RSVP by hand** | Do it in the database (Supabase Table Editor), not the seed file. The seed deliberately never overwrites `rsvp_status`. |
| **Bulk changes (10+ rows)** | Edit the `VALUES` block in your editor and re-run once. |
| **One or two quick changes** | Supabase Table Editor is faster, but mirror the edit back into the seed file or the two drift apart. |

Re-running `schema_seed.sql` is genuinely safe — verified by running it three times against a fresh Postgres with seats, RSVPs and outreach state in place, and diffing: guest count stayed at 200, live state byte-identical.

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
   - **Status** (Not Contacted / Sent / Responded / Bounced / Skip) — clicking the green "Send via WhatsApp" button auto-flips a guest from `Not Contacted` → `Sent` and stamps `outreach_sent_at`.
   - **Phone** — if filled, the WhatsApp link opens that contact directly (`wa.me/<phone>?text=…`); if blank, WhatsApp lets you pick the recipient.
   - **Notes** — free-text per guest.
   - **Mark household sent** — for couples on a shared invitation code, one click stamps everyone in the household.
4. Filters: search, status, RSVP, side (女方/男方), group, plus a **one-row-per-household** toggle so you don't message both halves of a couple.
5. `Export CSV` produces a snapshot of every guest with their URL and outreach state — handy as a backup or for sharing.

State persists in the `guests` table (`outreach_status`, `outreach_channel`, `outreach_sent_at`, `outreach_notes`, `phone`) via the same admin RLS policy as the seating planner. Re-running `schema_seed.sql` is idempotent and adds these columns if missing.

---

## Website sections

`Home → Our Story → Chambolle → Wedding Day → Travel → Gallery → Q&A → RSVP`

- **Live countdown** to 12 November 2026, 17:00 HKT
- **Chambolle easter egg** — Pembroke Welsh Corgi pops up as you scroll
- **Personalised RSVP** — code-based, prefilled, returns assigned seat
- **SVG map** of Tsim Sha Tsui with The Peninsula marked
- **Fully responsive** with touch swipe support

---

## Supabase tables

```
guests  — pre-seeded master guest list (198 guests)
rsvp    — live form submissions from the website
```

Row-level security is enabled, and the final policy set gives the public **no** direct read on either table — the early "Public read guests" policy is dropped later in the same file. Anonymous visitors reach data only through the SECURITY DEFINER RPCs (`lookup_invitation`, `lookup_seats`, `submit_rsvp`, `lookup_my_table`), each of which is scoped to a single invitation code. Full read/write belongs to the two admin emails and the service role.

`guests` also carries a partial unique index on `guest_number` (the roster key) and one on `(table_number, seat_number)` (one guest per seat).

---

## Guest stats (as of May 2026)

| | Count |
|-|-------|
| Total invited | 198 |
| Confirmed yes | 156 |
| Declined | 20 |
| Pending | 22 |
| Venue capacity | 180 seats |
| Seats remaining | 24 |

---

## Pending before go-live

- [ ] Run `supabase/schema_seed.sql` in the Supabase SQL Editor
- [ ] Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` to Vercel env vars
- [ ] Add the Vercel domain to Supabase Auth → Site URL + Redirect URLs
- [ ] Pair couples onto shared codes via `pair_invitation()`
- [ ] Generate the per-guest URL list (see SQL below) and distribute
- [ ] Sign in to seating planner and assign tables/seats
- [ ] Upload pre-wedding photos to Gallery section
- [ ] Confirm 22 pending guests

---

*Built with Claude · Design: Cormorant Garamond + Liana · Palette: Gardenia, Olive, Rose Bisque*
