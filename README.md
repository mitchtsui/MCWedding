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

### 2. Connect Supabase (for live RSVPs)

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema_seed.sql` in the Supabase SQL Editor
   - This creates both tables and seeds all 198 guests
3. Open `wedding-invitation.html` and replace:
   ```js
   const SUPABASE_URL  = 'YOUR_SUPABASE_URL'
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'
   ```
   with your actual project URL and anon key (found in Project Settings → API)

> Until credentials are added, the RSVP form runs in **demo mode** and simulates a successful submission without touching any database.

### 3. (Optional) Seed via Node.js

If you prefer seeding with JavaScript rather than SQL:

```bash
npm install @supabase/supabase-js
# Edit seed-guests.js — replace SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
node supabase/seed-guests.js
```

---

## Website sections

`Home → Our Story → Chambolle → Wedding Day → Travel → Gallery → Q&A → RSVP`

- **Live countdown** to 12 November 2026, 17:00 HKT
- **Chambolle easter egg** — Pembroke Welsh Corgi pops up as you scroll
- **RSVP form** — name, attendance, dietary requirements, song request, message
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

- [ ] Add Supabase credentials to `wedding-invitation.html`
- [ ] Run `supabase/schema_seed.sql`
- [ ] Upload pre-wedding photos to Gallery section
- [ ] Confirm 22 pending guests
- [ ] Assign table numbers (use `seating-planner.html`)

---

*Built with Claude · Design: Cormorant Garamond + Liana · Palette: Gardenia, Olive, Rose Bisque*
