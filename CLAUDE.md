# CLAUDE.md — Christy & Mitchell Wedding (MCWedding)

Rules and routing only. History, measurements and the reasoning behind each decision live in
`docs/BUILD_LOG.md` (dated, by section) and `README.md` (setup, data flow, guest-list workflow).
Read the matching part before changing an area; never re-derive a decision that is already logged.

## 1. Facts that must stay right

- **Thursday 12 November 2026 · The Salisbury Room at The Peninsula Hong Kong** (always the full name), Salisbury Road, Tsim Sha Tsui. 17:00–18:00 arrival · 18:30–19:30 ceremony · **20:00–23:00 dinner**.
- Dinner has been 20:00 since 2026-08-24 and the time lives in **three** places that move together: the timeline `.day-time`, the `buildDescription()` calendar text (space-aligned, keep 5 characters), and all three `DEFAULT_TEMPLATES` in `whatsapp-outreach.html`.
- Attire: Elegant Evening Attire. RSVP deadline was 12 September 2026 (passed).
- Chinese names: Christy 芷晴, Mitchell 文俊. Chambolle: Pembroke Welsh Corgi, 3, male, named after Chambolle-Musigny; not attending; expects **stinky** (not sticky) treats.
- Seating: **13 tables × 12 seats = 156**, Room 9 + Foyer 4; tables 4 and 14 are skipped on purpose; 16/17 were removed 2026-09-03; the space right of the stage is empty by request — don't fill it. Per the 2026-08-31 seed snapshot, Expected-Yes alone is 155 against 156 seats with 7 pending — **confirm against `attendance_truth` in Supabase and resolve headroom with the couple before seating anyone** (`BUILD_LOG` §Roster).

## 2. Files — all at the repo root unless stated (there is no `/home/claude`, no `outputs/`)

| File | What |
|---|---|
| `wedding-invitation.html` | the guest site's single HTML entry (~1 MB; photos and `/api/config.js` are external); EN in the DOM, 繁中 + 日本語 via the i18n block |
| `admin.html` → `seating-planner.html`, `whatsapp-outreach.html`, `preview.html`, `wedding-day.html` | admin hub + tools; the hub holds no guest data and has no auth gate by design |
| `wedding-day.html` + `wedding-day.js`, `wedding-day-now.js`, `wedding-day-data.js` | the read-only wedding-party **rundown** (added 2026-09-22): horizontal day timeline, bride/groom activities, bridesmaid/groomsman duties, a current-and-next panel computed for 12 Nov 2026 in Hong Kong (UTC+8) whatever the viewer's zone. Its spec, decisions and acceptance are `docs/wedding-day-prototype.md`; timing tests: `node --test tests/wedding-day-now.test.cjs` |
| `api/config.js` | Vercel function that injects `SUPABASE_URL` / anon key at runtime — nothing is hardcoded |
| `supabase/schema_seed.sql` | schema, RLS, RPCs and the roster **snapshot as of 2026-08-31** (seed regenerated 2026-08-25, two rows added 2026-08-31) (165 numbered guests, numbers 1–202 sparse, + 2 `[PREVIEW]` rows); idempotent. The database is the live truth — re-export before trusting a count |
| `supabase/migrations/` | standalone SQL — incl. `export_roster_as_seed.sql`, `swap_tables.sql`; the read-only check `audit_rsvp_consistency.sql` sits one level up in `supabase/` |
| `photos/gallery/` · `photos/gallery-web/` | full-res originals · 1600 px / q82 site exports; `hero-paris.jpg` and `og-preview.jpg` are separate crops of one photo, both stay |
| `mockup.html`, `supabase/seed-guests.js` | July leftovers. The JS seed holds the 198-row pre-uninvite list and upserts on `guest_number` — **never run it**; it would re-add the uninvited |
| Outside the repo | the printer's die-cut layer PNGs and the hotel floor plan (`SynologyDrive/MC Wedding/`); the licensed Besotted Love `.otf` (ask the couple); the Excel tracker `RSVP_Master_Tracker.xlsx` — location unconfirmed, ask before relying on it |

## 3. Rules — the website

- Edit `wedding-invitation.html` **in place**; never a `-v2` copy.
- Preserve both base64 `@font-face` blocks: **Liana** (RSVP success + seat-card script only) and **Besotted Love** (licensed; hero `.hero-names` and `.footer-script`). Alex Brush is the CDN fallback, nothing more. The Besotted Love embed is subsetted to printable ASCII — non-ASCII copy on those lines silently falls back to Alex Brush.
- The Chambolle slideshow (4 images) and the three egg images are base64 in the file too — do not strip them.
- Keep the `:root` design tokens; no colours outside the palette. `--text-light` is its own value `#58664A`; "and Chambolle" is `#7A5A66` — the older values fail AA, do not restore them.
- Type floor **0.7rem (11.2 px)** and 44 px touch targets. Two CSS exceptions to fix or re-verify when next in that area: `.lang-chip .lang-btn` at 0.68rem and the SVG `.fp-label` at 10.5 units. Keep the `prefers-reduced-motion` and `prefers-reduced-transparency` blocks and the `<h1 class="hero-names">`.
- **Besotted Love needs two fixes.** `.hero-names` keeps `padding-top: 0.48em` (a font property — re-derive only if the font changes). Its `clamp()` font sizes are **string-specific** (the string measures 11.36× font-size wide) — **re-measure whenever the copy on that line changes**; same for `.invite-names` and the seat card's "You're All Set". `.footer-script` needs no padding fix unless someone adds a `line-height`.
- `.hero-script` is the small-caps line and `.hero-names` the big script — the class names are inverted relative to their content; don't rename them.
- Hero: `#home`'s `padding-top` is `calc(var(--hero-photo-h) + …)` on both breakpoints — that token reserves the photo band; never decouple the two.
- Responsive means the real viewport: `@media`, never `@container`; no `container-type` and no `transform` on `#site-frame`; `vw`, not `cqw`; `--frame-max` / `--frame-gap` stay neutralised. **Bulk CSS edits match exact literals** — the base64 blobs contain every letter sequence, a blind replace corrupts image data.
- Section order `Home → Wedding Day → Travel → Q&A → RSVP → Gallery → More`. Anything a guest needs in order to attend never goes back inside `#more`. The scroll-spy `sections` array equals DOM order; `section[id] { scroll-margin-top: 84px }` is keyed to the desktop nav capsule's height.
- Accordions animate `grid-template-rows: 0fr → 1fr`; `grid-template-columns: 100%` is load-bearing; JS toggles classes only and **never measures a height**.
- Glass is for chrome and overlays only (nav capsule, mobile pill, lightbox, modals, egg); paper surfaces stay square-edged; every glass rule sits behind `@supports (backdrop-filter …)` with a near-opaque fallback. Three clearances are keyed to the pill's geometry (`body` padding-bottom, egg, shush toggle) — re-derive all three together.
- The **Wedding Day section of the invitation page** (`#wedding-day`) = the printed invitation rebuilt in HTML/CSS/SVG, **plain**: no artwork, no top ornament, never text over an image. This rule is about that section only — the standalone rundown `wedding-day.html` follows its own document, `docs/wedding-day-prototype.md`. Gold `#C2A56A` is ornament only, never text. The three timeline icons (紅中 tile, interlocking bands, Burgundy glass with the exaggerated bowl) are the couple's picks — don't "tidy" them.
- Gallery: originals in `photos/gallery/`, exports in `photos/gallery-web/`, `data-index` sequential from 0; delete the export when removing a photo, keep the original.
- **i18n:** English in the DOM is the source of truth. Add, remove or reorder any mapped element → update **both** `I18N.zh.dom` and `I18N.ja.dom` in the same commit (verification standard: zero `[i18n] no match:` in the console). Dynamic strings go through `tt()` / `tf()` format strings, never concatenation. Script order: i18n block → main script → egg script. Calligraphy lines, floor-plan labels and calendar text stay English.
- Post-RSVP shows **table only, never seat numbers** — four sites move together: seat-card rows, floor-plan occupant list, `ownSeatLine()`, `buildDescription()`.
- New sections follow `<section id="x"><div class="container">…</div></section>` and get `class="reveal"`.

## 4. Rules — data and Supabase

- `guests` is the master list; `rsvp` holds website submissions. **`guest_number` is the identity, never the name** — numbers are sparse (gaps, never contiguous), and several names repeat across rows on purpose (one row per seat).
- The anon key is public by design; security is RLS plus SECURITY DEFINER RPCs scoped to one invitation code. Service role for admin and seed work only — never in HTML.
- `submit_rsvp` still receives `p_plus_one_name` = `null`. The live signature has no DEFAULT, so dropping the key breaks every submit (PGRST202). **DB migration first, frontend after** — the 2026-08-17 outage was exactly this.
- Schema changes go in `supabase/migrations/`, idempotent, verified on a real Postgres before shipping. The dashboard SQL editor splits plpgsql bodies badly: fresh tab, nothing selected, `$fn$` tags — or `psql` on the session pooler. Run `audit_rsvp_consistency.sql` one block at a time.
- After **any** hand edit to `guests`, regenerate the seed's `VALUES` block with `export_roster_as_seed.sql` and run its sanity checks — a stale seed re-adds uninvited guests (34 of them, once), and a hand-added guest with no number is silently skipped.
- `guests.rsvp_status` is the couple's **pre-invitation expectation, not an answer**. Headcount = the `attendance_truth` view; `attendanceOf(g)` in the outreach tool mirrors it — change one, change both. `[PREVIEW]` rows are excluded from every count. Later source wins (admin record vs website reply).
- `admin_rsvps` and the other `admin_*` names are **views** over `rsvp` — website replies only, never a headcount.
- `guests.phone` wins over `rsvp.phone`: write-through fills blanks only; disagreements surface in `phone_conflicts`.
- Outreach templates live in Supabase (`outreach_templates`); `DEFAULT_TEMPLATES` is a fallback only, and the migration's three seed strings equal it — change both. The seed is `ON CONFLICT (key) DO NOTHING` on purpose: new default copy needs a deliberate row update. **Never cache template copy per browser again.** `groupOverrides` is still localStorage — a known gap, not shared between the two admins.
- The outreach tool reads and writes `guests` directly (`.from('guests')`), not the `outreach_list` view — any column it must show has to exist on `guests`. Each card has two statuses that are not the same thing: **Attending** (`rsvp_status`) and **Outreach** (`outreach_status`).

## 5. Rules — admin tools

- `seating-planner.html`: 13 × 12 is the fixed structure; its grid mirrors the guest-facing floor plan's clusters. Edit in place.
- `admin.html`: navigation hub only. `seating-planner` and `whatsapp-outreach` keep their magic-link gates (`preview.html` has none, by design); all three carry the `.admin-nav` strip, hidden in print in the two gated tools.
- `wedding-day.html`: read-only rundown. Change it per `docs/wedding-day-prototype.md` (row order The day → Bride → Bridesmaids → Groom → Groomsmen; horizontal scrolling only inside the timeline, vertical on the document; current/next panel in Hong Kong time, no fictional "current task" before the day). Run `node --test tests/wedding-day-now.test.cjs` after touching the timing logic.
- Excel tracker, if it is still used: cleaned data only, never the raw `RSVP_.xlsx`; openpyxl for formatting and formulas, pandas for data. Its recalc script is not in this repo.

## 6. General

- Do not invent design decisions — check `docs/BUILD_LOG.md` first. Anything marked ⚠️ Pending: flag it, don't guess.
- Verify in a real browser (Playwright / headless Chromium) at 344, 390, 744 and 1280+ px: zero horizontal overflow, zero i18n warnings, nothing under 11 px, 44 px touch targets.
- Open items: no contact route anywhere on the site (couple's choice 2026-08-17 — revisit before invites); seat headroom against the 156 cap; the ~1 MB file (both fonts, the slideshow and the egg images still base64); `groupOverrides` not shared; the two sub-11 px CSS rules above.

## 7. Where to find what

- `README.md` — setup, Vercel + Supabase wiring (both Redirect URLs), the file table, RSVP and seating flow, guest-list workflow, WhatsApp tool, the wedding-day rundown, the roster snapshot and the go-live checklist. Brought up to date 2026-09-22 (PR #107); when the roster or the tools change, it changes in the same PR.
- `docs/BUILD_LOG.md` — everything dated, by section: hero and typography measurements, the responsive revert, floor-plan geometry, seat-card copy, the invitation card, glass, nav, languages, accessibility floor, the egg trigger table, admin portal, outreach tool, roster history, the Excel tracker sheets. Its sections mirror this file's former §3–§6. Two things it must mark stale when moved: the palette table (5 of 10 values differ from `:root` — the file's `:root` is the truth) and "Q&A nested in `#more`" (top-level since 08-17).
