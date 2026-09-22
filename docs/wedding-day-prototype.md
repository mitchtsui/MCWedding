# Wedding day prototype — v2, 2026-09-22

## Purpose and entry point

`wedding-day.html` is a read-only wedding party rundown prototype, also linked from `admin.html`. The mobile preview is published at https://mc-wedding-ten.vercel.app/wedding-day.html. It can also be opened directly in a browser; there is no build step. Keep `wedding-day.js`, `wedding-day-now.js`, and `wedding-day-data.js` alongside it.

Acceptance: horizontal day timeline, bride/groom activities, bridesmaid/groomsman duties and locations, usable phone layout, wedding-site palette and typography, source-based instructions without invented assignments.

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
- Downloaded 2026-09-22; source tabs: 重要資料, Rundown, 敬茶, 影相次序, 物資.
- The linked tab is introductory information. The actual schedule is the Rundown tab.
- Data includes all 32 timed events, including six milestones with no end time. Row 18 continues row 17; row 36 continues row 35. Neither continuation was discarded.
- Original Chinese wording is retained. Start/end fields govern the timeline. Two inconsistent duration cells are flagged rather than silently corrected.
- Fixed auspicious windows are preserved; all times are Hong Kong UTC+8.
- Overlapping 15:00–16:00 makeup and M+ photography remain flagged. Missing locations remain unknown.
- Participation is distinct from duty-cell completeness. Explicit participants in titles/notes are included by `namedInSource` in the UI, while empty instructions are marked as such. This prevents filtering out the bride's ceremony or the groom's makeup.
- Row 5 explicitly places the groom at his home, despite the row's overall venue being the bridal hotel. His role view uses that explicit location. Other venues are labelled event locations and the detail view explains role differences.
- Person selection shows team duties, not invented individual assignments. General responsibilities are from the information tab. Reception lead alias `Cha/ HSC` is preserved verbatim pending confirmation of the full names.
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
