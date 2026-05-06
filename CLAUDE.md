# CLAUDE.md — Christy & Mitchell Wedding Project

> **Purpose:** This document is the single source of truth for all work related to Christy & Mitchell's wedding. It tells Claude everything it needs to know to pick up any task without re-explaining context.

---

## 1. Event Details

| Field | Value |
|-------|-------|
| **Couple** | Christy & Mitchell |
| **Date** | Thursday, 12 November 2026 |
| **Venue** | The Salisbury Room, The Peninsula Hong Kong |
| **Address** | Salisbury Road, Tsim Sha Tsui, Kowloon, Hong Kong |
| **Schedule** | 17:00–18:00 Guest Arrival · 18:30–19:30 Ceremony · 19:45–23:00 Dinner Reception |
| **Attire** | Elegant Evening Attire |
| **RSVP Deadline** | 12 September 2026 |
| **Corgi** | Chambolle — Pembroke Welsh Corgi, named after the Burgundy village. Chief Morale Officer. NOT attending (Peninsula's no-Corgi policy). Lives at 2 Merino Gardens. Expects stinky treats on return. |

---

## 2. Project Files

All active files live at these paths. Always edit in-place; never create duplicates.

| File | Location | Description |
|------|----------|-------------|
| `wedding-invitation.html` | `/home/claude/` → outputs | Main invitation website (single HTML file) |
| `seating-planner.html` | `/home/claude/` → outputs | Drag-and-drop seating manager |
| `RSVP_Master_Tracker.xlsx` | outputs | Excel guest tracker (4 sheets) |
| `supabase_schema_seed.sql` | outputs | Supabase schema + all 198 guests seed |
| `seed-guests.js` | outputs | Node.js alternative seed script |
| `RSVP_.xlsx` | `/mnt/user-data/uploads/` | Original raw guest list (source of truth) |

---

## 3. Design System

### Colour Palette (CSS Variables)
```css
--gardenia:    #EDE6D8   /* page background */
--golden:      #E8C97E   /* accent / highlights */
--rose-bisque: #B89AA4   /* deepened rose, used for "and Chambolle" line */
--pale-peach:  #F4C3A8   /* soft accent */
--olive:       #686B38   /* primary text, buttons, headers */
--sea-spray:   #6A7A5A   /* button hover */
--text:        #1A1A14   /* near-black body text */
--text-mid:    #5A4E45   /* secondary text */
--text-light:  #8A7E77   /* captions, labels */
--divider:     #C8BFB2   /* borders, dividers */
```

### Typography
| Role | Font | Notes |
|------|------|-------|
| Script / Hero | `liana` (weight 400) | Embedded as base64 `@font-face` from `liana.ttf`. No Adobe kit needed. |
| Body / Headings | `'Cormorant Garamond'` | Serif, weight 300–600 |
| Labels / Caps | `'Raleway'` | Sans-serif, spaced uppercase |

### Key CSS Rules to Preserve
- Hero "Our Wedding": `font-size: clamp(4rem,9vw,7rem)`, olive colour, Liana font
- "CHRISTY & MITCHELL": near-black `#1A1A14`, Cormorant Garamond, weight 300
- "and Chambolle": Rose Bisque `#B89AA4`, half font size, centred with line rules
- Date line "NOVEMBER 12, 2026 · HONG KONG": black `#1A1A14`, weight 800
- All section dividers: gradient line rules (`linear-gradient(to right, transparent, var(--divider), transparent)`)
- No decorative SVG grape/vine elements (removed)

---

## 4. Website (`wedding-invitation.html`)

### Section Order
`Home → Our Story → Chambolle → Wedding Day → Travel → Gallery → Q&A → RSVP`

### Section Status

#### 🏠 Hero
- "Our Wedding" in Liana, olive, large script
- "CHRISTY & MITCHELL" — Cormorant Garamond, weight 300, near-black
- "and Chambolle" — Rose Bisque, half size, with line rules
- Date / location — black, weight 800
- Countdown (live, 1s interval, tick animation) — Days / Hours / Minutes / Seconds
- Peninsula Hotel watercolour illustration as background of Wedding Day section

#### 📖 Our Story
- Left: slideshow (5 photos: IMG_9838, IMG_7830, IMG_0274, IMG_0318, IMG_5751 — all base64 embedded, HEIC→JPEG converted)
- Right: title, pull quote, body text
- Auto-advances every 4s, offset 2s from Chambolle slideshow
- Dot indicators

#### 🐕 Meet Chambolle
- Card layout: info left, slideshow right
- 4 photos (IMG_6864, IMG_8351, IMG_7152, IMG_5928) — base64 embedded
- Chambolle stat block removed

#### 💒 Wedding Day
- Peninsula watercolour illustration as background (`Gemini_Generated_Image_a7h4cya7h4cya7h4.png`, base64)
- Overlay: `rgba(237,230,216,0.72)`
- NOVEMBER 12 / HONG KONG grid, RSVP button centred below
- Venue: "The Salisbury Room at The Peninsula Hong Kong" + "Attire: Elegant Evening Attire"
- Timeline: 17:00–18:00 Guest Arrival / 18:30–19:30 Ceremony / 19:45–23:00 Dinner Reception

#### ✈️ Travel
- Google Maps embed (no API key)
- Apple Maps + Get Directions buttons
- MTR/taxi tips

#### 🖼 Gallery
- 3-column grid, placeholder tiles
- Lightbox with keyboard navigation (←→, Esc)
- Touch swipe support
- **⚠️ Pending:** actual pre-wedding photos not yet uploaded

#### ❓ Q&A (Accordion)
- 5 questions, single-open accordion
- RSVP deadline: September 12, 2026
- Chambolle answer: "he", "his little castle in 2 Merino Gardens", **"stinky treats"** (confirmed)

#### 📬 RSVP Form
- Supabase REST API integration
- Fields: name, email, attendance toggle, plus-one, dietary, **song request** (live band), message
- `song_request` included in payload — Supabase column needed
- **⚠️ Pending:** Replace `YOUR_SUPABASE_URL` / `YOUR_SUPABASE_ANON_KEY`
- Demo mode active (simulates success when no real URL)

### Chambolle Easter Egg
Three fixed-position pop-up instances triggered by IntersectionObserver:

| ID | Class | Edge | Animation | Resting Position |
|----|-------|------|-----------|-----------------|
| `egg-br` | `pos-br` | Bottom | Slides up from below | `bottom: 20px; right: 20px` |
| `egg-bl` | `pos-bl` | Left | Slides in from left | `bottom: 38%; left: 20px` |
| `egg-r` | `pos-r` | Right | Slides in from right | `top: 38%; right: 20px` |

- All 4 edges of image fully visible when popped (no clipping)
- Image: watercolour Chambolle portrait, `width: 130px`, `border-radius: 8px`, white border, drop shadow
- Speech bubble positions smartly based on which egg it is
- 9 rotating quips, last one: "stinky treats"
- Trigger schedule:
  ```js
  ['chambolle',    'egg-br', 1200],
  ['wedding-day',  'egg-r',  900],
  ['rsvp',         'egg-bl', 1500],
  ['qa',           'egg-br', 800],
  ['gallery',      'egg-r',  1000],
  ```

### Mobile Responsive
- `@media (max-width: 700px)` and `@media (max-width: 390px)`
- Nav: horizontal scroll strip
- All grids → single column
- Easter egg: 90px image, adjusted margins
- Touch swipe on slideshows + lightbox
- PWA meta: `theme-color`, `apple-mobile-web-app-capable`

---

## 5. Seating Planner (`seating-planner.html`)

- 15 tables × 12 seats
- Left sidebar: add/remove/search guests, seated vs unassigned counts
- Round table SVG with seat dots
- Drag from sidebar → table, between tables, back to sidebar
- Rename tables, View Summary modal, Clear All, Print

---

## 6. RSVP / Guest Management

### Guest List Stats (from `RSVP_.xlsx`, 198 guests)
| Status | Count |
|--------|-------|
| ✅ Confirmed Yes | 156 |
| ❌ Declined | 20 |
| ⏳ Pending | 22 |
| 女方 (Christy's side) confirmed | 100 |
| 男方 (Mitchell's side) confirmed | 56 |
| Kids | 4 |
| Dietary requirements | 5 |
| Seats remaining (180 cap) | 24 |

### Excel Tracker Sheets (`RSVP_Master_Tracker.xlsx`)
1. **📋 Guest List** — full cleaned list, RSVP dropdown (Yes/No/Pending), Table # dropdown (1–15), conditional colour coding by status and side
2. **📊 Dashboard** — headcount cards, by-group breakdown, seating capacity summary
3. **🍽 Dietary** — 5 guests with dietary restrictions isolated
4. **🪑 Tables** — 15 table blocks (12 seats each), ready to assign

### Data Cleaning Applied
- `Kenneth Fuck` → **Kenneth Fung**
- `Jennifer Yu & Claire` split into: **Jennifer Yu** (Yes) + **Claire Yu** (Pending)
- `(?)` suffix stripped from all names; status set to Pending

### Supabase Schema
Two tables in `supabase_schema_seed.sql`:

```sql
guests (id, guest_number, name, group_name, side, invited, rsvp_status, dietary, is_kid, table_number)
rsvp   (id, name, email, attendance, plus_one_name, dietary, song_request, message, submitted_at)
```

- RLS enabled on both tables
- Public can read `guests`, insert to `rsvp`
- Service role has full access
- **⚠️ Pending:** Run SQL in Supabase dashboard; add credentials to `wedding-invitation.html` and `seed-guests.js`

---

## 7. Pending / TODO

| Priority | Item | Notes |
|----------|------|-------|
| 🔴 HIGH | Add Supabase URL + anon key to `wedding-invitation.html` | Replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` |
| 🔴 HIGH | Run `supabase_schema_seed.sql` in Supabase dashboard | Creates tables + seeds all 198 guests |
| 🟡 MED | Add `song_request` column to Supabase `rsvp` table | Already in form payload |
| 🟡 MED | Upload pre-wedding photos to Gallery section | Placeholder tiles currently showing |
| 🟡 MED | Confirm/resolve Pending guests (22 outstanding) | See Guest List tab in tracker |
| 🟡 MED | Assign Table # for confirmed guests | Use seating planner + tracker |
| 🟢 LOW | Website design revisit (planned) | Full design pass deferred to later |
| 🟢 LOW | Test RSVP form end-to-end once Supabase connected | Demo mode currently active |

---

## 8. Instructions for Claude

### When working on the website
- **Always edit `/home/claude/wedding-invitation.html` in place.** Never create `wedding-invitation-v2.html` or similar.
- **Always preserve the Liana font** — it is base64-embedded. Do not replace with Google Fonts.
- **Always preserve the design tokens** in `:root {}`. Do not introduce new colours outside the palette.
- **Always copy the finished file** to `/mnt/user-data/outputs/wedding-invitation.html` after edits.
- **The Peninsula watercolour image** is base64 in the Wedding Day section — do not remove it.
- **The Chambolle photos** are base64 embedded — do not remove them.
- When adding sections, follow the existing section pattern: `<section id="x"><div class="container">...</div></section>`.
- Scrolling reveal: add `class="reveal"` to new elements — the IntersectionObserver handles the rest.

### When working on the seating planner
- Always edit `/home/claude/seating-planner.html` in place.
- Keep 15 tables × 12 seats as the fixed structure.

### When working on the Excel tracker
- Always use the cleaned data — do not re-read the raw `RSVP_.xlsx` directly as source of truth (it has uncleaned entries).
- Always use openpyxl for formatting/formulas; pandas for data operations.
- Run `scripts/recalc.py` after adding formulas.

### When working on Supabase
- The `guests` table is the master list (pre-seeded).
- The `rsvp` table is for website form submissions.
- Use the service role key for admin/seed operations, anon key for the public website.
- Never expose the service role key in the frontend HTML.

### General rules
- Do not invent new design decisions — check this document first.
- If something is marked ⚠️ Pending, flag it rather than guessing.
- Chambolle details: Pembroke Welsh Corgi, 3 years old, male, named after Chambolle-Musigny village in Burgundy. Lives at 2 Merino Gardens. Expects **stinky** (not sticky) treats.
- The RSVP deadline is **12 September 2026**.
- When referencing the venue, always use the full name: **The Salisbury Room at The Peninsula Hong Kong**.

---

## 9. Tech Stack Reference

| Layer | Technology |
|-------|-----------|
| Website | Single-file HTML/CSS/JS (no framework, no build step) |
| Fonts | Liana (base64), Cormorant Garamond + Raleway (Google Fonts CDN) |
| Backend | Supabase (PostgreSQL + REST API) |
| Hosting | Static file host (e.g. Netlify, Vercel, or direct) |
| Seating Planner | Single-file HTML/CSS/JS (drag-and-drop, no framework) |
| RSVP Tracker | Excel (.xlsx) via openpyxl + pandas |
| Guest Seed | SQL (`supabase_schema_seed.sql`) or Node.js (`seed-guests.js`) |

---

*Last updated: May 2026 — covers full build session from April 29 through May 6, 2026.*
