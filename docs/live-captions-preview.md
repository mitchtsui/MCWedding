# Wedding captions interface — 2026-10-01

Update 2026-10-02: this document describes the retained `?preview=1` mode.
The separately gated `?live=1` implementation and its unverified deployment/acceptance
gates are documented in [LIVE_CAPTIONS.md](LIVE_CAPTIONS.md).
The admin hub now opens `?live=1`; open `live-captions-admin.html?preview=1`
directly for the retained sample demonstration. The entry paths below describe the
original preview release.

## Outcome and scope

User requested the captions UI follow MCWedding, be integrated into this site and have
an entry in the admin backend. The new pages follow this repository's static HTML/JS
structure, invitation palette and Cormorant Garamond/Raleway typography. No framework,
new deployment, paid service, database migration or existing guest data is needed.

- `admin.html` → **Live Captions** → `live-captions-admin.html?preview=1`.
- Operator header → `live-captions.html?preview=1` in another tab.
- Guest: English / 日本語 / 简体中文, text size, latest caption, history and return to latest.
- Operator: sample playback/pause/resume/end/stop, source and three-language preview,
  truthful connection checklist and manual target-language sample input.

This is **an interactive interface preview**, not a secure live operator backend.
Only `?preview=1` enables sample controls; default routes show waiting/not connected.
No audio is captured or transmitted. No AI or Supabase requests are issued. The public
admin hub/preview precedent applies; a frontend gate would not make this secure.

Prepared text and manual preview input can move between same-browser preview tabs via
BroadcastChannel. This is NOT Supabase delivery, cross-device communication or a durable
caption store. Do not type private speeches into the preview. Input is rendered as plain
text. Blank languages show an explicit unavailable indication, never a fallback translation.
Only language/text-size preferences use localStorage; caption text is not persisted.

The separate `../wedding-live-captions` project remains the TypeScript Phase 0 harness.
Its full brief is still the requirements source. This requested UI preview does not
advance the live ASR/translation/quality/latency/security/venue acceptance gates.

## Design and ownership

`live-captions.css` uses the current invitation palette (not the stale historical palette).
Licensed script fonts are not copied. Labels remain >=11.2 px and controls >=44 px.
Paper panels are square; language controls have the site's compact rounded treatment.
Guest UI has only the chosen target language, no source transcript or operator controls.
The existing invitation and roster flows are unchanged. The admin hub's stale 15-table
description is corrected to the project's established 13-table structure.

Files: two HTML entries, separate guest/operator scripts, shared preview model and CSS.
No Vercel rewrite is necessary for direct static filenames. The public navigation card
does not grant any future microphone/publisher/admin authority.

## Local preview and verification

Open the two HTML files in Chrome with `?preview=1`. Keep both tabs in the same browser
profile to try manual sample delivery. The default URLs deliberately contain no samples.

Browser acceptance script: `node tests/captions-ui-check.cjs`. It uses the already installed
Puppeteer in the sibling `Personal - wset-atlas` project; override `PUPPETEER_MODULE` and
`CHROME_BIN` for another environment. No application runtime depends on that package.
Screenshots go to a task-specific temporary directory, or `CAPTIONS_SCREENSHOT_DIR`.
The script checks 344/390/744/1280 px, controls, selected locales, blank-language behavior,
same-browser updates, text-only rendering, default disabled states and absent live requests.

Validation: Chrome 153.0.8010.48, `node tests/captions-ui-check.cjs` PASS. Both pages at
344/390/744/1280 px had no horizontal overflow, no text below 11.2 px and no button/link
below 44 px high. Language and size controls, playback states, same-browser manual
delivery, literal HTML payload display, missing-locale markers, default disabled states,
admin entry, stable latest/deep-history reading and actual persisted BFCache Back recovery
all passed. No page errors or OpenAI/Supabase/config requests occurred. JS syntax and
tracked-diff whitespace checks passed. Guest/operator screenshots were visually inspected.
Final screenshots: `C:/Users/mitch/AppData/Local/Temp/captions-ui-IDaehh/` (local only).

Earlier check runs exposed a test-runner background-tab stall; explicit tab activation
and bounded cleanup corrected the harness. Product fixes included blank-locale fallback,
latest/deep-history anchoring and BFCache subscription/channel recovery. Actual phones,
Safari, live Auth, Supabase, ASR, venue Wi-Fi and production deployment remain unverified.

## Next implementation gate

The user confirmed a paid Supabase plan; exact tier and project settings are not inspected.
Before making this live, supply dedicated test credentials/audio, complete Phase 0 provider
and same-NAT tests, then replace the demo model with authenticated snapshot/private Broadcast
delivery. Actual operator endpoints must validate Auth and role on the server; the site's
existing client-side email allowlist is not sufficient. Add reviewed RLS, durable finals/
outbox, fencing and stop-upload behavior before enabling live controls.
