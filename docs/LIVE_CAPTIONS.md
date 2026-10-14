# Live captions implementation and release gates

## Scope and current status

**14 October 2026:** captions are intentionally disabled after the PostgREST retry
incident. The database now uses nonretrying PT409 caption conflicts and the production
application preserves HTTP 409 handling. The hub remains available. See
`CODEX_HANDOVER.md` for the consolidated release state and `WEDDING_PARTY_HUB.md` for
incident evidence. The script-library/manual-subtitle integration described below is
validated locally; see `CAPTIONS_TEST_REPORT.md`. Hosted SQL application and deployment
remain pending. Do not treat this document as approval to activate captions.

Production release authorized on 13 October 2026: the user requested merging to
main and making the caption service, including PC playback audio, live on Vercel.
The release combines the caption branch with the latest published wedding rundown.
This supersedes earlier preview-only authorization below. It does not establish
venue, sustained-stream or language-quality acceptance. Production uses the
existing designated caption project and the exact production origin
`https://mc-wedding-ten.vercel.app`; no database migration or paid replay is part
of this release. A read-only check confirmed the existing Supabase signup setting
remains enabled; the previously documented account-policy issue is not changed by
this publication. Production availability must be checked on the deployed URL.

MCWedding is the application repository and Vercel deployment target. Supabase remains
the existing MCWedding project. English, Japanese and Simplified Chinese captions share
one central audio source. There is no TTS or guest microphone.

The earlier `?preview=1` interface remains a synthetic same-browser demonstration.
The new `?live=1` path is separately feature-gated. Local implementation and mock tests
do not establish Vercel WebSocket compatibility, live translation accuracy or wedding readiness.
The standalone `../wedding-live-captions` folder retains private recordings and prior
Phase 0 evidence; the deployed application must not import runtime code from that folder.

As of 3 October, the branch preview has a recorded short real microphone run and
user-reported phone QR success (see `CODEX_HANDOVER.md`). Production remains outside
this activation. The six-minute Vercel handoff, venue/network rehearsal, sustained load
and human-reviewed translation quality are still release gates. Guests now use signed
account-free guest links, as described below; older anonymous-auth test evidence is historical.

### Read-only long-run observation

After a six-minute preview rehearsal, use the run UUID from the operator session:

```powershell
node scripts/captions-observe.cjs "https://YOUR-BRANCH-PREVIEW.vercel.app" "RUN-UUID"
```

This tool reads only that run's metadata. It explicitly loads this repository's
`.env.local`, checks its Supabase URL against the preview's public configuration, and
issues GET requests only. It neither starts capture nor calls OpenAI. Reports are saved
under ignored `private/observations/`; no speech text, invite tokens, outbox payloads or
keys are selected. Keep these files private because run identifiers and timing remain.

Take one observation after End and another if delivery was pending. Look for multiple
used uplink times spanning the 240-second handoff, persisted finals in each language,
pending outbox rows and gap/error event counts. These are diagnostic evidence, not proof
of gap-free audio or correct translations: compare the guest display with the recording
and operator notices. Reads are not one transaction; capped/missing counts are labelled
incomplete. Coverage counts also include intentionally omitted manual target languages;
the observer does not fetch source text to distinguish those. No six-minute hosted test
has been established by this tool's local tests.

## Deployment structure

- Existing HTML/CSS pages and admin navigation remain in MCWedding.
- `/api/captions.js` handles authenticated short requests and snapshots.
- `/api/captions-stream` is the Node WebSocket audio endpoint. OpenAI credentials stay
  on the server; the browser uses an expiring single-use uplink ticket.
- Supabase `caption_*` objects hold event membership, runs, source revisions, final
  translations and the outbox. Private topics are scoped to event and language.
- Drafts can broadcast before saving. Final captions and outbox entries save atomically
  before delivery. Current draft checkpoints are bounded, not token-by-token history.
- Script matching runs alongside normal translation. Suggestions require operator
  approval. Accepting a source correction does not mean its AI translations were human-reviewed.
- Manual captions and pause/end status can persist and broadcast through HTTP when the
  audio WebSocket is unavailable. Responses distinguish delivery from queued retries.

`npm run build` bundles the pinned browser SDK locally and copies an explicit list of
public assets into `dist/`. Server code, SQL, tests, `.env`, documentation and recordings
are excluded. The previous `outputDirectory: "."` must not be restored for this feature.
Build artifacts and the generated `vendor/` bundle are ignored by Git.

## Access

`CAPTIONS_ENABLED=true` switches captions on for a deployment. Keep it false during
the current integration and migration rollout. The separate wedding-party hub uses
its shared entrance password plus a caption-operator password; the standalone admin
route retains its existing magic-link authentication. New preparation and playback
actions must work through both existing authorization paths without weakening them.

### Saved speech library and prepared manual subtitles

Prepare or reopen an event before starting audio. Save each speech with its own title
and programme sequence, edit the existing entry for corrections, and select the current
speech references explicitly. A newly saved script is not selected automatically;
choose No script for unscripted portions. Selection updates guide later recognized
segments and do not rewrite prior captions or force a speaker to follow the script.

Prepare translations explicitly, then review English, Japanese and Simplified Chinese
for every block before marking it reviewed. Saving a speech does not call the translation
provider. Preparation does; the current tests use synthetic providers. Editing the
source speech invalidates its earlier prepared version. No real speeches or reviewed
translations have yet been supplied.

For the manual backup, end the automatic audio run first, select a prepared speech,
and use Show for a specific block, Next to advance, or Clear to blank the guest display.
These actions publish stored reviewed translations without a translation-provider call.
Clear also persists for guests who reload. This backup still needs a working caption
service and guest internet; it cannot translate unscripted ad-libs. Match the displayed
block to the words actually spoken, and clear it when the speaker goes off-script.

The integrated feature requires the corrected migrations, in order:

1. `supabase/migrations/2026-10-14_saved_speech_scripts.sql`
2. `supabase/migrations/2026-10-14_prepared_speech_cues.sql`

Apply only after combined validation and review, to the wedding database. The old
checkout's 13 October versions are superseded and must not be applied. Keep captions
disabled and script editing paused between SQL application and matching application
deployment. Preserve the current PT409 conflicts, consistent service-role publisher
identity, and manual-mode rejection of audio tickets. Use the CLI release path with
the private VIP attachments; automatic Git deployment is disabled.

### Guests: scan a QR code, no account (decided 2 October)

Guests scan a QR code from the operator page and read. There is no sign-in and no Supabase
account of any kind, so anonymous sign-in stays off for the wedding project. That matters
because the existing schema grants several personal-data views (RSVP list, outreach list
with phone numbers, attendance) and some guest-list functions to `authenticated`, and
anonymous users count as `authenticated`. Supabase also limits anonymous sign-ins per IP
address, and a hotel's guests share one.

How it works: the QR link carries a private code (the invite token) in its `#` fragment.
The guest page sends it with each snapshot request (`guestSnapshot`). The server checks it
with `caption_guest_access` (right event, link active, not expired) and returns the captions
so far, the event's guest broadcast channel name and the server's public signing key.
Live captions then arrive on that public Realtime channel. Every message on it is signed
(ECDSA P-256), and the page drops anything that does not verify, so another phone cannot
inject text. The channel name is derived from the signing key and is only handed out after
the code checks.

What the link does and does not protect:

- Anyone holding the link can read that event's captions. Share it only in the room and
  set the expiry to the end of the day. There is no per-phone limit.
- When a link expires, or its `caption_invites` row is set to `active = false` (there is
  no button for this yet), the server refuses it and open guest pages close at the expiry
  time. Someone who deliberately extracted the channel name from the page could keep
  listening, though. What really stops listening is switching guest links off
  (`CAPTIONS_GUEST_LINKS=false`, which also stops all guest broadcasts) or rotating
  `CAPTIONS_GUEST_SIGNING_KEY`, which changes every channel name.
- Signed messages carry the channel they were sent to and when they were signed. A phone
  drops a message from another channel, or one more than two minutes old, so genuine
  messages replayed later cannot mislead it. Message-triggered catch-ups are limited to one
  every five seconds per phone.
- Guests never hold a Supabase session, so nothing outside the caption snapshot is
  reachable through the link. Captions are read aloud in the room anyway; the link protects
  them from casual sharing, not from a determined guest.

Configuration: `CAPTIONS_GUEST_LINKS=true` and `CAPTIONS_GUEST_SIGNING_KEY` (base64 of a
PKCS#8 DER P-256 private key). Apply `supabase/migrations/2026-10-02_live_captions_guest_links.sql`
before switching guest links on. Supabase Realtime must allow public channels (its default).
Snapshot requests are limited to 60 a minute per phone. Failed requests (an invalid or
expired code, a made-up run) also count against the internet address, at 600 a minute.
A phone holding a code that recently checked out is exempt from that address limit, so one
person flooding the hotel's shared connection cannot lock the other guests out. Link checks
and snapshots are cached for a few seconds, so database load does not grow with the number
of phones. Limits and caches are per Vercel instance.

The earlier design (anonymous sign-in plus invite redemption, gated by
`CAPTIONS_GUEST_AUTH_AUDITED`) is gone from the code. Its SQL functions remain in the first
migration, unused. `supabase/audit_captions_auth.sql` is still worth running before anyone
ever enables anonymous sign-in for another reason.

Use exact approved preview origins in `CAPTIONS_ALLOWED_ORIGINS`. Do not use a wildcard
for all `*.vercel.app` deployments. Use separate preview event IDs and invitations.
Secrets belong in server environment settings, not browser variables or deployment logs.

## Vercel compatibility check

Checked official documentation on 2026-10-02:

- [June 22 WebSocket public-beta announcement](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)
  documents exporting an HTTP server with the `ws` library from a Function.
- [Current WebSocket knowledge base](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
  says a connection is pinned to its Function, but reconnects have no instance affinity.
- [Function durations](https://vercel.com/docs/functions/configuring-functions/duration)
  lists a 300-second maximum for Hobby with Fluid Compute; account/runtime settings still require verification.

Some older indexed Vercel pages say WebSockets are unsupported. The newer official
documentation motivates this implementation, but an actual preview-deployment probe
is mandatory. Do not call the Vercel transport verified until it has passed there.

A read-only CLI inspection on 2026-10-02 found the existing project `mc-wedding`, root
directory `.`, Node `24.x`, and production URL `https://mc-wedding-ten.vercel.app`.
The dashboard reports a Next.js framework preset while this repository explicitly sets
`framework: null`; verify the resolved preview build settings. This inspection did not
read environment values, change settings, deploy code or verify WebSocket behavior.

Target 300-second Function lifetime and begin controlled rotation around 240 seconds.
Use a shortened rotation interval in testing. Persist order, pending work and fencing
state in Supabase so a fresh Function can recover. Bounded audio buffering is not a
promise of lossless recovery; any uncertain audio interval must be reported.

## Accuracy and latency evaluation

Reuse the existing middle two-minute recording as the first diagnostic, not as proof
of general accuracy. Compare fixed four-second commits with pause-based boundaries,
then compare confirmed terminology hints. Change one variable at a time. The uncorrected
YouTube transcript is not ground truth and must not serve as the recognizer's answer key.

`node scripts/caption-audio-check.cjs <private-24k-mono-pcm16.wav>` compares fixed
four-second and pause-based boundaries without contacting an API. It accounts for all
samples, including an unfinished tail; it does not measure recognition or translation
quality. Normal End drains pending speech before ending the run. Emergency stop cuts
upload immediately and records uncertainty about unfinished audio.

Add two or three consented recordings from different speakers when available. Include
ad-libs, names, negations, numbers, silence and occasional English. Hold one recording
back from tuning. Reviewers must understand Cantonese and the target language.

`node scripts/evaluate.mjs private/review.json` reports aggregate human-reviewed quality
and latency. Each input phrase requires explicit `correct`, `incorrect`, `missing` or
`unreviewed` verdicts in all three languages. Missing/slow phrases remain in the denominator.
The evaluator requires a shared or calibrated time reference with an error bound; unrelated
phone and server wall clocks cannot establish precise end-to-end latency.

A real set of at least 100 reviewed phrases is needed for the preliminary language gate:
at least 90% meaning-correct, no critical reversals, first-correct P50 <=4 seconds,
P95 <=6 seconds and final P95 <=9 seconds. These are targets, not measured results.
See the evaluator's tests for a synthetic schema example; never label those results live.

## Operator runbook

1. Confirm the approved event, admin access, quota/spending scope and current glossary/script.
2. Select the intended input explicitly and test levels. A microphone/audio interface uses
   the device list. For audio already playing on the operator PC, select **PC audio**, press
   **Share PC audio**, then use the browser picker as described below. Never silently switch
   to a built-in microphone or another source when the selected input disconnects.
3. Start one publisher. Check source recognition and all three target-language panels.
4. Share only the caption invitation with test guests. Open one phone in each language.
5. Review script suggestions against what was spoken. Reject a suggestion that replaces
   an ad-lib with the planned script. Manual target-language edits mark only supplied languages.
6. Pause for private conversation or breaks. Emergency stop cuts subsequent upload;
   already transmitted audio cannot be retracted.
7. On reconnect, preserve displayed text and recover finals through snapshots. Show
   missing intervals and language-specific errors; do not summarize away a backlog.
8. End capture and provider sessions. Keep evidence private. No automated retention
   deletion runs until its scope and timing are separately confirmed.

### Capturing what the operator PC is playing

PC audio uses the browser's screen-share permission because browsers do not expose a general
loopback input to a web page. It is a separate, explicit step before Start, Resume or a manual
Reconnect. Cancelling the picker, denying permission, or choosing a share with no live audio
track does not create a caption run and never falls back to the microphone.

- For YouTube or WhatsApp Web, choose the browser tab that is playing the audio and enable
  **Share tab audio** in the picker.
- For the desktop WhatsApp app, choose **Entire screen** and enable system audio if the browser
  and operating system offer it. Availability and picker wording vary by browser and OS.
- Entire-screen/system audio may include notification sounds and other PC audio. Silence or
  mute notifications that must not enter the captions.
- Some browsers require a video track even when sharing audio. The page keeps that track only
  to keep the browser share alive; it never renders, transmits or records video. Release PC
  audio, Pause, End, Emergency stop, leaving the page, any setup failure, and browser
  stop-sharing all stop every audio and video track held by the page.

A scheduled server handoff keeps the existing PC share alive. An unexpected stream disconnect
cannot reopen the picker automatically because `getDisplayMedia` requires a fresh user gesture.
The page therefore stops the share and leaves the run open: press **Share PC audio**, then
**Reconnect captions**. Pause also releases the share; share it again before Resume.

This implementation does not establish that every target browser/OS can capture desktop-app
audio. A real YouTube/WhatsApp rehearsal, notification isolation, sustained capture and venue
acceptance remain required. The browser picker itself cannot be automated by the local tests.

Validation on 13 October 2026: 60 audio/lifecycle tests passed in the staged change
using `node --test --test-isolation=none tests/captions-audio.test.cjs
tests/captions-admin-lifecycle.test.cjs`. Chrome 154.0.8037.93 passed the local
fake-provider browser suite, including PC share/release/cancel, Start/Resume gates,
stop-sharing recovery and layouts at 344/390/744/1280 px. The 390px screenshot was
visually inspected. `node tests/captions-pc-audio-browser.cjs` separately exercised
the real AudioContext/worklet with a synthetic shared tone and video track: click
activation, no PCM before Start, 24 kHz PCM frames, no microphone fallback and
all-track cleanup passed. This is not a native sharing-dialog or real media-site
acceptance test. No paid API calls or deployment were performed by these checks.
The two startup-cancellation regressions also failed with the pre-fix branch
restored in memory. A separate reviewer completed read-only static review and
found no remaining P1/P2 blocker after that fix. Review used the shared filesystem;
the reviewer did not independently execute successful tests, and this is not
live-audio acceptance.

### When capture stops without the operator asking (added 2026-10-02)

- Start does nothing until a microphone is selected or a PC share with a live audio track has
  been prepared; no event or run is created first.
- A dropped stream, an upload more than three seconds behind, or lost speech recognition
  triggers one reconnect with a three-second budget. A scheduled handoff that fails falls
  back to that same reconnect. The new stream starts above sequence 0, which is how the
  page tells the server how much audio was lost; the server records it as a gap.
- A stream that was reconnected but closed, paused or ended before it sent any audio
  sends one silent frame first, so the declaration still reaches the server.
- After three automatic reconnects inside a minute the page stops retrying and leaves the
  choice to the operator. Reconnect captions is never limited.
- If that reconnect fails, the selected input disconnects, the page is left, or a Pause, End
  or Emergency stop is not confirmed by the server, the run is **still open on the
  server**. The page then shows **Reconnect captions** and **Emergency stop**. Reconnect
  continues the same run, so guests keep their session; Emergency stop closes it.
  Emergency stop can be pressed again if it fails, and twice in a row without harm.
- Reconnect captions works out what the server actually holds. A run that turns out to be
  paused (a Pause whose reply was lost) is resumed; a run that has already closed returns
  the page to a clean Start.
- The page treats a run as closed only when the API says so with `RUN_NOT_OPEN` (409) or
  `NOT_FOUND` (404). A bare 400 is not that signal: rate limits and other upstream
  refusals also arrive as 400.
- Start on an event that already has an open run does not fail and does not take the run
  over. The API returns that run with `alreadyOpen`, and the page offers Reconnect captions
  (take it over) or Emergency stop (close it). This covers a Start whose reply was lost.
  It is not a way for two operators to share an event: each operator page creates its own
  event, so a second admin pressing Start begins a separate event with its own guest links.
- End waits for a handoff that is in flight, so the buffered last words are uploaded
  before the drain. End on a paused run ends it directly; there is no stream to drain.
- Pause stops local audio capture immediately, then asks the stream to finish words
  already captured before changing the database state to paused. The wait is bounded;
  an unconfirmed pause leaves capture off and offers recovery. Emergency stop cancels
  this wait immediately. This behaviour was selected by the user on 3 October and is
  published to the branch preview on 3 October, awaiting real-audio verification.
- End checks persisted recognized source finals for missing target finals even when already paused.
  Blank-source manual captions with intentionally omitted languages are excluded.
  If that check fails, the operator sees that the result could not be checked.
- End reports separately when final captions were not delivered, when they could not be
  saved or translated, and when audio was lost just before it (a failed or overflowing
  handoff, or a reconnect, within the last ten seconds). "Ended after the final words
  completed" is shown only when none of those happened.
- Script suggestions queue. Approve and Keep raw text always apply to the suggestion on
  screen, never to one that arrived while it was being read.
- **Do not reload the operator page during the event.** The event and run ids live only
  in the page; a reload creates a new event, and guest links issued earlier still point at
  the old one. This is an open design item, not a handled case.

## Release sequence and remaining evidence

Prepare and review the additive migration, test it on local PostgreSQL, then seek approval
for the exact shared-project changes. Apply the approved database change before exposing
dependent frontend controls. Deploy a feature-disabled Vercel preview first; perform
the transport probe, permissions checks and an explicitly capped real API test there.

First integrated acceptance: one desktop source and three actual phones, with measured
latency, reconnect recovery, script review and pause/stop verified. Afterwards require
50-reader capacity testing, a three-hour soak and the Peninsula's real audio/network rehearsal.
The paid Supabase plan alone does not verify same-IP Auth quotas or Realtime capacity.

Rollback: disable caption feature flags and stop capture/provider sessions. Roll back the
application deployment if needed; retain caption tables/evidence for inspection. Do not
drop tables or delete existing wedding data as part of an automatic rollback.

Deployment, database audit, account quotas, current billing, real audio quality, three-phone
delivery, 50-reader capacity and venue performance remain UNVERIFIED until separately recorded.
