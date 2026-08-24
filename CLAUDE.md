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
| **Schedule** | 17:00–18:00 Guest Arrival · 18:30–19:30 Ceremony · 20:00–23:00 Dinner Reception |
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
2. **Mobile `.hero-names` font-size is `clamp(1.5rem, 7.6vw, 3.35rem)`, desktop is `clamp(2.4rem, 5vw, 4.5rem)`** (desktop shrunk 2026-08-13, was `clamp(3.3rem, 7.6vw, 7rem)` — see "Desktop hero rebalance" below). These are specific to "Christy & Mitchell" (measures 11.36x font-size wide via canvas `measureText`) — different from the 8.75x ratio "Save the Date" measured at when Besotted Love was on that line. Unlike the ascent fix above, **width is a string property and must be re-measured any time the copy on whichever line carries Besotted Love changes.** Don't copy these numbers onto a different string without re-measuring first — that's exactly the mistake that caused the original mobile overflow bug this pattern is meant to prevent. The 2026-08-13 desktop shrink only lowered the clamp's numeric bounds (same string, same vw-scaling approach) — it made the rendered text strictly narrower at every breakpoint above 700px than before, so it carried no overflow risk and needed no re-measurement.

**`.footer-script` (footer "Christy & Mitchell", switched to Besotted Love 2026-08-12) does NOT need the `padding-top: 0.48em` overshoot fix above.** It has no explicit `line-height` set (base rule or the mobile override), so it uses the browser's default `line-height: normal`, computed from Besotted Love's own hhea ascent/descent (~1.6em + ~0.4em ≈ 2.0em) — generous enough on its own to contain the tall loops. The hero only needs the fix because `.hero-names` overrides `line-height` down to a tight `1.05`. Verified empirically in headless Chromium at both desktop and mobile widths: no overshoot into the Q&A divider above, no width clipping. If a `line-height` is ever added to `.footer-script`, re-check for overshoot.

### Key CSS Rules to Preserve
- Hero "Christy & Mitchell": `font-size: clamp(2.4rem, 5vw, 4.5rem)` on desktop (shrunk 2026-08-13, was `clamp(3.3rem, 7.6vw, 7rem)` — see "Desktop hero rebalance" below), `clamp(1.5rem, 7.6vw, 3.35rem)` on mobile (unchanged), olive colour, **Besotted Love** font (moved here from "Save the Date" on 2026-08-12 per user request — the two lines swapped roles, see Typography above)
- Hero "Save the Date": `font-size: clamp(1.4rem, 2.6vw, 2rem)` on desktop (shrunk 2026-08-13, was `clamp(1.8rem,4vw,3rem)`), near-black `#1A1A14`, **Cormorant Garamond**, uppercase, letter-spacing 0.25em, weight 300 (moved here from "Christy & Mitchell" the same day — this is the exact styling "CHRISTY & MITCHELL" used to have)
- "and Chambolle": `#7A5A66` (deepened 2026-08-17 — `#B89AA4` measured 2.06:1 on Gardenia and failed AA), half font size, centred with line rules
- Date line "NOVEMBER 12, 2026 · HONG KONG": black `#1A1A14`, weight 800
- All section dividers: gradient line rules (`linear-gradient(to right, transparent, var(--divider), transparent)`)
- No decorative SVG grape/vine elements (removed)

---

## 4. Website (`wedding-invitation.html`)

### Responsive — desktop + mobile (the phone-width frame was removed)
**2026-08-17, per user request** ("Right now it's mobile only across all platform, go back to desktop + mobile responsive"). This reverses the 2026-08-13 change that locked the whole site into a 430px phone-width column at every browser width. On a 1574px viewport that column left **1144px (73%) of the screen unused**, and it was the only reason several desktop-only defects were invisible.

**What the revert consisted of** (all of it is mechanical and is worth knowing if it is ever reconsidered):
- `#site-frame` is still in the DOM but is now a **transparent full-width pass-through** — no `max-width`, no `container-type`. It is kept, not deleted, because CSS and JS still assume the nesting, and `body` relies on being its parent.
- **All 7 `@container (max-width: …)` blocks were converted back to `@media`**, so breakpoints key off the real viewport again. This is the load-bearing half of the revert: un-capping the width alone would have changed nothing, because `@container` would still have been measuring `#site-frame`.
- **All `cqw` units reverted to `vw`** inside every `clamp()` (13 declarations). ⚠️ Do this by exact `clamp(...)` literal, never a blind text replace — the base64 image blobs in this file contain the letters `cqw` and a global substitution silently corrupts image data.
- **`position: fixed` elements went back to plain viewport positioning**: `inset: 0` for `.lightbox` / `.fp-modal`, `left:0;right:0` for `nav` and `.bottom-nav`. The `--frame-gap` offsets on the Chambolle egg/toggle went back to a flat `14px`.
- `--frame-max` / `--frame-gap` still exist in `:root` but are neutralised (`none` / `0px`) so any stray reference resolves harmlessly. **Do not reintroduce a width cap through them.**

⚠️ **Two things that must not come back on `#site-frame`:** `container-type` (breaks every desktop breakpoint) and any `transform` (a transformed ancestor becomes the containing block for `position:fixed` descendants, which strands the bottom tab bar thousands of px down the page — tried Aug 2026, reverted).

**Verified empirically** (local server, one clean page load per width, measuring the real document): iPhone SE 375, iPhone 15/16 393, iPhone 16 Pro Max 440, Galaxy S24 360, Galaxy S24 Ultra 384, Galaxy Z Fold cover 344, iPad Mini 744, iPad Pro 11 834, laptop 1280, desktop 1559. At every width: **zero horizontal overflow**, correct nav swap at the 700px boundary, and no text rendering below 11px. Note the harness measures ~15px narrower than each nominal width because it includes a scrollbar, so the real devices have slightly more room than the numbers above.

### Section Order
**2026-08-17: reorganized again**, to get essential logistics out from behind an "optional" label. Was `Home → RSVP → Wedding Day → Gallery → More (Our Story / Chambolle / Travel / Q&A)`. Now:

`Home → Wedding Day → Travel → Q&A → RSVP → Gallery → More (Our Story / Chambolle)`

**Why:** Travel (how to reach The Peninsula) and Q&A (RSVP deadline, plus-one policy) had been nested five levels deep inside `#more`, in accordion panels that are **collapsed by default**, under a heading reading *"Totally Optional / Feel Free to Scroll Past"*. Reaching the venue directions took three interactions past a heading that explicitly told guests to skip it. Both are now top-level sections with their own nav entries. `#more` keeps only Our Story and Meet Chambolle, which genuinely are optional — so its "Totally Optional" framing is now accurate rather than misleading.

The four nested sections' internal markup was **moved, not rewritten** (same ids, same content, de-indented). Reading order is now: what/when/where → how to get there → your questions → reply → photos → optional extras.

⚠️ **Do not move anything a guest needs in order to attend back into `#more`.**

### Section Status

#### 🏠 Hero
- Photo band at the top — `photos/hero-paris.jpg`, height capped via `clamp()` rather than full-bleed. Added 2026-08-12 per user request. Text sits below the photo on solid ground, hard edge (no fade — removed 2026-08-12 per user request).
  - `hero-paris.jpg` is a 2000×1498 web export of `photos/gallery/20260609-ChristyandMitchParisPW-320.jpg` (the full-resolution original from the shoot). `photos/og-preview.jpg` is a separate, smaller 1200×630 crop of the *same photo*, used only for the social-share meta tags (`og:image`/`twitter:image`) — the two files now serve different purposes and both should stay.
  - An earlier attempt (2026-08-08, PR #52) used a different photo as a full-bleed `#home` background behind the text and was reverted the same day. This is a different approach: capped photo band above, text clear of it below.
  - **Important:** `.hero-photo` is `position: absolute`, so it sits outside `#home`'s flex flow — nothing about the flex layout guarantees the text won't ride up underneath it. `#home`'s `padding-top` is set to `var(--hero-photo-h)` (the same `clamp()` the photo's height uses) specifically to reserve that space, so the flex content area starts exactly at the photo's bottom edge regardless of `justify-content`. This is the real fix — don't decouple `padding-top` from `--hero-photo-h` again. There used to be a `::after` gradient fading the photo into the background; it incidentally hid an overlap that existed even before this fix (the gradient masked it, it didn't prevent it). Removed 2026-08-12 per user request, which is what surfaced the bug — changing "Our Wedding" to "Save the Date" in the same request just made the pre-existing overlap visible instead of causing it.
  - **2026-08-13: Desktop hero rebalance, per user request** ("the landing page photo was halved. Let's adjust the text on the first home page to smaller size, so that the photo can be shown like the mobile view"). On desktop the photo is an `<img>` with `object-fit: cover` inside a band whose height (`--hero-photo-h`) was much shorter relative to viewport *width* than on mobile — `hero-paris.jpg` is landscape (2000×1498), so at a wide desktop viewport `cover` had to crop the *top and bottom* far more aggressively than at a narrow mobile viewport to fill the same short, wide band (up to ~62% of the photo's height was being cropped away at 1440px wide, vs. mild ~9% side-cropping on mobile at the old sizing) — the photo read as "halved". Fixed by increasing `--hero-photo-h` (desktop only, mobile's own media-query override at 700px is untouched) from `clamp(260px, 46vh, 520px)` to `clamp(340px, 62vh, 680px)`, and shrinking the desktop-only sizing/spacing of everything below the photo to compensate, so the whole hero still fits without excess scrolling: `.hero-script` font-size `clamp(1.8rem,4vw,3rem)` → `clamp(1.4rem,2.6vw,2rem)`; `.hero-names` font-size `clamp(3.3rem,7.6vw,7rem)` → `clamp(2.4rem,5vw,4.5rem)` (see the Typography section's ⚠️ block for why this particular change needed no width re-measurement); `.hero-chambolle` font-size `clamp(0.9rem,2vw,1.5rem)` → `clamp(0.85rem,1.4vw,1.2rem)`; and smaller margin-top/gap/font-size trims across `.hero-meta`, `.countdown`, `.countdown-number`, `.countdown-sep`, `.hero-scroll-hint`, and `.hero-rsvp-btn` (now `margin-top: 1.2rem`, was `1.6rem`). Mobile's own hero sizing (inside the `@media max-width:700px` block) was not touched — it was already the target look this change was matching on desktop. Verified via Playwright at 1024×768, 1366×768, 1440×900, and 1920×1080: photo shows meaningfully more of the couple at every size, no horizontal overflow, full hero content still fits within or just past one viewport height.
- "SAVE THE DATE" — small caps, Cormorant Garamond, weight 300, near-black. Text changed from "Our Wedding" 2026-08-12 (font was Alex Brush then, briefly Besotted Love, now Cormorant Garamond — see below). Sits below the photo band.
- "Christy & Mitchell" — Besotted Love (licensed, base64-embedded), olive, large script, mixed case (not uppercase — the font is a connected cursive script, uppercase with letter-spacing would break the swash connections). See the Typography section above for the two fixes (vertical overshoot, horizontal width) this font specifically requires.
  - **2026-08-12: these two lines swapped roles.** "Save the Date" was originally the big script and "Christy & Mitchell" the small caps label (matching how they read literally); the couple then asked for the opposite. The DOM order is unchanged — "Save the Date" is still first, "Christy & Mitchell" still second — only which font/size/case each one carries changed. Re-check the Typography section's ⚠️ block before touching either line's font-size or padding.
- "and Chambolle" — Rose Bisque, half size, with line rules
- Date / location — black, weight 800
- Countdown (live, 1s interval, tick animation) — Days / Hours / Minutes / Seconds
- **RSVP button** (`.rsvp-btn.hero-rsvp-btn`, links to `#rsvp`) — added 2026-08-12 per user request ("move the RSVP button to the first landing page"). Sits between the countdown and the "Scroll" hint. Reuses the same `.rsvp-btn` class the Wedding Day section's button used before that section was simplified (see 💒 Wedding Day below) — same look, new location, plus `.hero-rsvp-btn { margin-top: 1.2rem }` for its own spacing (trimmed from `1.6rem` 2026-08-13, see the desktop hero rebalance note above).
- Whole text block (both hero lines through countdown through the RSVP button and Scroll hint) is vertically centred in the space below the photo (`justify-content: center` on `#home`, changed from `flex-end` 2026-08-12 per user request — "move the whole text upwards"). `#home`'s `padding-top` still reserves exactly the photo's height either way, so centering distributes slack on both sides of the text block rather than only above it; it doesn't reopen the overlap risk.
- Wedding Day section background: plain gardenia (`var(--bg)`) for a few hours on 2026-08-12 after the Peninsula Hotel watercolour was removed, then given a new background the same day — a garden/floral illustration with Chambolle in it (`photos/wedding-day-garden.png`). See 💒 Wedding Day below.

#### 📬 RSVP Form
- **2026-08-13: moved to 2nd position** (right after Hero), per the section-order reorg — was previously last in the DOM, after Q&A. Internals untouched.
- Supabase REST API integration
- Fields: name, email, **contact number / WhatsApp** (added 2026-08-13, `#f-phone`, `type="tel"`), attendance toggle, plus-one, dietary, **song request** (live band), message
- `song_request` included in payload — Supabase column needed
- `phone` included in payload as of 2026-08-13 (`p_phone` in the `submit_rsvp` RPC call). **✅ Applied to the live DB 2026-08-17** via `supabase/migrations/2026-08-17_submit_rsvp_phone.sql` — until then EVERY submit failed with PGRST202 (the live function still had the old 8-param signature) and guests saw "Something went wrong". Verified live: 9-param signature answers 200, old 8-param overload removed.
- ⚠️ **Dashboard SQL editor lesson (2026-08-17):** its statement splitter can break inside plpgsql function bodies — the first attempt committed the `DROP FUNCTION` but failed the `CREATE`, leaving production with **no** `submit_rsvp` at all for a few minutes. When pasting function DDL into the dashboard: fresh query tab, nothing selected when you hit Run, no interleaved comments, named dollar tag (`$fn$`). Safer still: `psql` with the session-pooler connection string.
- ✅ Credentials are injected at runtime by `/api/config.js` from Vercel env vars (verified live 2026-08-17) — nothing to replace in the HTML.
- Demo mode active (simulates success when no real URL)
- The section's own dedicated `<style>` block (RSVP states + the floor-plan-modal CSS it triggers into) lives immediately before `<section id="rsvp">` in the file — moved together with the section during the reorg so the two stay co-located for anyone editing RSVP CSS.
- **Floor-plan SVG matches the Peninsula's real Salisbury Room / Foyer plan (2026-08-17, refined same night per the couple).** Geometry traced from the hotel's own floor plan (`SynologyDrive/MC Wedding/034ec716….png`, 0.82 scale, same orientation): **15 tables** — Room holds 11·9 (flanking a centred 12ft × 8ft stage), 10·6·3·7, 8·2·1·5; Foyer holds 12·13, 15, 16·17. **Tables 4 and 14 are deliberately skipped** (numbering superstition — this is correct, don't "fix" it). **The two spaces are ONE connected outline** — an upside-down 凸 `<path class="fp-wall">` (wide Room above, narrower Foyer below, no dividing wall), with the foyer's unused right corridor trimmed (foyer x 205–575). Per the couple: no mock cake, no pillar blocks, and **every TV is a thin 8px strip straddling its wall** (same treatment as the built-in screens on the top wall) — top-right shoulder, foyer right wall, two mirror TVs on the foyer left wall. **Two shaded structural columns** (`fp-column`, 50% grey) sit at the open Room/Foyer boundary — the plan's shady blocks offset behind tables 2 and 1; they are what actually stands where the removed wall was, and the Room's built-in TV hangs on the column behind table 1. Reception furniture removed (2026-08-17, couple's request). The invented "LIVE BAND" box is gone (not on the real plan). Verified programmatically: all 15 seat rings clear each other, every ring inside the 凸 outline, no ring touches stage/TVs/furniture; also verified rendered in-browser (demo code, table highlighted, occupants panel working). Style classes unchanged (`fp-frame`/`fp-stage`/`fp-table`/`fp-seat-dots` + `fp-wall`/`fp-fixture`/`fp-label`/`fp-area-label`). **Tables 16/17 are new to the site** — the lock/unlock and occupant JS is generic (`data-table` driven), nothing else needed updating.
- **Post-submit scroll (2026-08-17):** `scrollRsvpIntoView()` runs after a successful submit and on "Update my RSVP" — the form is much taller than the seat card, so after the swap the viewport used to sit below the card's heading ("You're All Set" cut off at the top). Honours `scroll-margin-top` and `prefers-reduced-motion`. Deliberately NOT called on page load.

##### Seat Card (post-RSVP confirmation / re-lookup, `#seat-card`)
- **2026-08-13: copy updated per user request.**
  - Script heading "Your Seat" → **"You're All Set"** (Liana font, `.seat-card-head .script`). The longer phrase no longer fit on one line at the original `font-size: 3rem` — measured via canvas `measureText` at ~293px wide against a ~287–294px available width inside the card (card width minus its own padding), right at the edge, and it wrapped mid-phrase ("You're All" / "Set"). Shrunk to `2.75rem` (~268px), comfortably one line. **Re-measure again if this copy changes** — same string-specific sizing caveat as the hero's Besotted Love text (see Typography above), just a different font/element.
  - Venue line forced onto two lines: `The Salisbury Room<br>The Peninsula Hong Kong` (was one line with a `·` separator, which wrapped at an arbitrary point on narrow widths). Plain `<br>`, not the conditional `.venue-break` pattern used elsewhere — no need for a desktop-only single-line variant now that the site is always mobile-width (see Site Frame).
  - Added a second `.seat-card-note` line: *"Please check back roughly two weeks before the big day — Christy may make some final adjustments to the seating plan."* Sits below the existing "Seats are pre-arranged..." note — both share the same class, so they stack with consistent spacing automatically.
- Verified via Playwright (seat card forced into view with fake `renderSeatCard()` data, since it normally only renders after a live Supabase round-trip): "You're All Set" renders on one line, venue renders on two, both new/existing notes display correctly, at both real mobile width (390px) and the desktop-as-frame view.

#### 💒 Wedding Day
- **2026-08-17: rebuilt as the invitation itself.** Per user request: *"there's wedding-day-garden image with similar info again, and totally different typo style. I hate this… Just because our wedding card is in that style, doesn't mean we need to put an 'image' on it. Think of ways to incorporate elements from our wedding card."*

  **What was wrong:** `photos/wedding-day-garden.png` (a **2135 KB** PNG — 40% of the whole page's bytes) was used as a full-bleed background with the section heading, venue and attire set on top of it. Three separate problems: (1) it restated venue/date the RSVP seat card already gave, (2) text-over-image produced a second type system that matched nothing else, (3) the PNG's alpha channel was **100% opaque** — 2MB spent on a channel that did nothing.

  **What it is now:** an `.invite-card` — the printed invitation rebuilt in HTML/CSS/inline SVG from the card's own vocabulary. Ivory panel (`#FBF6EC`) on sage (`#DCE3D5`), gold double rule with four mirrored corner flourishes, the MC monogram in a gold oval, the formal wording ("Together with their families" / script names / "request the pleasure of your company"), date, venue, address, attire, and the 囍 seal in the card's red. Below it, the timeline is rendered in the card's **line-art icon** style (gold circles) instead of the old bare `.timeline-*` grid. **The three icons were redrawn 2026-08-24** — they were a Christian church (a cross over a peaked roof, on the *arrival* row of a Chinese banquet at a hotel), two circles overlapping so far they read as a Venn blob with a stray triangle floating above, and a coupe whose rim was 2.4 units wider than the bowl it sat on. They are now a **紅中 mahjong tile** (the couple picked it from six mahjong candidates 2026-08-24; matches "Show Up & Play Mahjong" — tile 12.8×18.4, real tile proportion, with the 中 counter deliberately widened to 7.2×6.2 because a square 中 fills in at the 22px phone size), **two interlocking bands** (`r=5`, centres 6.6 apart — enough overlap to interlock, not enough to merge), and **a Burgundy glass** (couple's request 2026-08-24 — apt twice over: the banquet copy is about Mitchell's wine list, and Chambolle is named for Chambolle-Musigny). ⚠️ **The Burgundy shape is the point — do not "tidy" it into a straight-sided glass.** Its bowl is a balloon that is *wider than it is tall* (~11.2 wide × 9.1 high) and tapers back IN to a rim only 4.8 wide — rim/widest ≈ 0.43, deliberately more exaggerated than a real Burgundy's ~0.62 so the taper still reads at 22px. The couple picked this widest-bowl variant from five 2026-08-24, over a longer-stemmed one with a smaller bowl; the short stem is theirs by choice, so don't "correct" the bowl-to-stem ratio. A flared-lip variant was tried and rejected — the lip reads as a dent in the rim at icon size. A teacup was also rejected for the first row because it would have made two of the three icons drinkware. All three were drawn against the real 26px/22px render, not judged magnified — the earlier set's flaws only show at size. This is now the **single** place venue/date/attire are stated on the site.

  - **Card palette is scoped to `#wedding-day`** so it cannot leak into the site's Pantone tokens.
  - ⚠️ **Gold (`--card-gold #C2A56A`) is ornament only — never text.** It measures 2.98:1 on ivory. Text on the card uses `--text` or `--olive` (5.20:1). This mirrors the real card, where ornament is gold and words are near-black.
  - ⚠️ **`.invite-names` font-size is derived from the string, not copied from the hero.** "Christy & Mitchell" in Besotted Love renders **11.36× font-size wide**. Floor `1.4rem` is set by the narrowest supported device (Z Fold cover 344px → 270px card inner → max 23.8px); cap `2.7rem` by the 620px card at desktop padding (524px inner → max 46.1px). **Re-measure both bounds if this copy changes.** It also needs the same `padding-top: 0.42em` ascent-overshoot allowance the hero uses.
  - **2026-08-24: the garden artwork is gone — the section is now just the card and the timeline on sage.** The couple supplied the printer's seven die-cut scenery layers as RGBA PNGs (`SynologyDrive/MC Wedding/1 前面 左边.png` … `8 左边 最后层_.png`, from `请帖-制作稿效果图.psd` in the same folder; readable with `psd-tools`, which also gives the layer positions). Two uses were built and shown: (a) the layers composited into a pop-up diorama in place of the old foot band, (b) the bouquets and Chambolle/front florals as cut-outs *behind* the invitation card, the card taking the pop-up's photo slot. The verdict on both was "一陀東西 / a bunch of stuff — make it plain", so **nothing decorative sits in this section any more**: `#wedding-day` lost its `padding-bottom: 0` (that only existed for the band) and uses the normal section rhythm; `wedding-day-garden.{png,webp,jpg}` were deleted; the layer PNGs were *not* added to the repo (they stay in SynologyDrive). If artwork is ever revisited, the couple's stated alternative was a faint *background* wash, not cut-outs — and the 2026-08-17 rule still holds: never text over it.
  - Removed as dead code: `.wedding-bg-wrap` (+ its tint overlay), `.venue-header` / `.venue-title` / `.venue-attire` / `.venue-break`, and the old `.timeline-*` rules incl. their mobile overrides.
- Timeline content (17:00–18:00, 18:30–19:30, 20:00–23:00 — dinner was 19:45 until 2026-08-24, see below) and the couple's copy are **unchanged** — only the presentation moved.
  - ℹ️ **Dinner is 20:00, changed from 19:45 on 2026-08-24 at the couple's request.** This supersedes the 2026-08-17 note that said the site's 19:45 and the printed card's "Dinner 8:00 pm" were both fine and should be left alone — the site now simply matches the card. The time lives in **two** places and they must move together: the visible `.day-time` in the timeline, and the `buildDescription()` schedule block that feeds the Google Calendar / .ics export (its lines are space-aligned, so keep any replacement 5 characters wide). Not affected, and correct as they stand: the `EVENT` object's `startUtc`/`endUtc`/`startIso`/`endIso` and the countdown target, which all bracket the whole event at 17:00–23:00 HKT, not the dinner. `.day-time` is deliberately **not** in the i18n dictionary — the times are numerals and render identically in all three languages, so there is nothing to translate.

#### 🖼 Gallery
- **2026-08-13: moved to 4th position** (Home → RSVP → Wedding Day → Gallery → More), per the section-order reorg. Internals untouched.
- 3-column grid (2-column on mobile), 8 real pre-wedding photos from the Paris shoot.
- **2026-08-12: wired up to real photos, replacing base64.** The grid previously held 8 base64-embedded JPEGs directly in the HTML (already real photos, not blank/gray placeholders — CLAUDE.md's older "placeholder tiles" note was stale) totalling several MB of inline data. These were replaced with `<img src="photos/gallery-web/FILENAME.jpg">` file references, following the same file-reference pattern established for `hero-paris.jpg` and the Our Story slideshow. Net effect: `wedding-invitation.html` shrank from several MB to ~930KB.
  - `photos/gallery-web/` holds web-optimized exports (longer edge resized to 1600px, JPEG quality 82, ~140–300KB each) generated from the full-resolution originals in `photos/gallery/`. `photos/gallery/` remains the raw-source folder (per the existing `hero-paris.jpg` convention); `photos/gallery-web/` is the sibling folder for site-ready derivatives — don't put full-resolution originals there.
  - Source photos used: `20260609-ChristyandMitchParisPW-{50-1,148,170,164,196,182,266,115}.jpg`, in that curated order (not filename/frame-number order — chosen for visual variety: couple+Chambolle, romantic close-ups, solo bride shot, Chambolle-in-window charm, full family). `-320.jpg` was deliberately excluded — it's already the hero background photo, and repeating it in the gallery would be redundant. `-274.jpg` (the Eiffel Tower walking shot) was initially included as the opening photo but removed the same day per user request — its `photos/gallery-web/` export was deleted too since nothing else referenced it; the full-res original stays in `photos/gallery/` as source archive.
  - To swap/add/remove a gallery photo: add the full-res original to `photos/gallery/`, generate a web export into `photos/gallery-web/` (resize longest edge to ~1600px, JPEG quality ~82), then add/edit/remove the matching `<div class="gallery-item reveal" data-index="N"><img src="photos/gallery-web/FILENAME" alt="..." loading="lazy"></div>` in the `#gallery-grid` block. `data-index` must stay sequential (0-based, no gaps) — the lightbox JS (`galleryImages` array) is built by DOM order, not by reading `data-index`, but keeping them sequential avoids confusion. No JS changes needed — `openLightbox`/`nextImage` already read `img.src` generically from whatever `.gallery-item` elements exist. If removing a photo, delete its now-unused `photos/gallery-web/` export too (keep the `photos/gallery/` raw original).
- Lightbox with keyboard navigation (←→, Esc), verified working against the file-referenced images (opens correct photo, counter shows "N / 8").
- Touch swipe support

#### 🗂 More (Our Story / Meet Chambolle only)
**2026-08-17: Travel and Q&A were removed from here** and promoted to top-level sections (see Section Order). `#more` now holds only the two genuinely optional panels, so its eyebrow "Totally Optional" and heading "Feel Free *to Scroll Past*" are finally accurate.

- Two `.more-panel` accordion panels, single-open, labelled "Our Story" and "Meet Chambolle". The nested `<section id="story">` / `<section id="chambolle">` markup is unchanged.
- **⚠️ The accordion no longer uses `max-height`.** It used to set `body.style.maxHeight = body.scrollHeight + 'px'` in JS at the moment of opening. That value was **frozen**, so anything that grew the panel afterwards overflowed it invisibly — with Q&A nested inside, opening one answer hid **149px** and made the last two questions ("Will Chambolle be there?", "Can I bring a plus-one?") **completely unreachable**. Both accordions now animate `grid-template-rows: 0fr → 1fr`, which tracks the content's live height:
  ```css
  .more-panel-body, .qa-answer {
    display: grid; grid-template-columns: 100%;   /* see note below */
    grid-template-rows: 0fr; grid-auto-rows: 0fr;
    transition: grid-template-rows 0.4s ease;
  }
  .more-panel-body > *, .qa-answer > * { overflow: hidden; min-height: 0; }
  ```
  - `grid-template-columns: 100%` is **load-bearing, not cosmetic**. Without a definite column, the `1fr` row has to size a text block whose height depends on a column width still being resolved; Chrome settles it only on a later layout pass, and the panel intermittently renders one line tall. Pinning the column fixes it in a single pass.
  - `toggleMorePanel()` / `toggleQA()` now only flip classes and `aria-expanded`. **Nothing measures a height in JS any more — keep it that way.**
  - Verified with transitions disabled (to read the settled state): all 5 Q&A answers and both panels render at exactly their full content height, 0px clipped.
- `.reveal` children are still force-shown on open, since a collapsed panel has no rendered height and its IntersectionObserver may never have fired.

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
- **2026-08-13: `chambolle` and `qa` are now nested inside `#more`'s accordion**, not standalone top-level sections (see 🗂 More above) — left unchanged here on purpose. `document.getElementById('chambolle'/'qa')` still resolves fine regardless of nesting depth, so the `IntersectionObserver` targeting is unaffected. The practical difference: while that accordion panel is collapsed (`max-height: 0`), the element has no visible area, so the observer won't fire — the egg just won't trigger from scrolling past it anymore, only once the user opens that specific panel and it's actually on screen. Not worth engineering around; a minor, expected behaviour change from the reorg, not a bug.
- **2026-08-13 (later same day): footer exclusion zone added.** With Q&A nested inside `#more` and the footer following shortly after, the `qa` trigger's egg (bottom-right corner) started overlapping the footer's "Christy & Mitchell" text once scrolled to the very end of the page — the opposite of this feature's explicit "never floats over reading content" goal. Fixed with a dedicated `footerObserver` that blocks `showEgg()` and force-dismisses whichever egg is active the moment the footer scrolls into view, regardless of which section triggered it. See the Site Frame section's fix notes above for the full story (same investigation that found the `body` padding-bottom regression).

### Liquid Glass (interface layer)
**2026-08-18, per user request** ("make it more like apple's liquid glass design for the whole site"), building on the floating-pill bottom nav. One shared material — tokens in `:root` (`--glass-blur`, `--glass-bg`, `--glass-bg-solid`, `--glass-edge`, `--glass-inset`, `--glass-shadow`) — applied to the **interface layer only**:

- **Top desktop nav**: floating glass capsule (`top: 14px`, centred via self-transform, `border-radius: 999px`, `width: max-content` capped at `100vw - 28px`). A `≤900px` media tightens `.nav-list` gap to 1.3rem so 7 links stay one row down to the iPad-mini boundary (verified 707px capsule at 744px viewport).
- **Bottom mobile pill**: same material via the shared tokens.
- **Lightbox**: scrim lightens to `rgba(26,26,20,0.62)` + `blur(22px)` when backdrop-filter works (solid 0.95 fallback otherwise); prev/next/close are 48px glass capsules (44px mobile); counter is a glass chip at 0.85 white (was 0.4 — near invisible).
- **Floor-plan modal scrim**: `0.45` + `blur(18px)` under `@supports`, solid fallback.
- **Chambolle shush toggle + speech bubble**: glass.
- **Interactive controls get capsule radii** (`999px`): `.rsvp-btn`, `.map-btn`, `.seat-edit-link`, `.form-submit`, `.attendance-toggle` (container rounds, `overflow: hidden` clips the active fill).

⚠️ **The paper/glass split is the rule**: glass is for chrome and overlays (things that float above content); the invitation card, forms, and all reading surfaces stay square-edged paper. Do not put glass on content — over a static background it just reads as a grey box, and glazing the invitation would break the site's whole metaphor.

⚠️ **Every glass use sits behind `@supports (backdrop-filter …)`** with a near-opaque solid fallback (labels must never sit on unblurred photos), and a `prefers-reduced-transparency: reduce` block turns everything solid again (mirrors the reduced-motion block).

### Nav
**2026-08-17: plain-noun labels, and the desktop bar is back.** (2026-08-18: bar became the glass capsule above — links/labels/scroll-spy unchanged. `section[id] { scroll-margin-top: 84px }` still clears it: capsule bottom edge ≈ 14 + 55 = 69px.)

- **Desktop (>700px), `nav` + `.nav-list`:** 7 flat links in DOM order — Home · Wedding Day · Travel · Q&A · RSVP · Gallery · More. Verified single-row (no wrap) down to 744px.
- **Labels are nouns again.** The joke labels were retired from the nav only: "Show Up or Explain Yourself" (= venue and timings), "Photos We Paid Too Much For" (= gallery), "Feel Free to Scroll Past" (= where Travel and Q&A were hiding). They read well in prose but made the bar unscannable — a guest hunting for directions had no word to aim at. **The wit is untouched everywhere else**; it just no longer sits in the one place that has to function as signage.
- **Mobile (≤700px), `.bottom-nav`:** 6 tabs — Home · Day · Travel · Q&A · RSVP · Photos. Travel and Q&A got their own tabs; the old 5th "More" tab (which used a **clock** icon for a section containing none of those things) is gone. Each icon now depicts its destination.
  - **2026-08-18: restyled as a floating frosted pill** (was a full-width opaque bar with a hard `border-top`). `border-radius: 999px`, floats at `bottom: calc(10px + env(safe-area-inset-bottom))`, `width: min(430px, 100vw - 20px)`, centred with `left:50%; translateX(-50%)` (a transform on the element ITSELF is safe — only ancestor transforms break `position:fixed`). Frosted glass via `backdrop-filter: blur(16px) saturate(1.5)` gated behind `@supports`, with a 94%-opaque solid fallback so labels never sit on unblurred photos. Active tab's icon circle widens 34px → 52px into a golden stadium (transition covered by the global reduced-motion block).
  - ⚠️ **Three clearances are keyed to the pill's geometry** (top edge ≈ 10px + ~66px + safe-area above the viewport bottom): mobile `body { padding-bottom: calc(96px + env(safe-area-inset-bottom)) }` (overrides the base 72px), and the Chambolle egg + shush toggle at `bottom: calc(90px + env(safe-area-inset-bottom))`. If the pill's height or offset changes, re-derive all three.
  - Six tabs still clear the 44px touch minimum on the narrowest device supported: measured **53×58px** at a 344px Z Fold cover screen, 61×58 at 393px.
  - Label size is a flat `0.7rem` (11.2px), not a clamp, so it never drops under the page's 11px floor.
  - The Home tab's `active` class is still hardcoded in HTML — the scroll-spy only runs on a real `scroll` event, so without it no tab appears active until the guest scrolls.
- **Scroll-spy `sections` array must match DOM order** — now `['home','wedding-day','travel','qa','rsvp','gallery','more']`. The `#more`-is-last special case (treating "scrolled to the bottom of the page" as `#more` active) is still required, since the page can run out of scroll before `#more`'s top reaches the 80px threshold.
- **Anchor offset:** `section[id] { scroll-margin-top: 84px }` on desktop so the fixed top bar doesn't cover the heading a guest just jumped to; `12px` on mobile, where the fixed bar is at the *bottom* instead.

### Languages (EN / 繁中 / 日本語)
**2026-08-17, per user request.** The site ships three languages in the single HTML file. **English lives in the DOM as the source of truth**; an i18n `<script>` (inserted immediately BEFORE the main script) swaps copy at load for the other two.

- **Detection:** saved choice (`localStorage['mc-lang']`) wins; otherwise `navigator.language`: any `zh*` (Simplified **or** Traditional) → **Traditional Chinese**, `ja*` → Japanese, everything else → English. `<html lang>` becomes `zh-Hant` / `ja`.
- **Switcher:** `.lang-btn` buttons (`data-set-lang`) — a `.nav-lang` group inside the desktop nav capsule, and a floating glass `.lang-chip` top-right on mobile (`display:flex` only ≤700px, where the top nav is hidden). A click persists to localStorage and reloads.
- **Static copy** swaps via a **selector→HTML dictionary** (`I18N.zh.dom` / `I18N.ja.dom`); multi-element selectors map to arrays **in DOM order** (nav links, tabs, countdown labels, day titles/descs, QA questions/answers, story/chambolle paragraphs, dietary options, seat-card notes). ⚠️ **If you add/remove/reorder any of those elements, update BOTH language arrays in the same commit** — a missing selector logs `[i18n] no match:` to the console (checked at verification: zero warnings).
- **Dynamic JS strings** route through `tt(key, enDefault)` / `tf(key, enDefault, n)` (defined by the i18n script; safe in English because the pack is null and the default returns). Covers seat card (第 {n} 桌 / {n}番席 formats — **word order differs by language, hence format strings, never concatenation**), floor-plan panel, form errors, send/sending, countdown "today", Chambolle quips (`window.MC_QUIPS` consumed by the egg script) and shush-toggle titles.
- **Deliberately still English:** the Besotted Love / Liana script lines ("Christy & Mitchell", "You're All Set", footer names) — they are calligraphy, and neither font has CJK glyphs; the floor-plan map labels (SALISBURY ROOM / STAGE etc.) — map proper nouns; email/phone placeholders; calendar export text (ICS interop).
- **CJK type:** no CJK webfont is shipped (weight). `html[lang="zh-Hant"]`/`[lang="ja"]` body rules add system fallbacks (Songti/PingFang TC; Hiragino Mincho/Yu Mincho). Latin names and numerals still render in the embedded faces.
- **Names in Chinese:** Christy = 芷晴, Mitchell = 文俊 (from the couple's printed invitation). Used in zh prose; Latin elsewhere.
- **Script order matters:** i18n block → main script → egg script. The i18n block must stay BEFORE the main script (so `tt`/`tf` exist when the RSVP flow first renders) and all content markup must stay above it.

### Mobile Responsive
- `@media (max-width: 700px)` and `@media (max-width: 390px)` — real viewport again (see Responsive above).
- Top `nav` is `display:none` below 700px; `.bottom-nav` is `display:none` above it.
- `body { padding-bottom: 72px }` in the base rule, overridden to `calc(96px + env(safe-area-inset-bottom))` inside the ≤700px block — the floating pill needs more clearance than the old flush bar did.
- Section vertical rhythm on mobile is `2.4rem` (was `1.2rem`, which ran sections into each other).
- All grids collapse to one column; gallery goes 3 → 2 columns.
- Chambolle egg/toggle sit at `bottom: 84px` to clear the tab bar.

### Typography & accessibility floor
**2026-08-17.** The Raleway label layer used to run **7.7px–11px** at a contrast of **3.72:1** — on a guest list where a large share are 50+, that was the most consequential defect on the site.
- **Type scale raised monotonically, floor now 0.7rem (11.2px)** across 66 declarations (was 0.48rem/7.7px). Hierarchy is preserved; only the floor moved. Verified: **no element renders text under 11px at any tested width.**
- **`--text-light` is its own value `#58664A` (4.95:1)**, no longer `var(--sea-spray)` `#6A7A5A` (3.72:1, failed AA while carrying the smallest text). `--sea-spray` itself is unchanged — it is still a brand Pantone and is used as a button *background*, where it is fine.
- **"and Chambolle" is `#7A5A66` (4.86:1)**, was `#B89AA4` (**2.06:1** — the worst on the site). No large-text exemption can apply at 12.8px, so the colour had to move; the deeper tone keeps the rose-bisque identity. *(This overrides the older "Rose Bisque #B89AA4" line under Key CSS Rules to Preserve.)*
- **`.hero-meta` may now wrap** (`white-space: normal`). Forcing "THURSDAY • NOVEMBER 12, 2026 • HONG KONG" onto one line drove it to ~8.6px on a 360px phone.
- **`<h1>` added** — the page previously had none, and the first heading in the DOM was an `<h3>`. `.hero-names` is now `<h1 class="hero-names">`; the class and all its Besotted Love rules are unchanged.
- **Forms:** 6 labels wired with `for=`; the read-only name field, the member picker and the attendance toggle use `role="radiogroup"` / `aria-labelledby` / `aria-checked` since they can't take a `for=`.
- **`aria-expanded`** on all 7 accordion buttons (2 panels + 5 Q&A), kept in sync by JS.
- **`prefers-reduced-motion: reduce`** block added — there was none, while the page ran an infinite scroll-hint pulse, a per-second countdown animation, two auto-advancing slideshows and slide-in popups. Content stays visible (`.reveal` is forced to its end state, never left at `opacity: 0`).
- **Slideshow dots**: still 6px visually, but an invisible `::after` grows the touch target to **44×44px** (container gap widened 6px → 14px so they don't overlap).
- **Lightbox arrow keys are now scoped to the open lightbox** — they used to fire from anywhere on the page, including while typing in the RSVP fields.


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
rsvp   (id, name, email, phone, attendance, plus_one_name, dietary, song_request, message, submitted_at)
```

`phone` added 2026-08-13 (contact number / WhatsApp, collected on the RSVP form). The `submit_rsvp(...)` RPC function and its `GRANT EXECUTE` signature were updated to match (`p_phone TEXT`, inserted after `p_email`) — also added to the `admin_rsvps` view so the couple can actually see submitted numbers.

- RLS enabled on both tables
- Public can read `guests`, insert to `rsvp`
- Service role has full access
- ✅ Schema is deployed and credentials flow from Vercel env vars via `/api/config.js` (verified 2026-08-17). Schema deltas now go in `supabase/migrations/` — see `2026-08-17_submit_rsvp_phone.sql` for the pattern (idempotent, applied + verified the same night).

---

## 7. Pending / TODO

| Priority | Item | Notes |
|----------|------|-------|
| 🔴 HIGH | **No contact route anywhere on the site** | The RSVP "Personalised Invitation" and "Invitation Not Recognised" states both say *"reach out to Christy or Mitchell directly"*, but there are **zero** `mailto:` / `tel:` / `wa.me` links on the page. A guest without a code has no next step. Couple chose 2026-08-17 to leave it for now — revisit before the invites go out. |
| 🟡 MED | Confirm/resolve Pending guests (22 outstanding) | See Guest List tab in tracker |
| 🟡 MED | Assign Table # for confirmed guests | Use seating planner + tracker |
| 🟢 LOW | Shrink the 931 KB document | Still base64: Liana (93 KB) + Besotted Love (85 KB) fonts, the Chambolle slideshow and the 3 egg copies. Moving those to files would roughly halve it. Photos are already external. |
| 🟢 LOW | Test RSVP form end-to-end against live Supabase | Supabase **is** wired up in production (verified 2026-08-17 — `window.SUPABASE_URL` present, so demo mode is off). A real submit writes to the live guest DB, so test with a disposable code. |

**Verified done (2026-08-17), previously listed as pending:** Supabase URL + anon key are injected via `/api/config.js` from Vercel env vars; the schema is deployed; `song_request` and `phone` columns exist.

---

## 8. Instructions for Claude

### When working on the website
- **Always edit `/home/claude/wedding-invitation.html` in place.** Never create `wedding-invitation-v2.html` or similar.
- **Preserve the Liana `@font-face` block** — it is base64-embedded and still used on the RSVP success screen and seat-lookup card script text. Do not remove it. Liana has never been used on either hero line.
- **Preserve the Besotted Love `@font-face` block** — it's the only thing rendering "Christy & Mitchell" in script, both in the hero and (since 2026-08-12) the footer. If it's ever removed, the CSS falls back to Alex Brush (still CDN-loaded) rather than breaking, but that's a visual regression, not something to do on purpose. In the hero, `.hero-names` (not `.hero-script`) is the selector that uses it — see the Typography section's note on the two hero lines' swapped roles before changing either. In the footer, `.footer-script` uses it directly (switched from Liana 2026-08-12).
- **Always preserve the design tokens** in `:root {}`. Do not introduce new colours outside the palette.
- **The Wedding Day section is an HTML/CSS/SVG rebuild of the printed invitation** (`.invite-card` + icon timeline), not an image with text on it, and since 2026-08-24 it carries **no artwork at all** — the couple asked for it plain after two attempts with the card's die-cut layers. Don't reintroduce decoration there without being asked; if asked, never set text over it.
- **The Chambolle photos in the "Meet Chambolle" section** are base64 embedded — do not remove them.
- When adding sections, follow the existing section pattern: `<section id="x"><div class="container">...</div></section>`.
- Scrolling reveal: add `class="reveal"` to new elements — the IntersectionObserver handles the rest.
- **The site is responsive: real desktop above 700px, mobile below** (2026-08-17, see "Responsive" at the top of section 4). Use `@media`, never `@container` — and never put `container-type` or a `transform` on `#site-frame`. Responsive text sizing uses `vw`. ⚠️ When bulk-editing CSS in this file, match **exact literals** (e.g. whole `clamp(...)` strings); the base64 blobs contain arbitrary letter sequences and a blind regex will silently corrupt image data.

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
