# Christy & Mitchell — Wedding Website

**12 November 2026 · The Salisbury Room, The Peninsula Hong Kong**

---

## What's in this repo

| File | Description |
|------|-------------|
| `wedding-invitation.html` | Main wedding invitation website — fully self-contained single file |
| `seating-planner.html` | Drag-and-drop guest seating manager (15 tables × 12 seats) |
| `supabase/schema_seed.sql` | Supabase database schema + all 198 guests pre-seeded |
| `supabase/seed-guests.js` | Node.js alternative seed script |
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
   - Creates both tables, seeds all 198 guests, **and** generates a unique invitation code per guest, sets up RLS, and creates the public RPCs (`lookup_invitation`, `lookup_seats`, `submit_rsvp`).
   - The script is idempotent — safe to run multiple times.
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
4. Confirmation page shows table + seat number for everyone on that invitation, pulled via `lookup_seats`.
5. Guest can revisit the same URL anytime to see their seat or update their RSVP.
6. **You assign seats** in `seating-planner.html` (magic-link sign-in for `christychowtc@gmail.com` / `mitchell.tsui.mc@gmail.com`). Drag-drop persists `table_number` + `seat_number` to Supabase.
7. Plus-ones not on the master list appear in the `pending_plus_ones` view for manual placement.

The anon key never has direct read access to `guests` — it can only call the three SECURITY DEFINER RPCs, which return at most one household.

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

Row-level security is enabled. Public users can read `guests` and insert to `rsvp`.

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
