# MCWedding consolidated captions and hub handover

## Current state v3 as of 14 October 2026

This section supersedes the historical handovers below for current status. It reconciles
the saved-script caption work with the wedding-party hub and incident repairs.
The sessions exchanged read-only handovers on 14 October; both source checkouts were
inspected. MCWedding is the canonical integration
repository. Continue coordination from the hub session, preserving the other checkout.

### Production and operating state

- The [wedding-party hub](https://mc-wedding-ten.vercel.app/wedding-party.html) is live:
  Wedding Day, VIP portraits, read-only seating and the caption tab. Hub entry and caption
  operation use separate server-side passwords. Do not record their values in Git.
- Latest verified production source: `e1ab495`, deployment
  `dpl_9nr9jvndicJSAbMbdVqqKnrQKN8J`, READY. Saved speeches and manual captions are
  included alongside PC playback input. Main was fast-forwarded and pushed.
- Live captions are deliberately disabled. Production config and stream rejection were
  verified; the last database read found zero open runs. Do not interpret a live hub as
  a currently enabled caption service.
- The user applied the nonretrying-conflict migration and reported no further error
  stream after terminating the identified backend. One controlled stopped-run claim
  promptly returned HTTP 409 / PT409. Eleven local regression checks passed; the patch
  received separate read-only review. Details are in `WEDDING_PARTY_HUB.md`.
- Automatic Git deployments are disabled. Release via Vercel CLI from the authorized
  workspace containing ignored `hub-private/vip-data.json` and `photos/vip/` attachments.
  Keep those files out of Git and static output; preserve the missing-asset build guard.

### Deployed script and manual subtitle work

The feature is now integrated into `codex/integrate-prepared-captions` in MCWedding,
including hub-cookie authorization, PT409 conflicts and consistent service-role ticket
ownership. The original checkout below remains preserved. Integration validation is
recorded in `CAPTIONS_TEST_REPORT.md`. The user confirmed both corrected migrations were
applied. Hosted read-only checks confirmed the new tables/columns and both feature RPCs
in the wedding project, with zero open runs. The production caption assets match the
tested source. Captions remain disabled, so operator login/preparation/playback are
intentionally unavailable until the controlled test window.

The separate checkout is
`C:/Users/mitch/Documents/Projects/git/wedding-live-captions/.cache/captions-production`,
branch `codex/captions-production-20261013`, base commit
`c69550cba53f50618d941804e3a344f7d8e01d37`. Its feature is **uncommitted**: 19 modified
and seven untracked files at reconciliation. There is no feature commit to cherry-pick.
Do not overwrite current MCWedding files with this older checkout or remove the checkout.

That work implements pre-audio event preparation, separate saved speeches with edit and
selection, no-script mode, prepared translations in English/Japanese/Simplified Chinese,
explicit review, and manual Show / Next / Clear. Manual playback uses a separate run
from automatic audio captions, with durable operation IDs and stale-action guards.
No actual wedding speeches or reviewed translations have been supplied.

Main integration paths are `api/captions.js`, `live-captions-admin.html/js`,
`live-captions-client.js`, `live-captions-guest.js`, `live-captions.css`, and
`lib/captions/{prepared-speech,store,http,gateway,delivery,protocol}.cjs`, with their
caption tests. The source checkout's `docs/SPEECH_SCRIPTS.md` and
`docs/SPEECH_SCRIPTS_TEST_REPORT.md` describe the workflow and prior validation.

Its historical evidence is a passing build, 224 full caption tests, 48 focused lifecycle
checks after UI fixes, and mocked Chrome checks at 344/390/744/1280 px. The other session
confirmed these records, but these tests were not rerun against a combined implementation.
They do not establish hosted database retry safety or real speech/venue performance.
The combined implementation now has its own validation in `CAPTIONS_TEST_REPORT.md`.

### Corrected migration sequence

Apply only these integrated files, in order, to the wedding Supabase project
`szqydwvsjmaobkckrerl`, after reviewing the integration validation:

1. `supabase/migrations/2026-10-14_saved_speech_scripts.sql`
2. `supabase/migrations/2026-10-14_prepared_speech_cues.sql`

These preserve PT409 and the password operator's consistent ticket ownership. Local
PGlite tests exercised the full migration chain, repeated application, grants, RLS,
manual/live exclusivity and stale conflicts. Hosted schema/RPC availability was checked
after the user's application; full hosted SQL source inspection is unavailable with
the service-role API credential. Missing-record probes returned expected P0002 errors
(PostgREST HTTP 500), without creating data or audio sessions.

Do **not** apply the old checkout's raw migrations:

1. `2026-10-13_saved_speech_scripts.sql`
2. `2026-10-13_prepared_speech_cues.sql`

Inspection found one and nine custom SQLSTATE `40001` raises respectively. These would
reintroduce the PostgREST retry defect. All application-level conflicts must follow the
current nonretrying PT409 convention, with matching tests and API mapping.

The prepared-cue migration also replaces `caption_issue_uplink_ticket`, restoring
`publisher_id=auth.uid()` while its ticket user falls back to a zero UUID. That would
undo `2026-10-13_caption_password_operator.sql`. Merge the manual-mode restriction with
the current consistent operator identity instead. The migrations also replace
`caption_upsert_script`, `caption_runtime_context` and `caption_snapshot`; compare their
live/current definitions before preparing the final migration sequence.

The feature API predates hub cookie authentication and assumes Bearer authorization.
Integrate all new operator actions with existing hub/operator checks, session recovery
and logout behavior. Preserve the direct guest QR flow and public-key verification.

### Consolidated next sequence

1. Integration checks and read-only review are complete on
   `codex/integrate-prepared-captions`; the original source checkout is preserved.
   See `CAPTIONS_TEST_REPORT.md` for validation evidence and local-test limits.
2. Completed: the user applied both corrected migrations; hosted availability checks
   passed. Do not reuse the other session's earlier raw-SQL instructions.
3. Completed: main was merged and deployed through CLI with private assets. Hosted
   hub gates, portraits, seating projection, guest viewer and logout passed. Keep
   captions disabled until a controlled test window.
4. Arrange a controlled caption enablement/test window. Verify Mac microphone/PC input,
   guest viewing, pause/end/stop, stream handoff, script selection, manual Show/Next/Clear,
   and no stale runs or recurring errors. Keep captions off until that window.
5. Enter the actual speeches and explicitly prepare/review translations. The earlier
   70–80% Cantonese recognition estimate was user feedback, not a measured guarantee.

The user will use a MacBook Pro and has not bought an interface. The hotel confirmed a
line-level mixer feed containing all three wireless handhelds and two XLR M/F cables.
The proposed interface is a Scarlett 2i2 4th Gen via its TRS line input and an appropriate
XLR-female-to-TRS-male cable; purchase is not confirmed. No advance venue rehearsal is
available: test locally beforehand and arrange the hotel signal check on the day.
High-resolution VIP portrait replacements are also pending.

## Historical handovers

Written 2026-10-03 by Claude Code on the main Windows PC. Codex holds the branch from here;
Claude has stopped and holds nothing.

**Deployed preview at Claude's handover (historical).** Live captions work end to end on a public Vercel **preview** of
branch `codex/live-captions-ui` (HEAD `10988b5`, pushed). The operator runs captions from the
admin portal; guests scan a QR code and read, with no account. The user tested it with the
Mac's microphone and with a phone, and called both good. **Production (`main`, the live
wedding site) is untouched**: no merge, no production variables, captions off there.

## Codex continuation — 3 October 2026

The historical handover below describes the earlier preview. Codex resumed at `4a8c366`
on the same branch. User selected **Pause stops
the microphone immediately and finishes already-captured words; Emergency stop aborts**.
Implementation and regression evidence are recorded in `CAPTIONS_TEST_REPORT.md`.
Final local validation: 192/192 caption tests, build and mocked Chrome suite passed;
read-only review found no remaining reproduced blocker within its documented scope.

New work: pause drain, truthful recognized-final coverage on End, and
`scripts/captions-observe.cjs` for read-only one-run metadata. No applied migrations were
edited. No paid API test or database mutation was made in this continuation. Existing
untracked `mockups/` was preserved. On 3 October the user explicitly authorized committing,
pushing and publishing these changes to the existing branch preview only. Production
changes remain outside that authorization. Verify the resulting deployment against Git
and Vercel before starting a rehearsal.

Read-only checks confirmed the preview responds, captions are enabled, its Supabase
project matches local `.env.local`, anonymous Auth is disabled and new signups remain
enabled. The user has been asked to disable signups and check the user list; no response
has been recorded. The six-minute preview run is still unverified; the user was offered
an automated replay preparation or a Mac microphone rehearsal. Do not infer approval for
paid tests or production changes from the availability of keys.

Publication verified on 3 October: application commit `d85654b` was pushed to
`codex/live-captions-ui`; Vercel preview `dpl_3EKSGmGD1dtsNN9bKzLWvYkjKe9Z` reached READY.
The branch alias returned HTTP 200 for the admin page, and the deployed admin script
matched the committed file after line-ending normalization. Configuration reported
captions enabled and guest links ready. Production homepage returned 200; its caption
API returned 404. No production deployment or configuration change was made.

The user asked where to provide a prepared speech: signed-in admin page, Prepared
language support > Advance script > Save script. It currently accepts pasted text,
not Word/PDF uploads, and Save requires an event created by Start. Pre-capture script
preparation is a known workflow gap, not fixed by this publication.

Next: verify Pause/Stop and the six-minute handoff on the preview, then longer/multi-phone
testing and the Peninsula HK audio/network rehearsal. Use the observer instructions in
`LIVE_CAPTIONS.md`; do not substitute local mock tests for real audio evidence. Keep the
existing production and venue/load/quality gates.

Read, in this order:
1. This file. It says what is true now and what is open.
2. `docs/LIVE_CAPTIONS.md`, the design and operator behaviour. "Access" and "When capture
   stops without the operator asking" matter most.
3. `docs/CAPTIONS_TEST_REPORT.md` for what was verified, how, and what was not.
4. `docs/CLAUDE_HANDOVER.md` is your 2 October handover to Claude, plus Claude's afternoon
   update. Its open-items list is superseded by this file.

## 1. What Claude did after your handover

Commits, oldest first, all on `codex/live-captions-ui`:

| Commit | What |
|---|---|
| `5ce293a` | Your caption work plus Claude's lifecycle repairs (three independent review passes), the Supabase `pgcrypto` fix and the microphone-permission fix. First commit of the feature. |
| `8af2958` | Records the first Vercel preview run (Mac microphone, 55 s). |
| `ab5d51d` | Guests by QR code with no account (user's decision). Replaces anonymous sign-in and invite redemption. |
| `920c7ec` | Hardening from security review round 1 (rate limits, replay protection, revocation). |
| `10988b5` | Fixes from review round 2 (shared-IP lockout; guest-page regressions in normal use) plus `tests/captions-guest-page.test.cjs`. |

Two background agents did much of the server work under Claude's specs and checks. Every
fix was proven to fail its own test when undone.

## 2. Live state outside git (verify before relying on it — W1)

**Supabase (the wedding project, the one the site's `SUPABASE_URL` uses):**
- Applied by the user in the SQL editor on 2 October, after read-only pre-checks:
  `supabase/migrations/2026-10-02_live_captions.sql` (already including the `pgcrypto` fix)
  and `2026-10-02_live_captions_guest_links.sql`. Verified: 14 tables, 35 caption functions,
  2 Realtime policies; `caption_guest_access` callable by the service role only.
  **Never edit an applied migration file. Add a new one.**
- Realtime: public channels allowed (user checked). Guests depend on this.
- Auth redirect URLs: `http://127.0.0.1:4790/**` was added for local tests (seen in the
  user's paste; **remove when done**). The user was asked to add the preview address `/**`;
  the list was not seen afterwards, but operator sign-in on the preview worked.
- **"Allow new users to sign up" is ON.** The user was asked to switch it off and to check
  that Authentication → Users holds only the couple. Not confirmed yet. This is an
  existing-site exposure, not a caption one: the existing schema grants the RSVP list,
  the outreach list with phone numbers and attendance to `authenticated`, and anyone can
  become `authenticated` by signing up.
- Test data in the caption tables only: 8 events, 13 runs (2 still `live`, 2 `paused`),
  79 source lines, 234 captions, 820 operational events, 273 outbox rows, 2 invites. No guest
  data is involved. Delete only with the user's say-so (W5: quote the exact scope first).

**Vercel project `mc-wedding`:**
- **Deployment Protection is OFF** at the user's request (2 Oct), so every preview of the
  project is public. It was `all_except_custom_domains`; restore it in Project Settings →
  Deployment Protection. Production responded 200 before and after.
- Preview address for this branch (stable):
  `https://mc-wedding-git-codex-live-544ddd-mitchelltsuimc-1664s-projects.vercel.app`
- Variables scoped to **Preview, branch `codex/live-captions-ui` only**: `CAPTIONS_ENABLED=true`,
  `CAPTIONS_ALLOWED_ORIGINS` (the preview address), `SUPABASE_SERVICE_ROLE_KEY`,
  `OPENAI_API_KEY`, `CAPTIONS_GUEST_LINKS=true`, `CAPTIONS_GUEST_SIGNING_KEY`. The existing
  `SUPABASE_URL` and `SUPABASE_ANON_KEY` cover Preview and Production. Production has no
  caption variables.
- Functions run in `iad1` (US East).

**This PC:**
- `MCWedding/.env.local` (ignored by git and by Vercel uploads) holds the Supabase URL and
  both keys, the OpenAI key, `CAPTIONS_GUEST_LINKS` and the guest signing key. Values were
  never printed. The user's source file is `Documents/Wedding Live Translation.txt`.
- **Trap:** this PC's process environment has `SUPABASE_URL` and a service key for a
  **different** Supabase project. Anything local must read `.env.local`, not the process
  environment.
- `.vercel/` links the folder to `mc-wedding` (git-ignored).
- `mockups/` is untracked: your record, deliberately not committed.

## 3. Verified, and what is not

- `node --test --test-isolation=none tests/captions-*.test.cjs tests/captions-*.test.mjs`:
  174 pass (about 60 s).
- `npm run build` must run before `node tests/captions-live-browser.cjs`, which needs
  `vendor/qr.js`; that browser suite passes. `node tests/captions-ui-check.cjs` passes.
- Real services: a local run against real Supabase and OpenAI, with recorded Cantonese
  played into Chrome as its microphone. Then the Vercel preview with the Mac's microphone.
  Then a phone scanning the QR code (on `ab5d51d`; `10988b5` looks the same).
- **Not shown:** the 240-second stream handoff on Vercel (no run has gone past about 60 s
  there), any measured reconnect timing, 50 phones at once, a three-hour run, the hotel's
  audio and network, or human-reviewed translation quality (the 100-phrase gate).

## 4. Open items, in the order Claude would take them

1. **User: switch off sign-ups** and check the user list (section 2). Security of the
   existing site.
2. **The 6-minute run on Vercel.** Start on the Mac, play a long Cantonese video near the
   microphone, End after about 6 minutes, then check `caption_operational_events` for gaps
   and a second stream connection. This is the only proof that a long speech survives
   Vercel's 300-second function limit.
3. **Pause should finish the last words** (as End does), and End should report finals left
   untranslated. Today Pause cuts the stream at once, a line still being translated is
   dropped, and End from paused does not say so. Proposed to the user, no answer yet.
4. **Before the wedding:**
   - Load the couple's, family and venue names into the glossary; names were the weakest
     part of recognition.
   - Run the functions in a Hong Kong region.
   - Choose guest-link expiry times.
   - Plan the production rollout: production variables, `CAPTIONS_ALLOWED_ORIGINS` set to the
     production domain, Supabase redirect for the production `live-captions-admin.html`, and
     then a merge to `main`. All of it is the user's call.
5. **Tidy-up:** test rows (with the user's OK), the localhost redirect URL, and whether to
   turn Vercel protection back on once testing ends.
6. **Known and accepted for now** (listed in the test report):
   - Limits and caches are per Vercel instance.
   - Someone who extracts the guest channel name can keep listening until guest links are
     switched off or the key rotates.
   - Reloading the operator page starts a new event.
   - One operator page per event.
   - Recovering a partly translated final retranslates all three languages.
   - The page's API requests have no timeout.
   - The reconnect budget has not been measured.

## 5. Traps that cost time this session

- The 4 token functions needed `SET search_path = public, extensions`: Supabase keeps
  `pgcrypto` in `extensions`. The PGlite fixture `database({ supabaseExtensions: true })`
  reproduces that layout; use it for any new SQL that hashes.
- `vercel link` silently appends `.env*` and `.vercel` to `.gitignore`, which hides
  `.env.example`, and adds `VERCEL_OIDC_TOKEN` to `.env.local`. The `.gitignore` lines were
  removed again.
- In Git Bash, `vercel api /v9/...` needs `MSYS_NO_PATHCONV=1`, or the path becomes a
  Windows folder.
- Chrome's fake microphone (`--use-file-for-fake-audio-capture=<wav>%noloop`) fails silently
  if the path reaches Chrome with quote marks. The page then reports "The selected
  microphone disconnected".
- Chrome lists a microphone with an empty id until the site has permission. That is why the
  operator page has **Allow microphone**.
- Don't deploy during the event: the signed guest-message format changed during this work,
  and a mid-event change of format or key makes open phones resubscribe or drop messages.
- The guest-page tests stub timers with `.unref()`. Without it the test process never exits,
  because each simulated phone keeps a fallback timer running.

## 6. Where Claude's local test tools are

These are not in the repo; they are in Claude's session scratchpad on this PC and are not
needed to continue:
- A local runner that served the real stack against real Supabase and OpenAI on port 4790,
  with a live transcript view.
- A stand-in runner with fake services on port 4789.
- A 2-minute excerpt of the downloaded test podcast, and the reviewer harnesses.

Rebuild a runner from `api/captions.js`, `api/config.js` (it needs a `res.status`/`res.send`
shim outside Vercel) and `api/captions-stream.js` (route `upgrade` events to it) if you need
one.
