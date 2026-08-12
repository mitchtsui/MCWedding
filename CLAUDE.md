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
| Script / Hero | `'Besotted Love'` (base64 `@font-face`, licensed OTF from the couple) | Used on the hero's "Christy & Mitchell" (`.hero-names`) and, since 2026-08-12, also on the footer's "Christy & Mitchell" (`.footer-script`, switched from Liana). Was on "Save the Date" until the two hero lines swapped roles on 2026-08-12 (same day the font was added) — see below. Falls back to `'Alex Brush'` (still CDN-loaded) if the embedded font ever fails. |
| Body / Headings | `'Cormorant Garamond'` | Serif, weight 300–600. Used for "Save the Date" (small caps label) since the swap — was previously used for "Christy & Mitchell". |
| Labels / Caps | `'Raleway'` | Sans-serif, spaced uppercase |

Note: `liana` (base64 `@font-face` from `liana.ttf`) is still embedded in the file and still used on `.rsvp-success .success-script` and `.seat-card-head .script` — do not remove the `@font-face` block. It has never been used on either hero line, and as of 2026-08-12 is no longer used on the footer either (moved to Besotted Love, see above).

**`Besotted Love`** is a licensed font (Mila Garret Studio, purchased on Creative Market), not a free Google Font — it can't be linked from a CDN. It's embedded the same way Liana is: base64 `@font-face` directly in `wedding-invitation.html`. The embedded copy is subsetted to printable ASCII only (`fonttools subset`, ~253 glyphs, all OpenType layout features retained) rather than the full 377-glyph original, since the hero only ever needs "Christy & Mitchell" plus headroom for a future wording tweak. Source file lives outside the repo (received from the couple as an upload, not committed) — if it needs re-subsetting, ask them for the `.otf` again.

**The hero's two lines swapped roles on 2026-08-12.** "Save the Date" was the big Besotted Love script and "Christy & Mitchell" was the small Cormorant Garamond caps label; now it's the other way round. The class names did not change — `.hero-script` is still the first line in the DOM and `.hero-names` the second, but `.hero-script` now means "small caps label" and `.hero-names` now means "big focal script," which is the opposite of what the names suggest. Don't rename the classes based on what they currently contain without also checking every rule below, since the fixes are keyed to font, not to class name.

⚠️ **Two non-obvious things Besotted Love requires that a normal script font wouldn't — do not remove either without re-measuring, and note both now live on `.hero-names`, not `.hero-script`:**

1. **`.hero-names` needs `padding-top: 0.48em`.** Besotted Love's own ascent metric is ~1.6em (vs. ~0.8em for a typical script font) — its big loops overshoot a `line-height: 1.05` line box at the top by about 0.44em, measured empirically against actual rendered glyph ink in headless Chromium (not derived from the font's stated metrics, which don't reliably predict visual overshoot). Without this padding, the loops render into the hero photo above. `#home` uses `min-height` not `height`, so a taller `.hero-names` just makes the section taller — it's safe to grow this if the copy or font ever changes again, just re-measure the overshoot first. This value is a font property (ascent metric), not a string property — it does not need re-deriving when the wording changes, only when the font does.
2. **Mobile `.hero-names` font-size is `clamp(1.5rem, 7.6vw, 3.35rem)`, desktop is `clamp(3.3rem, 7.6vw, 7rem)`.** These are specific to "Christy & Mitchell" (measures 11.36x font-size wide via canvas `measureText`) — different from the 8.75x ratio "Save the Date" measured at when Besotted Love was on that line. Unlike the ascent fix above, **width is a string property and must be re-measured any time the copy on whichever line carries Besotted Love changes.** Don't copy these numbers onto a different string without re-measuring first — that's exactly the mistake that caused the original mobile overflow bug this pattern is meant to prevent.

**`.footer-script` (footer "Christy & Mitchell", switched to Besotted Love 2026-08-12) does NOT need the `padding-top: 0.48em` overshoot fix above.** It has no explicit `line-height` set (base rule or the mobile override), so it uses the browser's default `line-height: normal`, computed from Besotted Love's own hhea ascent/descent (~1.6em + ~0.4em ≈ 2.0em) — generous enough on its own to contain the tall loops. The hero only needs the fix because `.hero-names` overrides `line-height` down to a tight `1.05`. Verified empirically in headless Chromium at both desktop and mobile widths: no overshoot into the Q&A divider above, no width clipping. If a `line-height` is ever added to `.footer-script`, re-check for overshoot.

### Key CSS Rules to Preserve
- Hero "Christy & Mitchell": `font-size: clamp(3.3rem, 7.6vw, 7rem)`, olive colour, **Besotted Love** font (moved here from "Save the Date" on 2026-08-12 per user request — the two lines swapped roles, see Typography above)
- Hero "Save the Date": `font-size: clamp(1.8rem,4vw,3rem)`, near-black `#1A1A14`, **Cormorant Garamond**, uppercase, letter-spacing 0.25em, weight 300 (moved here from "Christy & Mitchell" the same day — this is the exact styling "CHRISTY & MITCHELL" used to have)
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
- Photo band at the top — `photos/hero-paris.jpg`, height capped via `clamp()` rather than full-bleed. Added 2026-08-12 per user request. Text sits below the photo on solid ground, hard edge (no fade — removed 2026-08-12 per user request).
  - `hero-paris.jpg` is a 2000×1498 web export of `photos/gallery/20260609-ChristyandMitchParisPW-320.jpg` (the full-resolution original from the shoot). `photos/og-preview.jpg` is a separate, smaller 1200×630 crop of the *same photo*, used only for the social-share meta tags (`og:image`/`twitter:image`) — the two files now serve different purposes and both should stay.
  - An earlier attempt (2026-08-08, PR #52) used a different photo as a full-bleed `#home` background behind the text and was reverted the same day. This is a different approach: capped photo band above, text clear of it below.
  - **Important:** `.hero-photo` is `position: absolute`, so it sits outside `#home`'s flex flow — nothing about the flex layout guarantees the text won't ride up underneath it. `#home`'s `padding-top` is set to `var(--hero-photo-h)` (the same `clamp()` the photo's height uses) specifically to reserve that space, so the flex content area starts exactly at the photo's bottom edge regardless of `justify-content`. This is the real fix — don't decouple `padding-top` from `--hero-photo-h` again. There used to be a `::after` gradient fading the photo into the background; it incidentally hid an overlap that existed even before this fix (the gradient masked it, it didn't prevent it). Removed 2026-08-12 per user request, which is what surfaced the bug — changing "Our Wedding" to "Save the Date" in the same request just made the pre-existing overlap visible instead of causing it.
- "SAVE THE DATE" — small caps, Cormorant Garamond, weight 300, near-black. Text changed from "Our Wedding" 2026-08-12 (font was Alex Brush then, briefly Besotted Love, now Cormorant Garamond — see below). Sits below the photo band.
- "Christy & Mitchell" — Besotted Love (licensed, base64-embedded), olive, large script, mixed case (not uppercase — the font is a connected cursive script, uppercase with letter-spacing would break the swash connections). See the Typography section above for the two fixes (vertical overshoot, horizontal width) this font specifically requires.
  - **2026-08-12: these two lines swapped roles.** "Save the Date" was originally the big script and "Christy & Mitchell" the small caps label (matching how they read literally); the couple then asked for the opposite. The DOM order is unchanged — "Save the Date" is still first, "Christy & Mitchell" still second — only which font/size/case each one carries changed. Re-check the Typography section's ⚠️ block before touching either line's font-size or padding.
- "and Chambolle" — Rose Bisque, half size, with line rules
- Date / location — black, weight 800
- Countdown (live, 1s interval, tick animation) — Days / Hours / Minutes / Seconds
- **RSVP button** (`.rsvp-btn.hero-rsvp-btn`, links to `#rsvp`) — added 2026-08-12 per user request ("move the RSVP button to the first landing page"). Sits between the countdown and the "Scroll" hint. Reuses the same `.rsvp-btn` class the Wedding Day section's button used before that section was simplified (see 💒 Wedding Day below) — same look, new location, plus `.hero-rsvp-btn { margin-top: 1.6rem }` for its own spacing.
- Whole text block (both hero lines through countdown through the RSVP button and Scroll hint) is vertically centred in the space below the photo (`justify-content: center` on `#home`, changed from `flex-end` 2026-08-12 per user request — "move the whole text upwards"). `#home`'s `padding-top` still reserves exactly the photo's height either way, so centering distributes slack on both sides of the text block rather than only above it; it doesn't reopen the overlap risk.
- Wedding Day section background is now plain (`var(--bg)`, the gardenia page background) — the Peninsula Hotel watercolour illustration that used to sit behind it was removed 2026-08-12 per user request. See 💒 Wedding Day below.

#### 📖 Our Story
- Left: slideshow (5 photos, referenced from `photos/our-story/` as file paths — changed from base64 on 2026-08-08 per user request, so photos can be swapped by replacing files in that folder instead of re-embedding base64). Current files: IMG_9838.jpg, IMG_7830.jpg, IMG_0274.jpg, IMG_0318.jpg, IMG_5751.jpg.
  - To swap/add/remove a photo: drop the file into `photos/our-story/`, then add/edit/remove the matching `<div class="story-slide" style="background-image:url('photos/our-story/FILENAME')"></div>` + matching `<span class="dot">` in the `#story-slideshow` / `#story-dots` blocks in `wedding-invitation.html`. The JS (`goStorySlide`) already queries the DOM generically, so slide count isn't hardcoded elsewhere.
- Right: title, pull quote, body text
- Auto-advances every 4s, offset 2s from Chambolle slideshow
- Dot indicators

#### 🐕 Meet Chambolle
- Card layout: info left, slideshow right
- 4 photos (IMG_6864, IMG_8351, IMG_7152, IMG_5928) — base64 embedded
- Chambolle stat block removed

#### 💒 Wedding Day
- **2026-08-12: background image and eyebrow date removed per user request ("remove the picture at the back, the hotel image. leave it plain. Also remove the date").** The Peninsula watercolour illustration (base64 JPEG, previously `.wedding-bg-wrap`'s `background-image`) and its `rgba(237,230,216,0.72)` overlay are gone — `.wedding-bg-wrap` is now just a plain padding wrapper with no background of its own, so the section shows `#wedding-day`'s own `background: var(--bg)` (the gardenia page background), same as it always had underneath. The `Thursday, 12 November 2026` eyebrow that used to sit above the `Wedding <em>Day</em>` heading is also gone — the heading is now the first thing in the section. Verified empirically in headless Chromium at desktop and mobile widths: plain gardenia background, no eyebrow, heading/Venue/Attire/timeline all otherwise unchanged.
- **2026-08-12 (earlier same day): simplified.** The big "NOVEMBER 12 / HONG KONG" date grid and this section's own RSVP button were removed per user request ("remove the current RSVP page... it is not essential anymore"), referring to this section, not the actual `#rsvp` form (which is untouched). In their place: `<h2 class="section-title">Wedding <em>Day</em></h2>`, matching the heading pattern every other section uses.
- Venue: "The Salisbury Room at The Peninsula Hong Kong" + "Attire: Elegant Evening Attire" — kept exactly as before, per explicit user request.
- Timeline: 17:00–18:00 Guest Arrival / 18:30–19:30 Ceremony / 19:45–23:00 Dinner Reception — kept exactly as before.
- RSVP's entry point moved to the hero (see 🏠 Hero above) rather than living here.

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
- **Nav (≤700px): fixed bottom tab bar, not the top hamburger.** Changed 2026-08-12 per user request ("move the drop down hamburger list to bottom," matching a reference screenshot of an app-style bottom tab bar). The top `<nav>` is `display:none` entirely below 700px — not simplified, fully hidden — so the hero photo runs full-bleed to the very top of the screen on mobile, same as the reference. Desktop nav (the horizontal bar with the two dropdowns) is completely unchanged; this only affects ≤700px.
  - Bottom bar markup is `<div class="bottom-nav" id="bottom-nav">` — **must be a `<div>`, not a `<nav>` tag.** It was originally built as `<nav class="bottom-nav">`, which also matched the site's existing bare `nav { position:fixed; top:0; ... }` tag selector (for the TOP bar). With both `top:0` (inherited from the tag selector) and `bottom:0` (from the `.bottom-nav` class) applying to the same fixed element, it stretched to fill the entire viewport height instead of sitting as a slim bar at the bottom. Don't rename it back to `<nav>` without also giving it an explicit `top: auto` — or just leave it a `<div>`, which sidesteps the collision entirely.
  - 5 tabs: Home, Wedding Day ("Day"), Gallery, RSVP — each a plain `<a href="#section">` — plus a 5th **More** button (`<button id="more-tab" onclick="toggleMoreModal()">`) that opens `#more-modal`, a bottom-sheet-style overlay listing the four sections that don't have their own tab: Our Story, Chambolle, Travel, Q&A. Modal pattern copied from `.fp-modal` (the floor-plan modal) for visual consistency — fixed, backdrop, centred card, close button.
  - Active tab state piggybacks on the existing scroll-spy handler (the same `window.addEventListener('scroll', ...)` that already highlights the top nav's active link) — extended to also toggle `.active` on `.bottom-tab[data-tab]` elements matching the current section. The More button has no `data-tab`, so it's never marked active by scroll position — expected, not a bug.
  - **The Home tab's `active` class is hardcoded in the HTML** (`class="bottom-tab active"`), not left to JS — the scroll-spy handler only runs on an actual `scroll` event, so without this, no tab shows as active until the user scrolls at least once after page load. This matches the existing pattern already used on the top nav's Home link (`class="nav-link active"` is hardcoded there too) — don't remove it thinking JS will handle it on load, it won't.
  - The More button is a `<button>` (the other four are `<a>`) and picked up a native focus-ring outline that the `<a>` tabs don't get, making it look like a stray "active" state even when untouched. Fixed with `.bottom-tab { outline: none }` plus a proper `.bottom-tab:focus-visible` style so real keyboard navigation still shows a focus indicator — don't just strip the outline without adding that back.
  - `body { padding-bottom: 72px }` on mobile reserves room so the fixed bar never covers the last section's content.
  - The Chambolle easter-egg's mobile resting positions (`.chambolle-toggle` and all three `.chambolle-egg.pos-*` overrides) moved from `bottom: 14px` to `bottom: 84px` to clear the new bar — they used to sit exactly where the bottom-nav now lives. If the bar's height ever changes, re-check this clearance.
- All grids → single column
- Easter egg: 90px image, adjusted margins (see bottom-nav clearance note above)
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
- **Preserve the Liana `@font-face` block** — it is base64-embedded and still used on the RSVP success screen and seat-lookup card script text. Do not remove it. Liana has never been used on either hero line.
- **Preserve the Besotted Love `@font-face` block** — it's the only thing rendering "Christy & Mitchell" in script, both in the hero and (since 2026-08-12) the footer. If it's ever removed, the CSS falls back to Alex Brush (still CDN-loaded) rather than breaking, but that's a visual regression, not something to do on purpose. In the hero, `.hero-names` (not `.hero-script`) is the selector that uses it — see the Typography section's note on the two hero lines' swapped roles before changing either. In the footer, `.footer-script` uses it directly (switched from Liana 2026-08-12).
- **Always preserve the design tokens** in `:root {}`. Do not introduce new colours outside the palette.
- **Always copy the finished file** to `/mnt/user-data/outputs/wedding-invitation.html` after edits.
- **The Peninsula watercolour image was removed from the Wedding Day section 2026-08-12** per user request — the section background is now plain (`var(--bg)`). Do not re-add it without being asked.
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
| Fonts | Liana (base64, RSVP success/seat-card scripts only), Besotted Love (base64, licensed, hero + footer script), Alex Brush (CDN, hero fallback only) + Cormorant Garamond + Raleway (Google Fonts CDN) |
| Backend | Supabase (PostgreSQL + REST API) |
| Hosting | Static file host (e.g. Netlify, Vercel, or direct) |
| Seating Planner | Single-file HTML/CSS/JS (drag-and-drop, no framework) |
| RSVP Tracker | Excel (.xlsx) via openpyxl + pandas |
| Guest Seed | SQL (`supabase_schema_seed.sql`) or Node.js (`seed-guests.js`) |

---

*Last updated: May 2026 — covers full build session from April 29 through May 6, 2026.*
