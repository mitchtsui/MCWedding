# Wedding day prototype — v6, 2026-09-23

## Purpose and entry point

`wedding-day.html` is a read-only wedding party rundown prototype, also linked from `admin.html`. The mobile preview is published at https://mc-wedding-ten.vercel.app/wedding-day.html. It can also be opened directly in a browser; there is no build step. Keep `wedding-day.js`, `wedding-day-now.js`, and `wedding-day-data.js` alongside it.

Acceptance: horizontal day timeline, bride/groom activities, bridesmaid/groomsman duties and locations, usable phone layout, wedding-site palette and typography, source-based instructions without invented assignments.

## v6 — refreshed workbook snapshot (2026-09-23)

The couple requested alignment with the updated source workbook. The latest XLSX was downloaded directly from the existing Google Sheets source on 23 September 2026. Its SHA-256 is `66bdc83be5e87d29cfabdac5ec0416fb5cc7d5ec7aa8d814e652b43b7c2c0da6`; the binary stays outside the repository.

- The workbook retains the same five tabs and event rows. All 24 changed source cells are reflected in the refreshed snapshot; this is still a static page, not automatic spreadsheet synchronization.
- `Rundown` row 22 now places bridal restyling at 14:30–15:00, before the 15:00–16:00 M+ photos. The previous photo overlap is resolved, but the new start overlaps row 21's 14:10–14:40 lunch by ten minutes for the bride and groom; flag both events without changing source times. Row 5's duration was corrected to 150 minutes, resolving its warning. Row 26 still states 30 minutes against 17:00–18:00 (60 minutes), so that warning remains.
- Row 23 now shows `M+`, rows 25/27/30 show `酒店 ballroom`, and row 29's original ceremony notes include the champagne-together re-entry and Champagne Tower. Resolved missing-location warnings are removed.
- The aliases added in `重要資料` G7:G10 are preserved. The reception aliases now resolve explicitly to Charlie Lee (Cha) and Ho Shuk Ching (HSC); both names carry the reception responsibility from E26 in their person view, and the obsolete identity question is removed.
- The 11 changed packing-list status cells from `物資` are refreshed, including normalized spelling/spacing and the newly entered `No` at C31; the tea and photo-order values are unchanged. The existing layout, source-based participation rules, Hong Kong timing module and guest website are unchanged.

### Source alignment validation

- A separate read-only checker compared all 782 source fields: 32 events, six milestones, both continuation rows, all 84 reference rows (304 cells), and ten people with aliases and responsibilities. All match the downloaded XLSX. It also verified the remaining lunch/restyling overlap and row 26 duration warning, the fixed windows and the wedding date. Historical review claims in the existing documentation were encountered but were not used as evidence; the review was not fully isolated.
- Direct clock checks for bride and groom show both lunch and changing/restyling at 14:35, changing/restyling at 14:45, and photography at 15:00 HKT. Six Chromium browser groups passed at 344/390/744/1440px, covering the new source fields and warnings, the bride's current-task transition, aliases and assigned reception responsibilities, source labels, event and reference dialogs, no page overflow, 44px events and the 11.2px type floor. No JavaScript or console errors. The site fonts loaded; the 390px screenshot was visually inspected.
- Existing timing tests passed 7/7. Data JavaScript syntax and diff checks passed. Physical Safari/Android and assistive technologies remain untested. Raw workbooks and local test artifacts stay outside Git; no guest database access or writes occurred.

## v5 — sticky ruler, aligned hours, phone layout (2026-09-23)

Built from the reviewed mockup in `mockups/wedding-day-review-2026-09-23/` (Codex built it, Claude reviewed it in the browser, Mitch approved the functional plan, asked for a design check, said "Update mockup", then "Claude proceeds to coding and have CODEX to final check"). The mockup folder is Codex's working record, not part of the site.

- Hour gridlines match the hour labels in every period: the lane gradient is offset by the period start's minute remainder (`--grid-offset`, set by `renderTimeline`), from the same numbers that place the tick labels. Full day and Morning start at 05:30 and were 30 minutes off before.
- The hour ruler sits outside the horizontal scroller, inside `.timeline-wrap`: sticky under the measured controls-bar height above 540px, at the viewport top at 540px and below, and it releases at the end of the timeline. Its track follows the scroller one way (a transform from `scrollLeft`) and is never scrollable itself. The Now/Preview chip has its own 24px strip under the ticks so it never covers an hour label; the dot sits on that strip and the line starts at the top of the lanes.
- Trailing space is part of the width formula (label column + period width + 90% of the visible time grid), so the 10% framing survives every re-render. Manual horizontal browsing survives role, search, view and breakpoint re-renders, including a no-result search followed by clearing it. Period pills frame the current time at 10% when it lies inside the period and start at the period's beginning otherwise. Clock ticks never move the horizontal position.
- Event titles stay one line with a desktop tooltip carrying the full time and title. Inside wider blocks the time and title are `position: sticky`, so an ongoing event such as LUNCH stays readable while its start is under the frozen label column; the block clips with `clip-path` because `overflow: hidden` would make the block its own scroll container and defeat the sticky text. Widths, timings and the 105px minimum are unchanged.
- The three navigation and source links are 44px targets. Every 11px size became 11.2px, the site's type floor.
- Native scroll anchoring is off (`html { overflow-anchor: none }`). When a clock update changes the summary panel's height while the reader is below it, `readingAnchor` in `wedding-day.js` corrects the residual displacement of the schedule heading once, and yields to a scroll that happened meanwhile or to an open dialog. No fixed-height cards.
- Phone layout, 540px and below, applied by the layout block at the top of `wedding-day.js`, which moves the same nodes into slots and never duplicates them: the name/team selector sits above the task cards; the intro drops the tagline; the current task stays prominent and the two next tasks are compact two-column rows with Raleway numerals; a one-line source cue and the three auspicious windows sit above the controls; the controls are the view toggle plus a Search disclosure, with a visible 44px "Clear filter ×" control while a query is active and the field is closed; the schedule heading is visually hidden and the count line plus the "Preview hh:mm" / "Show now" button take its place; the full prototype notice, the role note and the "Preview a time" control live in a "Rundown notes & preview time" disclosure below the timeline. Above 540px the page is unchanged apart from the items above.
- Measured on the production page at 390px, groomsmen link, from the page top: selector 237, current card 346, cards end 660, source cue 668, windows 724, controls 821, ruler 1015. Before v5 the ruler was at about 1618.
- Validation, 2026-09-23, Chrome on Windows, phone widths as same-origin iframes because the window would not shrink below its minimum: timing tests 7/7 unchanged, `node --check`; at 1267, 390 and 344px no page horizontal overflow, smallest text 11.2px, 44px links and event boxes, chip clear of the 15:00 tick, marker at 10% of the visible grid (within 1px at 344), the 06:00 tick and the first gridline both at 190px, LUNCH text 8px inside the visible grid at 390 and 344 while its block starts 20px behind the labels, ruler under the controls at 132px and released at the timeline end, 23:40 then Bride keeps scroll and marker, Evening frames, Morning resets, Full day re-frames, a no-result search hides the ruler and clearing restores the position, the search disclosure and clear-filter flow, the real-clock "before the day" state, zero page-origin console errors.
- The initial Claude build check did not cover physical phones, Safari, touch gestures, or the 14:39→14:40 tick on the production page. Codex's final check below adds emulated touch and the production clock-transition check; physical phones and Safari remain unverified.

### Codex final review and resize fix — 2026-09-23

- Reviewed Claude's implementation commit `c478474`. One P2 was reproduced: widening a phone view while browsing late in the day lost its horizontal position because the browser clamped against the old track before the resize callback recorded it.
- `wedding-day.js` now records manual horizontal position on scroll and only accepts readings from the viewport width for which the track was rendered. Resize restores the saved position against the new track, clamping only to its new maximum. It does not recenter a reader who is browsing manually; explicit Show time still restores 10% framing.
- Regression: 390px at 23:40, scrollLeft 2154 → 1440px now lands at the new maximum 2099, instead of the erroneous 1205. Show preview time then gives scrollLeft 2059 and a marker at 9.98% of the visible grid. Manual position 2000 survives 390→844→1440→390, including My duties and empty-search transitions.
- Browser acceptance passed at 344/390/744/1440px: no page horizontal overflow or inner vertical range, all 32 events and five lanes, 44px event heights, 11.2px text floor, ruler/grid alignment, initial and explicit 10% framing, source-based role and dialog behavior, filter/view/period state, compact phone controls, search clearing, and focus across resize. No uncaught JavaScript errors.
- On the production page, a controlled actual-clock 14:39→14:40 transition changed the summary while the reading anchor moved only 0.53px and timeline scrollLeft stayed 275. Chromium CDP vertical touch moved the document; horizontal touch moved the timeline and kept its ruler synchronized. Before/after-wedding fixtures remained truthful.
- The existing Node timing suite passed 7/7; JavaScript syntax and diff checks passed. Data and timing modules are unchanged. A separate read-only reviewer reproduced the resize defect and verified the correction with local Chromium; it found no remaining material issue. Review used shared files and encountered prior review claims in project documents, so it was not fully isolated.
- Final automation blocked external requests, including Google Fonts, and its screenshots use available fallback fonts. Claude's earlier browser measurements above covered the styled production page. Physical Safari/Android and assistive technologies remain untested. No guest database access or writes were performed. The untracked mockup folder is excluded from publication.

## v4 — open at the current time

- On the first visible timeline render, jump to the current/preview time with 10% of the visible time grid before the line, excluding the fixed role-label column. Preview changes and “Show now” use the same position. Clock ticks do not move the user's browsing position.
- At the start of the day the position clamps to the beginning. Extra trailing space allows the 10% position late in the day. Opening initially in My duties defers positioning until the timeline is shown.
- Browser checks passed at 344/390/744/1440px for initial framing, explicit preview changes, late-day position, start boundary, Show now, deferred duties, unchanged position on clock ticks, no vertical jump, and no page overflow. A read-only reviewer independently checked positioning calculations and event wiring without finding material issues.

## v3 — current-time line and compact events

- A rose line, dot, and time label span the timeline using the same Hong Kong clock as the top task cards. In preview mode the label says “Preview”; on the wedding date it says “Now”. The marker is hidden outside that date or the selected period. It updates on the existing 30-second/page-resume clock without moving the user's scroll position.
- “Show now” / “Show preview time” brings the marker into view. It switches to the full day if the selected period excludes that time; a search with no results is cleared so the timeline can be shown.
- Event height is 44px (previously 61px), retaining the 44px touch target and existing 11px time / 12px title sizes. Track spacing is 50px (previously 70px), with tighter row padding. All vertical scrolling remains on the document.
- Browser checks passed at 344/390/744/1440px: marker alignment across periods and resizing, full-height line, marker click-through, real/preview/date-boundary behavior, timed updates preserving horizontal position, show-time navigation, exact 44px boxes, and no nested vertical or page horizontal overflow. Desktop/mobile screenshots were inspected for readable text. Existing seven clock tests passed.
- Fresh-context read-only review found no material issues; it independently checked seven clock callback cases plus positioning/scrolling code. Physical mobile browsers remain untested.

## v2 — scrolling and current tasks

- User requested horizontal-only scrolling inside the timeline, with all vertical scrolling on the document. Both desktop and mobile height caps were removed; the timeline expands to its complete content height and only overflows horizontally.
- Row order is The day → Bride → Bridesmaids → Groom → Groomsmen. The role picker and detail-role order follow the same grouping.
- A panel directly below the date shows current task(s) and the next two events for the selected person/team. Search and period browsing filters do not hide current or upcoming duties.
- In a person/team view, the sourced role duty is the primary task text and the general event title is secondary context. Empty duty cells are labelled honestly. This avoids calling the groom's 05:30 preparations “bridal makeup” or his 15:00 suit change “bride restyling”.
- Time is calculated against 12 November 2026 in Hong Kong (UTC+8), independently of the viewer's local timezone. Before the wedding it shows no fictional current task, just the first two upcoming events. After the selected schedule ends it reports completion; gaps show no current task. Overlapping tasks are all retained.
- Events with no end time are treated as milestones during their start minute only, without displaying an invented duration. Optional “Preview a time” uses the wedding date and is explicitly labelled; turning it off resumes actual time. The panel refreshes every 30 seconds and on page resume without rerendering the timeline.
- Verification: 7 timing tests passed with `node --test tests/wedding-day-now.test.cjs`, including before/day/after, UTC/HKT date boundary, end-exclusive intervals, overlaps, gaps, milestones, and selected-team inputs.
- Browser checks at 344/390/744/1440px: no page overflow, no timeline vertical scroll range, horizontal scrolling works, lane order matches. Vertical wheel scrolls the document; emulated mobile touch verified vertical page swipes and horizontal timeline swipes independently. Panel tests verified role selection, overlapping tasks, preview time, search/period independence, and opening event details. No JavaScript runtime errors in these checks.
- Physical phones and Safari have not been tested.
- Fresh-context read-only review independently checked the scrolling behavior, order, and time logic. Its finding about generic titles in role-specific task cards was fixed and covered by source-equality browser assertions for the groom's 05:45 and 15:30 cards.

## Source and decisions

- Workbook: https://docs.google.com/spreadsheets/d/1Ryel1N44PAf1e1gXTHSHXREiQ72liIyu/edit?gid=311413032
- Initially downloaded 2026-09-22, refreshed 2026-09-23; source tabs: 重要資料, Rundown, 敬茶, 影相次序, 物資.
- The linked tab is introductory information. The actual schedule is the Rundown tab.
- Data includes all 32 timed events, including six milestones with no end time. Row 18 continues row 17; row 36 continues row 35. Neither continuation was discarded.
- Original Chinese wording is retained. Start/end fields govern the timeline. Inconsistent duration cells are flagged rather than silently corrected; resolved warnings are removed when the source is corrected.
- Fixed auspicious windows are preserved; all times are Hong Kong UTC+8.
- Bridal restyling is now 14:30–15:00, before 15:00–16:00 M+ photography. The former photo overlap is resolved, but the 14:30–14:40 overlap with lunch is flagged for the bride and groom. Missing locations remain unknown.
- Participation is distinct from duty-cell completeness. Explicit participants in titles/notes are included by `namedInSource` in the UI, while empty instructions are marked as such. This prevents filtering out the bride's ceremony or the groom's makeup.
- Row 5 explicitly places the groom at his home, despite the row's overall venue being the bridal hotel. His role view uses that explicit location. Other venues are labelled event locations and the detail view explains role differences.
- Person selection shows team duties, not invented individual assignments. General responsibilities are from the information tab. Reception aliases `Cha/ HSC` now map to Charlie Lee and Ho Shuk Ching, as explicitly identified in the 23 September source.
- Small timeline blocks have a minimum touch width; exact times are printed. A diamond denotes no stated end time. Overlapping blocks use separate tracks.
- Tea, photo order, and supplies retain source headers and statuses.

## Validation actually performed

- Both JavaScript files passed `node --check`; tracked diff passed `git diff --check`.
- Headless Chromium at widths 344, 390, 744, and 1440: no page-level horizontal overflow in timeline or duties views. Timeline scrolling is intentionally internal.
- Tested role and name selection, period filtering, search/no-results, event dialog opening and Escape dismissal, all three reference dialogs, and no JavaScript runtime errors.
- Regression assertions: bride r5/r8/r29, groom r9/r11, groomsmen r11/r26 retained; groom r5 location correct; `Cha/ HSC` visible.
- Desktop and mobile screenshots inspected locally; browser checks used the installed Puppeteer/Chromium outside this repository without adding dependencies.
- A fresh-context read-only reviewer compared all 32 start/end times and reference rows to the original workbook, verified continuation rows, and identified three source-mapping defects. These were fixed. A targeted re-review found a further missing groomsmen reception mapping; fixed and covered by the browser assertion.
- Review used shared files, not an isolated checkout; it was independent model review, not professional sign-off.

## Limits and next decisions

- Initial prototype delivery was local only. The user subsequently authorized committing and pushing this prototype to check on mobile. No database writes or outward messages are part of that publication.
- Static snapshot only: no live Sheets sync, assignment editing, shared completion tracking, or authentication implemented. Do not treat it as a final operating schedule.
- No live RSVP testing was needed or performed. Physical iOS/Safari/Android devices were not tested.
- Mobile preview publication is authorized. The static page has no sign-in gate and includes wedding-party names and the day itinerary. Resolve source scheduling conflicts and unnamed responsibilities before using it as the final day guide.
- To update source content, update the single data file and recheck participation mappings and source row references together. Do not overwrite source timings to conceal conflicts.
