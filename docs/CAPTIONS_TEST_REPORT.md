# Caption implementation validation — 2026-10-02

## Current status — 3 October 2026

The opening implementation session below is historical. The branch preview subsequently
ran real OpenAI/Supabase captions with a Mac microphone and a phone QR guest, as recorded
in `CODEX_HANDOVER.md`; this is not production activation or wedding acceptance.

Codex resumed on `codex/live-captions-ui` at `4a8c366`. Before new changes, the complete
caption test command below passed **174/174**, no failures/skips (55.3 seconds).
Read-only requests returned HTTP 200 for preview configuration and caption configuration;
captions were enabled, and the `.env.local` Supabase URL matched that preview. The matching
project's Auth settings still reported signups enabled and anonymous Auth disabled.
Changing signup policy and checking the user list remain pending user actions.

The new read-only observation tool has seven local tests for run scope, credential/content
exclusion, project mismatch, local configuration, corrected source revisions, malformed
responses and bounded pagination (including exact 500/1,000-row boundaries). These passed.
The observer also completed a read-only query of the most recently ended hosted test
run: six persisted source finals, six finals per language, zero source finals missing
a current final translation, 21 sent outbox entries and one used uplink ticket. No tables
were reported incomplete. This confirms access to the installed schema, not long-run
handoff (only one connection) or linguistic correctness; no speech text was fetched.
No new paid request, hosted six-minute run, deployment, migration or remote data mutation
was performed as part of these checks. Long-run handoff, venue conditions, load and human
translation quality remain unverified.

### Pause and End changes (published to branch preview on 3 October)

User-approved behaviour: Pause stops capture immediately and drains already-captured
speech before the paused transition. Emergency stop cancels the wait. Failed Pause keeps
the run recoverable without restarting the microphone. End also checks recognized source
finals for missing translations; blank manual sources are excluded. Failed, malformed or
500-row-capped checks cannot produce a clean completion claim. Drain replies from a
replaced socket cannot complete the current wait.

The final complete caption regression suite passed **192/192**, no failures or skips
(55.4 seconds), using `node --test --test-isolation=none tests/captions-*.test.cjs tests/captions-*.test.mjs`.
`npm run build` passed. The mocked Chrome suite (`node tests/captions-live-browser.cjs`)
passed on Chrome 153.0.8010.48, including the new pause-drain assertion and existing
operator, QR guest, reconnect, rotation and layout checks. Its protocol fixture was
updated to acknowledge the requested drain reason. Chrome required a sandbox exception;
all browser service/audio providers remained mocked. `git diff --check` passed.

A separate read-only reviewer reproduced and rechecked observer privacy/pagination
issues and End unknown/truncated-result cases. It also exercised the actual admin script
in a VM for failed Pause, Pause during rotation and Emergency stop during the wait.
No reproduced blocker remained in that scope. Review reused an existing agent context
and shared working files, with author fix messages; it was not a fresh isolated review
or a wedding-release sign-off. Real microphones/provider timing were not used for these
new behaviours.

Publication verification: application commit `d85654b` is on the remote preview branch.
Vercel deployment `dpl_3EKSGmGD1dtsNN9bKzLWvYkjKe9Z` reached READY and acquired the existing
branch alias. Admin page/script and caption configuration returned HTTP 200; the deployed
script matched the committed source after line-ending normalization, and captions/guest
links reported enabled. Production homepage returned 200 and its caption API returned
404. These are deployment smoke checks, not authenticated microphone or handoff tests.

## Initial implementation session status (2 October; historical)

Local implementation in MCWedding; live service NOT activated. This is not a wedding
release candidate. Phase 0 real recognition/translation quality remains unverified for
this implementation. Local Phase 1/2 components exist but their live acceptance has
not passed. No production database migration, Vercel deployment, commit, push or paid
API request was performed in this implementation session.

## Environment and checks actually executed

Windows x64, Node 24.15.0, Chrome 153.0.8010.48. PGlite 0.5.8 executes PostgreSQL
locally; Auth/Realtime schemas and identities are test fixtures, not a hosted Supabase
installation. SDK 2.117.2, ws 8.22.0 and esbuild 0.28.2 are pinned in the lockfile.
The browser harness uses installed Chrome and the workspace Puppeteer module. On a
different machine, set `CHROME_BIN` and `PUPPETEER_MODULE` to local installations;
these browser tools are not downloaded by `npm ci`.

| Check | Actual result | Evidence boundary |
|---|---|---|
| `node --test --test-isolation=none tests/captions-*.test.cjs tests/captions-*.test.mjs` | 174 passed, 0 failed, 0 skipped, after the lifecycle repairs, the afternoon fixes and the account-free guest links (see the guest section below) | Local providers mocked; real PostgreSQL migration/RPC and role tests |
| `node tests/captions-ui-check.cjs` | PASS at 344 / 390 / 744 / 1280 px (Claude rerun) | Retained sample UI, no service calls |
| `node tests/captions-live-browser.cjs` | PASS on the handover artifacts once the line-174 assertion was repaired, and PASS again after the lifecycle repairs; every scenario through the guest new-run follow is reached. Now also covers the full live operator page at 344 px in the detached state (no overflow, no control under 44 px) and reattaching to the open run | All providers, sockets and the microphone are local fakes |
| `npm run build`, then `tests/captions-build.test.cjs` | PASS; 2 passed, 0 failed | Explicit static assets; server/SQL/private files excluded |
| `git diff --check` and API/admin JS syntax checks | PASS | Git emitted only LF/CRLF conversion notices; `git diff --check` sees tracked files only, so the untracked caption files were scanned separately with `--no-index` — clean |

Browser coverage includes language/font controls, plain-text rendering, scrolling and
BFCache restoration, disabled defaults, admin entry, magic-link flow, microphone
lifecycle, pause/resume/end/stop, script approval, shared manual segment, invite expiry
and payload shape, token refresh, subscription-before-snapshot buffering and locale
channel switching. It does not prove a physical microphone, iPhone Safari, actual token
expiry or phone-to-phone delivery.

Browser failure at handover, repaired by Claude on 2026-10-02: the Stop-during-delayed-
rotation-ticket scenario waited for `#status-text.dataset.status === 'ended'`, an
attribute nothing writes (`live-captions-admin.js` sets `#status-dot.dataset.state` and
the status text). The failure was reproduced first, and it was the assertion, not the
product: Stop cancels the handoff, and the late ticket is discarded by the generation
check that follows it. The original check also only counted sockets, and could have
passed before the released ticket reached the page. It now waits for the stop request,
the `ended` state and the "stopped" text, lets the late ticket land, and then asserts no
new socket, capture not running, no audio sent for a frame pushed after Stop, and — after
a restart — that the new stream begins at sequence 0 / offset 0 with nothing replayed
from the stopped handoff's buffer. A copy of the page with the post-ticket cancellation
check removed fails the new assertion (5 sockets against 4), so the check is not vacuous.
No product file was changed for this repair.

The local contract integration test uses the real browser request wrapper, API handler,
store, named SQL RPC arguments and full migration, captures private Broadcast payloads,
and merges them with the real client reducer. It tests event/start/invite/redemption,
script/glossary shapes, same-segment three-language manual captions, pause without a
gateway and guest denial of admin actions. External transport is still simulated.

PostgreSQL tests cover idempotent install, atomic final/outbox persistence, read/write
denials for guest identities, event isolation, private source/script protection,
single-use tickets and takeover fences, manual correction locks, shared segment
allocation, actual source revisions and generation-safe status delivery. These checks
do not audit the existing project's invitation/RSVP views or deployed policies.

Gateway regressions cover close-during-auth/provider-open, committed or reserved audio
without a final, bounded heartbeat failure, failed final broadcast at End, stale work,
out-of-order ASR, exact PCM frames, bounded queues and review-only script suggestions.

## Offline audio evidence

The existing private random middle excerpt was checked without uploading or changing
it: mono PCM16 at 24 kHz, 120 seconds, 2,880,000 samples. PCM SHA-256:
`efb0475c3dc18f3cb75f5367a6a833ddeb5c1d744700b7f809c5aa3e66c1272a`.

| Boundary strategy | Commits | Committed samples | Pending tail samples | Longest turn |
|---|---:|---:|---:|---:|
| Fixed 4 seconds | 30 | 2,880,000 | 0 | 4 s |
| Pause 450 ms / max 6 s | 30 | 2,797,200 | 82,800 (3.45 s) | 6 s |
| Pause 600 ms / max 6 s | 23 | 2,800,800 | 79,200 (3.30 s) | 6 s |

Each strategy accounts for every sample; none discarded a silence interval in this
excerpt. Pending speech is explicitly reported, not scored as transcribed. This is
segmentation evidence only: no recognition score, language accuracy, end-to-end
latency or API cost was measured here. The original transcript remains unverified.

## Lifecycle review and repairs — 2026-10-02 (Claude, after the handover)

The four areas left unreviewed at handover (Start/Resume cancellation, rotation
replay/overflow, source-drain timing, Stop during pending store calls) were given to a
fresh reviewer that drove the real page script and the real gateway with local fakes.
The cancellation tokens held: Stop at every await of Start, Resume and a handoff left no
open socket, no capture and no upload. The paths around them did not. Reproduced, then
repaired, each with a regression test that fails on the pre-change code:

| Defect reproduced on the handover code | Repair |
|---|---|
| Any failure after a run existed left it open with only Start enabled, and Start was then refused | "Detached" page state: Reconnect captions reattaches to the same run, Emergency stop closes it; Start creates nothing until a microphone is chosen |
| A Start whose reply was lost left an open run the page did not know | `start` now returns the open run with `alreadyOpen`; the page offers to take it over or close it, and does neither unasked |
| Emergency stop could target a stale run after a double click | Run bookkeeping is cleared by whichever reply arrives; a second Stop is harmless |
| Unplanned reconnect recorded no gap | The new stream starts at `sequence = frames lost`; a stream closed before sending audio sends one silent frame carrying that number |
| Lost speech recognition discarded audio until the next handoff while the page said connected | The gateway closes the stream (1011), the page reconnects; more than three reconnects a minute stops retrying |
| End during a handoff dropped the buffered words and reported a clean finish | End waits for the handoff; words lost to a failed or overflowing handoff are reported as a final-audio gap |
| End reported clean when finals were not saved or not translated | `drained` carries `failures: { captions, sources }`; counted even when the failure handling itself fails |
| A recognised final whose checkpoint failed left no record | Retried at close; otherwise recorded as `source_checkpoint_lost` |
| Handoff sent `rotate` before the last turn was checkpointed; End could commit the tail twice | Tail commit ordered and shared between the two paths |
| HTTP 400 was read as "run closed", but rate limits also arrive as 400 | `RUN_NOT_OPEN` (409) is the only closed signal besides `NOT_FOUND` |
| Hard shutdown and authentication failures left the socket open | Both close it; the run is re-checked immediately before `ready` |
| A newer script suggestion replaced the one being read under the Approve button | Suggestions queue (20), Approve acts on the one shown |

A second fresh reviewer then attacked the repairs. It confirmed most, and found a
regression introduced by them (the lost Start reply above) plus the End and 400 cases;
those rows reflect the second round. Its mutation runs — one fix undone per run — are
the reason several tests were rewritten: a test that still passes with its fix removed
proves nothing.

The same reviewer then re-ran its attacks on the second round and confirmed every
earlier finding fixed. It drove the real gateway over a real local WebSocket to check the
silent declaration frame: the gap was recorded 35 times out of 35, whether the frame was
followed by a close or a drain, with no speech turn created. It found four smaller cases
(a late stop reply repainting the page during a newer Start; a late Start reply stopping
a run since reattached; a deliberate pause counted as lost audio after a lost Resume
reply; End's gap message depending on timing). Those were repaired with tests, and
**that last set of four has been tested but not independently re-reviewed.** With one fix
undone per run in a scratch copy of the page, 23 of 23 mutations fail at least one test.

The migration changed twice during this work: an explicit
`GRANT SELECT ON public.caption_events TO service_role`, needed by the open-run lookup, and
`SET search_path = public, extensions` on the four functions that hash tokens, because
Supabase installs `pgcrypto` in the `extensions` schema. A PGlite fixture that installs
`pgcrypto` there reproduced `gen_random_bytes(integer) does not exist` before the second
fix. The migration was then applied to the wedding project on 2 October and verified there
(14 tables, 35 functions, 2 Realtime policies, the grant).

## Live run on real services — 2 October (local server, not Vercel)

The real operator page, API and gateway ran on this PC against the wedding Supabase project
and the real OpenAI models (`gpt-live-transcribe`, `gpt-4.1-mini`). A 2-minute stretch of
the downloaded public Cantonese podcast was played into Chrome as its microphone.

- Ten lines were recognised in about 55 seconds, each translated into English, Japanese and
  Simplified Chinese, with no errors. The first line appeared 4.5 s after the stream was
  ready; translations arrived a median 1.3 s (90th percentile 2.0 s, maximum 3.0 s) after
  each Cantonese line was final. In continuous speech, lines are cut at 6 s.
- Mixed Cantonese and English came through well ("But, but yeah, Sai Yuen, I think it's
  okay to be honest"). Names were the weak spot: one restaurant name was recognised four
  ways. One line came out in simplified characters. The same audio was recognised
  differently on two runs (飯堂 versus 返同), which changed the English meaning.
- Pause closes the stream at once, so a line still being translated is dropped, and End
  from paused does not report it. Open.
- The local test server process died once, about 70 s into a run, without an error; cause
  unknown. The page reported the disconnect correctly. Not a product finding until it
  recurs on Vercel.

This is anecdotal: a dozen lines, one speaker type, no human review. It is not the
100-phrase language gate.

## Vercel preview run — 2 October

Branch `codex/live-captions-ui` deployed as a Vercel preview (production untouched; caption
variables scoped to this branch's previews; functions in `iad1`). The user ran it from a Mac
with its built-in microphone, speaking Cantonese and English, for about 55 seconds.

- The WebSocket audio stream worked on Vercel: one connection, authorised, recognised and
  ended through End with no gap or error events.
- 5 spoken lines recognised and translated into all three languages (15 final captions).
  Another 11 detected segments held no words and were correctly not saved.
- Recognition finished a median 0.49 s after each line closed (max 0.89 s); each final
  translation call took a median 0.76 s (max 1.60 s).
- **Not yet shown on Vercel:** the 240-second scheduled handoff, which is what the 300-second
  function limit makes necessary. That needs a run of 5 minutes or more.

The user described the result as good. Still anecdotal: one speaker, under a minute.

## Guests by QR code, with no account — 2 October

The guest path was rebuilt so a guest scans a QR code and reads, with no Supabase account
(see `LIVE_CAPTIONS.md`, "Guests: scan a QR code"). The user tested it on a phone against the
public preview and found it good.

An independent reviewer attacked the design with the real guest page, client and API in a
harness. The core held throughout: no session, nothing beyond the caption snapshot
reachable, and no forged text accepted. Two review rounds then found, and the fixes resolved:

| Found | Repair |
|---|---|
| The first request every phone makes was limited to 90 a minute per IP; a room on one hotel connection would lose about 60 phones | 20000 a minute; the page retries busy answers with jittered backoff |
| Genuine signed messages replayed later could trigger reload storms or a false "paused" | Signatures cover channel and signing time; phones drop misaddressed messages and anything older than two minutes; catch-ups coalesced to one per 5 s |
| One client could fill the shared per-IP allowance and lock out the room | Only failed requests count against an IP (600 a minute); phones with a recently valid code are exempt; link checks and snapshots cached briefly |
| An expired link stopped only new phones | Open pages close at expiry or refusal; `CAPTIONS_GUEST_LINKS=false` stops all guest broadcasts; key rotation documented as full revocation |
| A manual caption made later heartbeats look stale, so phones showed "connection paused" on a live stream | Heartbeats are no longer compared by sequence number, only by generation and signing time |
| A failed language switch or key change left a phone silently dead | It keeps polling and retries the channel with backoff |
| 25 s after End or Pause, phones claimed the connection was lost | The outage timer runs only while the stream is live |
| A caption arriving during a failed catch-up waited up to a minute | Held captions are applied when the catch-up fails |

`tests/captions-guest-page.test.cjs` runs the real guest page against the real API handler
and signer. Five of its nine tests fail on the guest page as it was before these fixes.
Residual, accepted: someone who deliberately extracts the channel name can keep listening
until guest links are switched off or the key is rotated; limits are per Vercel instance.

## Review and limits

Both reviewers were independent of the authors' reasoning but shared the workspace, and
every check above runs against local fakes. Nothing here measures a real microphone, the
real speech or translation provider, a deployed WebSocket, or a phone. No professional or
production-readiness certification is claimed.

Open after this work, none of it verified:

- **Reconnect budget.** One automatic reconnect gets three seconds for a ticket, the
  WebSocket, about eight database calls, a new speech-recognition session and the
  microphone. Whether that fits has never been measured. A miss is now recoverable with
  one click, but it should not need the click.
- **Handoff every 240 seconds.** The same sequence must fit inside the three-second audio
  buffer. During continuous speech a recorded gap every four minutes is plausible.
- **Provider errors.** Every session-level speech-recognition error ends the connection
  and costs a reconnect gap. Which provider errors occur in normal use is unknown.
- **Reloading the operator page** loses the event and run ids; the reloaded page starts a
  new event and earlier guest links point at the old one.
- **Recovery of a partly translated final** retranslates all three languages and, by
  reading the SQL, overwrites the already-final rows without a new revision. Not exercised.
- **Request timeouts.** The page's API requests have none; a hung request leaves the page
  on "connecting" with Emergency stop available.

Still required: deployed existing-data Auth/RLS audit, Vercel WebSocket probe/rotation,
account model availability, explicitly capped real audio test, human Cantonese/target
language evaluation, same-IP anonymous sign-in/token renewal, three physical phones,
50 readers, three-hour soak, and hotel audio/network rehearsal. Paid Supabase status
alone is not evidence for these gates.

## Release package

The proposed database change is exactly
`supabase/migrations/2026-10-02_live_captions.sql`: 14 new `caption_*` tables, their
functions/indexes/RLS/grants, and caption-specific policies on `realtime.messages`.
It does not seed or edit the wedding guest list, RSVP rows or invitation data. Review
the existing access controls with the read-only `supabase/audit_captions_auth.sql`
before enabling anonymous Auth. Existing grants may require a separately scoped fix.

Keep both feature flags false until the corresponding checks pass. Apply an approved
database change before exposing dependent controls. A feature-disabled preview in the
existing Vercel project `mc-wedding` precedes activation. Rollback disables captions
and stops capture; it does not drop tables or delete wedding data.

The initial review targets are accuracy >=90%, no critical meaning reversals and
first-correct P50 <=4 s / P95 <=6 s; these are targets, not results. See
`EVALUATION.md` for annotations and `LIVE_CAPTIONS.md` for operation and release gates.
