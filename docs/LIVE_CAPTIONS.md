# Live captions implementation and release gates

## Scope and current status

MCWedding is the application repository and Vercel deployment target. Supabase remains
the existing MCWedding project. English, Japanese and Simplified Chinese captions share
one central audio source. There is no TTS or guest microphone.

The earlier `?preview=1` interface remains a synthetic same-browser demonstration.
The new `?live=1` path is separately feature-gated. Local implementation and mock tests
do not establish Vercel WebSocket compatibility, live translation accuracy or wedding readiness.
The standalone `../wedding-live-captions` folder retains private recordings and prior
Phase 0 evidence; the deployed application must not import runtime code from that folder.

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

## Account and authorization gates

Keep `CAPTIONS_ENABLED=false` until the local checks and release review are complete.
Keep `CAPTIONS_GUEST_AUTH_AUDITED=false` until the existing project's access controls
have been verified against a real anonymous test user.

The local legacy schema grants `authenticated` access to several personal-data views,
including invitation and RSVP views. Their deployed definitions are unknown. Anonymous
Supabase users also assume `authenticated`; adding a caption-only membership table does
not by itself protect those existing objects. Run `supabase/audit_captions_auth.sql`
read-only, review view execution permissions and SECURITY DEFINER RPCs, and test actual
denials before enabling anonymous sign-in. This implementation does not silently change
existing guest/RSVP permissions or project-wide Auth settings.

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
2. Select the intended USB/hotel audio input explicitly and test levels. Never silently
   switch to a built-in microphone when the selected device disconnects.
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

### When capture stops without the operator asking (added 2026-10-02)

- Start does nothing until a microphone is selected; no event or run is created first.
- A dropped stream, an upload more than three seconds behind, or lost speech recognition
  triggers one reconnect with a three-second budget. A scheduled handoff that fails falls
  back to that same reconnect. The new stream starts above sequence 0, which is how the
  page tells the server how much audio was lost; the server records it as a gap.
- A stream that was reconnected but closed, paused or ended before it sent any audio
  sends one silent frame first, so the declaration still reaches the server.
- After three automatic reconnects inside a minute the page stops retrying and leaves the
  choice to the operator. Reconnect captions is never limited.
- If that reconnect fails, the microphone disconnects, the page is left, or a Pause, End
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
