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
2. **Mobile `.hero-names` font-size is `clamp(1.5rem, 7.6vw, 3.35rem)`, desktop is `clamp(2.4rem, 5vw, 4.5rem)`** (desktop shrunk 2026-08-13, was `clamp(3.3rem, 7.6vw, 7rem)` — see "Desktop hero rebalance" below). These are specific to "Christy & Mitchell" (measures 11.36x font-size wide via canvas `measureText`) — different from the 8.75x ratio "Save the Date" measured at when Besotted Love was on that line. Unlike the ascent fix above, **width is a string property and must be re-measured any time the copy on whichever line carries Besotted Love changes.** Don't copy these numbers onto a different string without re-measuring first — that's exactly the mistake that caused the original mobile overflow bug this pattern is meant to prevent. The 2026-08-13 desktop shrink only lowered the clamp's numeric bounds (same string, same vw-scaling approach) — it made the rendered text strictly narrower at every breakpoint above 700px than before, so it carried no overflow risk and needed no re-measurement.

**`.footer-script` (footer "Christy & Mitchell", switched to Besotted Love 2026-08-12) does NOT need the `padding-top: 0.48em` overshoot fix above.** It has no explicit `line-height` set (base rule or the mobile override), so it uses the browser's default `line-height: normal`, computed from Besotted Love's own hhea ascent/descent (~1.6em + ~0.4em ≈ 2.0em) — generous enough on its own to contain the tall loops. The hero only needs the fix because `.hero-names` overrides `line-height` down to a tight `1.05`. Verified empirically in headless Chromium at both desktop and mobile widths: no overshoot into the Q&A divider above, no width clipping. If a `line-height` is ever added to `.footer-script`, re-check for overshoot.

### Key CSS Rules to Preserve
- Hero "Christy & Mitchell": `font-size: clamp(2.4rem, 5vw, 4.5rem)` on desktop (shrunk 2026-08-13, was `clamp(3.3rem, 7.6vw, 7rem)` — see "Desktop hero rebalance" below), `clamp(1.5rem, 7.6vw, 3.35rem)` on mobile (unchanged), olive colour, **Besotted Love** font (moved here from "Save the Date" on 2026-08-12 per user request — the two lines swapped roles, see Typography above)
- Hero "Save the Date": `font-size: clamp(1.4rem, 2.6vw, 2rem)` on desktop (shrunk 2026-08-13, was `clamp(1.8rem,4vw,3rem)`), near-black `#1A1A14`, **Cormorant Garamond**, uppercase, letter-spacing 0.25em, weight 300 (moved here from "Christy & Mitchell" the same day — this is the exact styling "CHRISTY & MITCHELL" used to have)
- "and Chambolle": Rose Bisque `#B89AA4`, half font size, centred with line rules
- Date line "NOVEMBER 12, 2026 · HONG KONG": black `#1A1A14`, weight 800
- All section dividers: gradient line rules (`linear-gradient(to right, transparent, var(--divider), transparent)`)
- No decorative SVG grape/vine elements (removed)

---

## 4. Website (`wedding-invitation.html`)

### Site Frame — the whole site is now a mobile view, always
**2026-08-13, per user request** ("the result is still not good enough. thinking to make it a mobile view as well. people probably will not open ton computer. they will use their mobile to open the link"). Followed the desktop hero rebalance (previous change, still not satisfying) — the couple decided most guests will open the link on their phone regardless, so rather than keep tuning a separate desktop layout, the site now renders the same already-approved mobile experience at **any** browser width. Desktop visitors see it centred in a phone-width column on a plain gardenia background (their explicit choice over a card-with-shadow look); real mobile visitors see zero change.

**How it works:**
- **`<div id="site-frame">` wraps the entire `<body>`** (everything between `<nav>` and the closing `</script>`, i.e. nav, hero, every section, the lightbox, floor-plan modal, and the Chambolle egg markup). CSS: `max-width: var(--frame-max)` (430px), `margin: 0 auto`, `background: var(--bg)`, `container-type: inline-size`. On an actual phone (viewport already ≤430px) this div just shrinks to fit — no visible change, same edge-to-edge layout as before.
- **Every `@media (max-width: Npx)` in the file was converted to `@container (max-width: Npx)`** (7 occurrences: the main mobile block, the extra-small-phone block, gallery/floor-plan/more-panel/chambolle-egg breakpoints — grep for `@container` to find them all). `container-type: inline-size` on `#site-frame` makes it the reference container for all of these, so they now key off **the frame's width**, not the real browser viewport — meaning they always match once the frame is capped below 700px, regardless of how wide the actual browser window is. This was the necessary piece beyond just capping the frame's width with CSS: capping width alone changes nothing about which styles apply, since `@media` always checks the true viewport.
- **`position: fixed` elements needed individual fixes, not a blanket trick.** The obvious-looking shortcut — give `#site-frame` a `transform` (any non-`none` value), which per spec makes it the *containing block* for all `position: fixed` descendants — was tried first and reverted. It does contain them, but it also changes what "fixed" means for them: instead of staying stuck to the visible viewport while scrolling, they became stuck to the bottom of the entire (very tall) frame element — the bottom nav ended up sitting ~4000px down the page instead of on screen. Wrong behaviour for a tab bar. Fixed instead by leaving these elements genuinely `position: fixed` (real viewport, correct scroll-following) and manually capping/centering each one:
  - Elements that used to span `left: 0; right: 0` or `inset: 0` (nav, `.lightbox`, `.bottom-nav`, `.fp-modal`) now use `left: 50%; transform: translateX(-50%); width: min(var(--frame-max), 100vw);` (plus `top`/`bottom` as before) — still real `position: fixed`, just width-capped and centred instead of spanning the true viewport edge to edge.
  - Small elements positioned by edge-offset instead (the Chambolle egg positions, its speech bubble's containing offsets, the shush toggle) needed a different fix, since they use pixel offsets like `right: 14px` meant as "14px from the edge" — but *which* edge (true viewport vs. frame) matters once the two diverge on a wide screen. Added `--frame-gap: max(0px, calc((100vw - var(--frame-max)) / 2))` to `:root` (the horizontal gap between the true viewport edge and the frame's edge — 0 on real narrow mobile, positive once the browser is wider than the cap) and changed those offsets to e.g. `right: calc(14px + var(--frame-gap))`. The speech bubble itself needed no change — its position is computed in JS from the egg's actual `getBoundingClientRect()` at click time, which is already correct regardless of where the egg ends up.
  - `.lb-prev`/`.lb-next`/`.lb-close`/`.lb-counter` and `.fp-close` needed no change — they're `position: absolute` relative to `.lightbox`/`.fp-modal` (already their containing block), so capping the parent's width automatically kept them correctly positioned inside it.
- **All `vw`-based `clamp()` text sizing converted to `cqw`, 2026-08-13 (same day, follow-up fix).** Initially left as `vw` on the theory that hitting the `clamp()`'s upper bound on a wide desktop viewport would still look fine since that bound was already mobile-tuned — wrong in practice: `vw` still measures the *true* viewport regardless of the frame, so on desktop `.hero-names` ("Christy & Mitchell") computed its size from e.g. a 1440px window (7.6vw ≈ 3.35rem, the clamp's cap) while being squeezed into the ~430px frame, and wrapped to two lines — something that never happens on a real ≤430px phone, where `vw` and the frame's actual width are the same number. `#site-frame` already had `container-type: inline-size` (for the `@container` breakpoints above), so `cqw` — 1% of the *container's* width — was the direct fix: swapped every `Ncqw` in place of `Nvw` inside `clamp()` calls for `.hero-script`, `.hero-names`, `.hero-chambolle`, `h2.section-title`, `.story-quote`, `.story-body .eyebrow`, `.venue-title` (unused, converted anyway for consistency), and `.hero-meta`, in both the desktop base rules and the `@container` overrides. On a real phone this is a no-op (container width == viewport width, `cqw` == `vw` numerically); on desktop-as-frame it now correctly scales off the frame's ~430px instead of the browser window, matching real mobile exactly — verified single-line "Christy & Mitchell" and identical computed `font-size` at 1440px and 1920px viewports (both resolve against the same 430px-capped frame). `--hero-photo-h` and other **height**-based `vh` values were deliberately left alone — `cqh` would need `container-type: size` (block-size containment) on `#site-frame`, which risks other layout side effects, and unlike text width, the hero photo's height scaling off the true viewport is exactly what's wanted (a real phone's visible height, not the frame's arbitrary box height). The `min(var(--frame-max), 100vw)` used to width-cap `position: fixed` elements is also intentionally still `vw`, not `cqw` — those elements sit outside the container's normal containing-block chain (see the `position: fixed` note above), so they need the *true* viewport width for the `min()` comparison to mean anything.
- **The old `.chambolle-toggle`/`.chambolle-egg.pos-*` desktop-only base rules** (the ones the always-on mobile `@container` block overrides with `!important`) are now permanently dead code — harmless, left as-is, not deleted, since they're clearly labelled and still reachable if the frame concept is ever reverted.
- **⚠️ `@container` cannot style anything outside the query container's own subtree — this bit the footer, 2026-08-13 (second follow-up fix).** `body { padding-bottom: 72px; }` (reserves room so the fixed bottom-nav never covers the last section's content) used to live inside the old mobile `@media` block. When that block became `@container`-scoped to `#site-frame`, this rule silently stopped matching *everywhere, including real mobile* — `body` is `#site-frame`'s **parent**, and a container query can only ever style descendants of its container, never an ancestor. The bug wasn't visible in the earlier verification passes because they checked overflow/positioning, not this specific padding. User caught it directly: screenshot showed the footer's "Christy & Mitchell" text partly hidden behind the bottom-nav. Fixed by moving `padding-bottom: 72px` into the base (always-active) `body {}` rule near the top of the stylesheet — it no longer needs to be conditional anyway, since the site is always in "mobile" layout now. **Any other rule that targets `body` or `html` from inside a `@container` block has the same problem** — there's only this one left (grep for `^\s*body {` / `^\s*html {}` to check if more get added).
- **The Chambolle egg can still cover the footer even with the padding fixed, since both live in the same bottom-right corner.** All three egg positions consolidate to bottom-right on mobile specifically "so the egg never floats over reading content" (see the Chambolle Easter Egg section) — but the footer is reading content that now sits in that exact corner once scrolled to the very end, something that wasn't a problem before Q&A moved inside `#more` (previously there was much more scrollable distance between Q&A, where the egg triggers, and the footer). Rather than retune `EGG_SCHEDULE`'s per-trigger delay/threshold (fragile — "is this section intersecting" doesn't tell you whether the footer has *also* scrolled into view), the footer is directly observed as an egg-exclusion zone: a `footerObserver` (`{threshold: 0.1}`) sets a `footerBlocksEgg` flag that `showEgg()` checks before displaying anything, and immediately calls `hideEgg(activeEgg)` the moment the footer starts intersecting, dismissing whichever egg is currently up regardless of which section triggered it. Verified: egg still triggers normally at every other section (checked Gallery specifically); once scrolled far enough to see the footer, whatever egg was showing disappears and no new one appears, on both real mobile width and the desktop-as-frame view.

Verified via Playwright at 1024×768, 1440×900, and 1920×1080 (desktop-as-frame) and 390×844 (real mobile, confirmed pixel-identical to before this change): frame renders centred at the correct width with plain gardenia on either side; bottom nav bar stays genuinely fixed to the visible viewport while scrolling (checked at multiple scroll positions, not just page load); the lightbox and floor-plan modal are width-capped to the frame; the Chambolle egg pops up hugging the frame's edge (not the true viewport's edge) with its speech bubble correctly placed; the "More" accordion opens/closes correctly inside the frame; no horizontal overflow at any tested width; no JS console errors. Re-verified after the `cqw` follow-up fix below: "Christy & Mitchell" renders on a single line (not wrapped) at 1440px and 1920px, with identical computed `font-size` at both — confirming it's scaling off the frame, not the window.

⚠️ **If a future change adds a new `position: fixed` element**, it needs the same treatment as the others above (width-cap + centre via `left:50%;transform:translateX(-50%);width:min(var(--frame-max),100vw)`, or `--frame-gap`-adjusted edge offsets for small elements) — it will NOT automatically respect the frame just by being a descendant of `#site-frame`.

### Section Order
**2026-08-13: reorganized per user request** ("Order - Home -> RSVP -> Day-> Gallery. And the rest i.e. Our Story, Chambolle, Travel, Q&A are a new page that collapse together"). Was `Home → Our Story → Chambolle → Wedding Day → Travel → Gallery → Q&A → RSVP` (and even before that, the live DOM order had already drifted from this documented order — Wedding Day actually preceded Our Story/Chambolle, and RSVP/Travel/Q&A came after Gallery; this doc had gone stale). Now:

`Home → RSVP → Wedding Day → Gallery → More (Our Story / Chambolle / Travel / Q&A, collapsed into one accordion)`

Home, RSVP, Wedding Day, and Gallery are unchanged internally — only their position in the page moved. Our Story, Chambolle, Travel, and Q&A no longer exist as standalone top-level sections; their exact original markup (unchanged) is nested inside `<section id="more">` as four accordion panels, single-open (opening one closes the others), matching the interaction pattern the Q&A section already used internally. See #more below for the accordion mechanism, and Nav below for how the top nav / bottom tab bar changed to match.

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
- Fields: name, email, attendance toggle, plus-one, dietary, **song request** (live band), message
- `song_request` included in payload — Supabase column needed
- **⚠️ Pending:** Replace `YOUR_SUPABASE_URL` / `YOUR_SUPABASE_ANON_KEY`
- Demo mode active (simulates success when no real URL)
- The section's own dedicated `<style>` block (RSVP states + the floor-plan-modal CSS it triggers into) lives immediately before `<section id="rsvp">` in the file — moved together with the section during the reorg so the two stay co-located for anyone editing RSVP CSS.

#### 💒 Wedding Day
- **2026-08-13: moved to 3rd position** (Home → RSVP → Wedding Day → Gallery → More), per the section-order reorg. Internals untouched.
- **2026-08-12 (latest): new background — `photos/wedding-day-garden.png`.** A commissioned/generated garden illustration (watercolour trees, floral border, and Chambolle tucked into the bottom-left corner) supplied by the user, referenced as an external file (not base64 — follows the file-reference pattern established for `hero-paris.jpg` and the Our Story slideshow, rather than the base64 pattern the old Peninsula image used). Lives only in `.wedding-bg-wrap` (heading + Venue/Attire), not the timeline below it — same footprint as the old Peninsula image.
  - `background-size: cover; background-position: center 85%;` — the image is nearly square (1092×960) but `.wedding-bg-wrap` is a short, wide box, so `cover` crops heavily top/bottom. `center 85%` was chosen specifically to keep Chambolle in frame at the bottom-left (he sits low in the source image, around row 750–870 of 960); the default `center` cropped him out entirely. If the source image is ever replaced, re-check whether Chambolle (or whatever the new focal point is) survives this crop at both desktop and mobile widths — don't assume `center 85%` still applies to different artwork.
  - The `rgba(237,230,216,0.72)` gardenia tint overlay (`.wedding-bg-wrap::before`) and the `.wedding-bg-wrap > div { z-index: 1 }` rule (to lift content above it) are back too — same mechanism the old Peninsula image used, restored rather than reinvented.
  - Verified empirically in headless Chromium (via Playwright — see note below) at desktop (1200px) and mobile (390px): Chambolle visible bottom-left, "Wedding Day" heading and Venue/Attire legible over the tint, flowers frame the text without obscuring it.
  - ⚠️ **Headless Chromium's `chrome --headless --screenshot` CLI flag does not respect JS-driven scroll position** — it always captures from `scrollTop: 0` regardless of `scrollTo`/`scrollIntoView` calls, even with `--virtual-time-budget`. To screenshot a below-the-fold section, either use Playwright (`page.evaluate` to scroll, then `page.screenshot`) or size the headless window tall enough to include the target section from the top and crop afterward. Also: setting `--window-size` height very large (e.g. 8000px) to work around this inflates any `min-height: 100vh` sections (like the hero) proportionally, throwing off every element's position below it — keep window height near a real viewport size and use Playwright's scroll instead.
- **2026-08-12 (earlier same day): background briefly removed, plain gardenia.** Per user request ("remove the picture at the back, the hotel image. leave it plain. Also remove the date") the Peninsula watercolour illustration (base64 JPEG) and its overlay were deleted, and `.wedding-bg-wrap` fell back to `#wedding-day`'s own `background: var(--bg)`. Superseded by the new background above the same day — this plain-background state no longer reflects the live file, kept here only for history. The `Thursday, 12 November 2026` eyebrow that used to sit above the `Wedding <em>Day</em>` heading was also removed in this pass and has **not** come back — the heading is still the first thing in the section.
- **2026-08-12 (earliest of the three same-day changes): simplified.** The big "NOVEMBER 12 / HONG KONG" date grid and this section's own RSVP button were removed per user request ("remove the current RSVP page... it is not essential anymore"), referring to this section, not the actual `#rsvp` form (which is untouched). In their place: `<h2 class="section-title">Wedding <em>Day</em></h2>`, matching the heading pattern every other section uses.
- Venue: "The Salisbury Room at The Peninsula Hong Kong" + "Attire: Elegant Evening Attire" — kept exactly as before, per explicit user request.
- Timeline: 17:00–18:00 Guest Arrival / 18:30–19:30 Ceremony / 19:45–23:00 Dinner Reception — kept exactly as before.
- RSVP's entry point moved to the hero (see 🏠 Hero above) rather than living here.

#### 🖼 Gallery
- **2026-08-13: moved to 4th position** (Home → RSVP → Wedding Day → Gallery → More), per the section-order reorg. Internals untouched.
- 3-column grid (2-column on mobile), 8 real pre-wedding photos from the Paris shoot.
- **2026-08-12: wired up to real photos, replacing base64.** The grid previously held 8 base64-embedded JPEGs directly in the HTML (already real photos, not blank/gray placeholders — CLAUDE.md's older "placeholder tiles" note was stale) totalling several MB of inline data. These were replaced with `<img src="photos/gallery-web/FILENAME.jpg">` file references, following the same file-reference pattern established for `hero-paris.jpg` and the Our Story slideshow. Net effect: `wedding-invitation.html` shrank from several MB to ~930KB.
  - `photos/gallery-web/` holds web-optimized exports (longer edge resized to 1600px, JPEG quality 82, ~140–300KB each) generated from the full-resolution originals in `photos/gallery/`. `photos/gallery/` remains the raw-source folder (per the existing `hero-paris.jpg` convention); `photos/gallery-web/` is the sibling folder for site-ready derivatives — don't put full-resolution originals there.
  - Source photos used: `20260609-ChristyandMitchParisPW-{50-1,148,170,164,196,182,266,115}.jpg`, in that curated order (not filename/frame-number order — chosen for visual variety: couple+Chambolle, romantic close-ups, solo bride shot, Chambolle-in-window charm, full family). `-320.jpg` was deliberately excluded — it's already the hero background photo, and repeating it in the gallery would be redundant. `-274.jpg` (the Eiffel Tower walking shot) was initially included as the opening photo but removed the same day per user request — its `photos/gallery-web/` export was deleted too since nothing else referenced it; the full-res original stays in `photos/gallery/` as source archive.
  - To swap/add/remove a gallery photo: add the full-res original to `photos/gallery/`, generate a web export into `photos/gallery-web/` (resize longest edge to ~1600px, JPEG quality ~82), then add/edit/remove the matching `<div class="gallery-item reveal" data-index="N"><img src="photos/gallery-web/FILENAME" alt="..." loading="lazy"></div>` in the `#gallery-grid` block. `data-index` must stay sequential (0-based, no gaps) — the lightbox JS (`galleryImages` array) is built by DOM order, not by reading `data-index`, but keeping them sequential avoids confusion. No JS changes needed — `openLightbox`/`nextImage` already read `img.src` generically from whatever `.gallery-item` elements exist. If removing a photo, delete its now-unused `photos/gallery-web/` export too (keep the `photos/gallery/` raw original).
- Lightbox with keyboard navigation (←→, Esc), verified working against the file-referenced images (opens correct photo, counter shows "N / 8").
- Touch swipe support

#### 🗂 More (Our Story / Chambolle / Travel / Q&A, collapsed together)
**Added 2026-08-13**, per user request. `<section id="more">` is the 5th and last page section — everything that isn't Home/RSVP/Wedding Day/Gallery now lives here as four accordion panels, single-open (`.more-panel-header` / `.more-panel-body`, toggled by `toggleMorePanel()` in the JS — a separate function from `toggleQA()`, same single-open pattern). Eyebrow "Totally Optional", heading "Feel Free *to Scroll Past*" (reused verbatim from the old nav dropdown label of the same name, now retired — see Nav below).

- **The four original sections are nested completely unchanged** — same ids (`#story`, `#chambolle`, `#travel`, `#qa`), same internal markup, CSS, and JS (slideshows, the Google Maps embed, Q&A's own internal accordion). Only their position in the DOM changed, from standalone top-level sections to the body of a `.more-panel-body`. This was a deliberate "wrap, don't rewrite" choice to minimize risk — do not "clean up" by inlining/flattening these into `#more` directly, the nesting is what makes the collapse mechanism work without touching their internals.
- **Panel labels** (the always-visible accordion headers) are short and plain — "Our Story", "Meet Chambolle", "Travel", "Q&A" — deliberately different wording from each section's own `eyebrow`/`h2.section-title` inside (e.g. Our Story's own heading is "A Timeline *Nobody Requested*"), to avoid showing the same phrase twice when a panel opens.
- **Max-height accordion, not the QA pattern's fixed 300px cap.** `toggleMorePanel()` sets `body.style.maxHeight = body.scrollHeight + 'px'` on open (an accurate, content-aware value) rather than reusing `.qa-answer`'s fixed `max-height: 300px`. These panels can hold a slideshow, a full Google Maps iframe, or the entire nested Q&A accordion — all far taller than a one-line QA answer — so a fixed cap would either clip tall panels or animate short ones at the wrong apparent speed.
- **`.more-panel-body > section` padding is tightened** (`0.5rem 0 3rem`, `0.3rem 0 2rem` on mobile) versus the global `section { padding: 6rem 2rem }` the nested `<section>` would otherwise inherit — that padding was calibrated for a full-page section with independent breathing room above and below; inside an accordion panel (which already has its own header spacing) it read as an oversized gap. The nested sections' `.container`/`.container-wide` wrappers and everything below them are untouched.
- **`.reveal` elements are force-shown on open**, not left to the `IntersectionObserver`. A collapsed `.more-panel-body` has `max-height: 0; overflow: hidden`, so its `.reveal` children never intersect the viewport and the observer never fires for them — in practice this self-corrects once the panel expands and its content actually enters the viewport (the browser recomputes intersection on any layout change, not just scroll), but `toggleMorePanel()` also does `body.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'))` as a belt-and-suspenders fallback so content is never invisible after a click, without depending on that browser behaviour.
- **Nav / scroll-spy fix required for `#more` specifically**: since `#more` is the last section before the footer, the page can run out of room to scroll — the browser hits its max scroll position before `#more`'s top ever reaches the scroll-spy's normal `<= 80px` activation threshold, so the "More" nav link/tab would otherwise never highlight. Fixed by also treating "scrolled to the bottom of the page" (`scrollY + innerHeight >= document.body.scrollHeight - 2`) as `#more` being active. If `#more` ever stops being the last section, re-check whether this special case is still needed.
- Sub-sections, unchanged internally:
  - **Our Story** — left: slideshow (5 photos, referenced from `photos/our-story/` as file paths — changed from base64 on 2026-08-08 per user request, so photos can be swapped by replacing files in that folder instead of re-embedding base64). Current files: IMG_9838.jpg, IMG_7830.jpg, IMG_0274.jpg, IMG_0318.jpg, IMG_5751.jpg. To swap/add/remove a photo: drop the file into `photos/our-story/`, then add/edit/remove the matching `<div class="story-slide" style="background-image:url('photos/our-story/FILENAME')"></div>` + matching `<span class="dot">` in the `#story-slideshow` / `#story-dots` blocks. The JS (`goStorySlide`) already queries the DOM generically, so slide count isn't hardcoded elsewhere. Right: title, pull quote, body text. Auto-advances every 4s, offset 2s from Chambolle slideshow. Dot indicators.
  - **Meet Chambolle** — card layout: info left, slideshow right. 4 photos (IMG_6864, IMG_8351, IMG_7152, IMG_5928) — base64 embedded. Chambolle stat block removed.
  - **Travel** — Google Maps embed (no API key). Apple Maps + Get Directions buttons. MTR/taxi tips.
  - **Q&A** — 5 questions, single-open accordion (its own, independent of the outer `.more-panel` accordion — see `toggleQA()` vs `toggleMorePanel()` above). RSVP deadline: September 12, 2026. Chambolle answer: "he", "his little castle in 2 Merino Gardens", **"stinky treats"** (confirmed).

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

### Nav
**2026-08-13: flattened, no dropdowns**, per the section-order reorg. With only 5 top-level sections left (Home, RSVP, Wedding Day, Gallery, More) and nothing left to group into a submenu — Our Story/Chambolle/Travel/Q&A collapsed into the single `#more` destination — the old two-dropdown desktop nav and the mobile "More" overflow modal both lost their reason to exist.
- **Desktop `.nav-list`**: 5 flat `<a>` links, no `.nav-dropdown`/`.nav-menu`/`.nav-trigger`/`.caret` markup or CSS left (all removed — grep clean, nothing else referenced them). Labels reuse the old dropdown items' playful copy where it existed: Home, RSVP, "Show Up or Explain Yourself" (Wedding Day), "Photos We Paid Too Much For" (Gallery), "Feel Free to Scroll Past" (More) — same jokes, just promoted from submenu items to top-level links.
- **`toggleDropdown()` removed** from the JS, along with the document-level click-outside handler that only existed to close open dropdowns. `toggleNav()`/`closeNav()` (mobile hamburger, itself dead on ≤700px since `nav { display:none }` there — pre-existing, not touched by this reorg) no longer reference `.nav-dropdown` either.
- **Mobile bottom tab bar**: still 5 tabs, but now a straight 1:1 map to the 5 sections in page order — Home, RSVP, Day, Gallery, More — each a plain `<a href="#section">`. The old 5th tab was a `<button>` that opened `#more-modal` (a bottom-sheet listing Our Story/Chambolle/Travel/Q&A); that modal, its CSS (`.more-modal`/`.more-card`/`.more-close`), and its JS (`toggleMoreModal()`/`closeMoreModal()`) are all gone — `#more` **is** the destination now, not a menu of other destinations, so a plain anchor link is all it needs. (`closeMoreModal()` was also called from the `Escape`-key handler alongside `closeLightbox()`/`closeFloorPlan()`; removed from there too.)
- **Scroll-spy simplified**: the tracked `sections` array is now `['home','rsvp','wedding-day','gallery','more']` (was 8 ids, including the now-nested `story`/`chambolle`/`travel`/`qa`). The submenu-link and dropdown-trigger highlighting logic is gone along with the dropdowns themselves — just a flat `.nav-link`/`.bottom-tab[data-tab]` active-class toggle by matching `href`/`data-tab` against the computed `active` id.
  - ⚠️ **`#more` needed a scroll-spy special case.** It's the last section before the footer, so on a short page (e.g. `#more` collapsed) the browser hits its max scroll position before `#more`'s top ever reaches the normal `<= 80px` activation threshold — the "More" link/tab would otherwise never highlight, stuck showing whichever section qualified last (Gallery). Fixed by also treating "scrolled to the bottom of the page" (`window.scrollY + window.innerHeight >= document.body.scrollHeight - 2`) as `#more` being active. Found by actually testing the click-through, not by inspection — re-test this specifically if `#more` ever stops being the last section, or if a new one is added after it.
- Reference the 🗂 More section above for the accordion-panel mechanism inside `#more` itself — that's a separate, new interaction pattern, not part of this nav simplification.

### Mobile Responsive
- `@media (max-width: 700px)` and `@media (max-width: 390px)`
- **Bottom tab bar (≤700px), not the top hamburger.** Changed 2026-08-12 per user request ("move the drop down hamburger list to bottom," matching a reference screenshot of an app-style bottom tab bar). The top `<nav>` is `display:none` entirely below 700px — not simplified, fully hidden — so the hero photo runs full-bleed to the very top of the screen on mobile, same as the reference. See Nav above for the 2026-08-13 flattening (same bar, tabs now point straight at sections instead of one opening a modal).
  - Bottom bar markup is `<div class="bottom-nav" id="bottom-nav">` — **must be a `<div>`, not a `<nav>` tag.** It was originally built as `<nav class="bottom-nav">`, which also matched the site's existing bare `nav { position:fixed; top:0; ... }` tag selector (for the TOP bar). With both `top:0` (inherited from the tag selector) and `bottom:0` (from the `.bottom-nav` class) applying to the same fixed element, it stretched to fill the entire viewport height instead of sitting as a slim bar at the bottom. Don't rename it back to `<nav>` without also giving it an explicit `top: auto` — or just leave it a `<div>`, which sidesteps the collision entirely.
  - **The Home tab's `active` class is hardcoded in the HTML** (`class="bottom-tab active"`), not left to JS — the scroll-spy handler only runs on an actual `scroll` event, so without this, no tab shows as active until the user scrolls at least once after page load. This matches the existing pattern already used on the top nav's Home link (`class="nav-link active"` is hardcoded there too) — don't remove it thinking JS will handle it on load, it won't.
  - All 5 bottom tabs are now `<a>` tags (2026-08-13 — the old More `<button>` picked up a native focus-ring outline the `<a>` tabs didn't get, making it look like a stray "active" state even when untouched; fixed at the time with `.bottom-tab { outline: none }` plus a proper `.bottom-tab:focus-visible` style, which stays in place and is now moot for the More tab specifically since it's an `<a>` too, but still relevant if a `<button>` tab is ever added again — don't strip the outline without keeping that fallback).
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
- **The Wedding Day section's background is `photos/wedding-day-garden.png`** (garden illustration with Chambolle, added 2026-08-12, referenced as an external file — not base64). The earlier Peninsula watercolour it replaced is gone; don't re-add it without being asked. Don't swap this new image for another without re-checking the `background-position: center 85%` crop — see 💒 Wedding Day for why that specific value matters.
- **The Chambolle photos in the "Meet Chambolle" section** are base64 embedded — do not remove them.
- When adding sections, follow the existing section pattern: `<section id="x"><div class="container">...</div></section>`.
- Scrolling reveal: add `class="reveal"` to new elements — the IntersectionObserver handles the rest.
- **The whole site renders as a mobile view at every browser width** (2026-08-13, see "Site Frame" at the top of section 4) — `#site-frame` caps the page to `var(--frame-max)` (430px), and all the old `@media` breakpoints are `@container` queries keyed to that frame now, not the real viewport. Any new `@media (max-width: ...)` you add won't participate in this system — use `@container` to match the existing pattern. Any new `position: fixed` element needs manual width-capping/centering (`left:50%;transform:translateX(-50%);width:min(var(--frame-max),100vw)`, or `--frame-gap` for edge-offset elements) — it will not automatically respect the frame. Any new **responsive text sizing** (`clamp()` with a `vw`-based preferred value) must use `cqw`, not `vw` — plain `vw` measures the real browser window, not the frame, and will size text for a wide desktop window while it's actually squeezed into the ~430px frame (this caused a real bug: "Christy & Mitchell" wrapped to two lines on desktop until fixed — see the Site Frame section). `cqw` works because `#site-frame` already has `container-type: inline-size`.

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
