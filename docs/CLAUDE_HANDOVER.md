# MCWedding captions — handover

Checkpoint: 2026-10-02, Claude, continuing from Codex's handover of 09:21 UTC the same day.
Status: COMMITTED to branch `codex/live-captions-ui` and pushed for a Vercel PREVIEW only.
Production (`main`) is untouched. The migration is applied to the wedding Supabase project.
Guest access stays off. See "Afternoon update" directly below; the rest of this file is
the morning checkpoint and is correct except where that update says otherwise.

## Afternoon update — 2 October

- **Migration applied** to the wedding project (the one the site's `SUPABASE_URL` uses) by the user in
  the SQL editor, after a read-only pre-check. Verified: 14 tables, 35 functions, 2 Realtime
  policies, service role can read `caption_events`, anon key refused (42501).
- **Migration bug fixed before applying:** Supabase keeps `pgcrypto` in the `extensions`
  schema, and the four token functions only searched `public`, so every audio ticket would
  have failed (`gen_random_bytes(integer) does not exist`). They now search
  `public, extensions`. Test: `tickets and invites work with pgcrypto in the extensions schema`.
- **Microphone permission fixed:** until a site has microphone permission, Chrome lists one
  input with no id, which could not be started. The page now offers "Allow microphone",
  explains a refusal, and lists devices once granted (`Capture.permit()`).
- **Local live test on real services** (local server, real Supabase and OpenAI, recorded
  Cantonese podcast as the microphone): 10 lines in about 55 s, all translated into three
  languages, no errors. Translation arrived a median 1.3 s (max 3.0 s) after each Cantonese
  line was final. Weak spots: names (one restaurant name recognised four ways), one line in
  simplified characters, and the same audio recognised differently on two runs. Pause cuts
  in-flight translations and End from paused does not report them (open, see below).
- **Keys:** `.env.local` (git- and Vercel-ignored) holds the four keys for local runs. This
  PC also has a `SUPABASE_URL` environment variable for a DIFFERENT project; local runners
  must read `.env.local`, not the process environment.
- **Vercel preview:** caption variables are scoped to Preview deployments of this branch
  only. The Supabase redirect list needs the preview address for operator sign-in.
- **Open:** Pause should finish the last words (as End does) and End should report
  untranslated finals. Test rows from the local runs are in the caption tables (no guest
  data); delete only with the user's say-so. Remove `http://127.0.0.1:4790/**` from the
  Supabase redirect list after local testing.

Codex's handover asked for three things: diagnose the failing browser assertion, rerun
the gates, and get the lifecycle and rotation code reviewed independently. All three are
done. The review found real defects, and they were repaired. This file replaces Codex's
text; its sections on hosting and shared data are kept below and marked as Codex's.

## Repository and authorization

- `C:/Users/mitch/Documents/Projects/git/MCWedding`, branch `codex/live-captions-ui`,
  HEAD `e395ca98772a09beb316a61d08416bbfc30196e1`.
- (Morning checkpoint; superseded by the afternoon update above.) At that point every
  caption file was uncommitted and nothing had been pushed, deployed, migrated or sent to a
  paid API.
- Stage only explicit paths if a commit is later authorized; never add all files. The
  roster SQL and the private audio must not be exposed or casually modified.
- The user approved implementation inside the existing MCWedding Git/Vercel/Supabase
  project, accuracy improvements plus phone delivery, and operator-review-first script
  assistance. Script suggestions must NOT auto-replace what was spoken.
- Production activation, shared database changes and a capped real API test remain
  separate release gates. Prepare the exact scope before asking. Do not buy a service,
  change plans, enable anonymous Auth or apply the SQL automatically.

## What was done after Codex's checkpoint

1. **Browser failure at line 174.** It was the assertion: the test polled
   `#status-text.dataset.status`, which nothing writes. Reproduced first, then replaced
   with a check of the real stop behaviour. Detail in `docs/CAPTIONS_TEST_REPORT.md`.
2. **Independent review** of Start/Resume cancellation, rotation replay and overflow,
   source-drain timing and Stop during pending store calls. The cancellation tokens were
   sound. The paths around them were not: operator lock-out after any mid-run failure,
   audio lost with no recorded gap, End reporting a clean finish when it was not, and
   Emergency stop able to target the wrong run.
3. **Repairs**, each with a regression test that fails on the pre-change code. The
   defect-by-defect table is in `docs/CAPTIONS_TEST_REPORT.md`; operator-facing behaviour
   is in `docs/LIVE_CAPTIONS.md` under "When capture stops without the operator asking".
4. **A second independent review** of the repairs, then a confirmation pass by the same
   reviewer. It found one regression the repairs had introduced and several holes; all
   were repaired. The last four small fixes were tested but not re-reviewed.

Files changed since Codex's checkpoint: `live-captions-admin.js`,
`live-captions-client.js`, `api/captions.js`, `lib/captions/gateway.cjs`,
`lib/captions/store.cjs` (one method added), the migration (one `GRANT` line),
`tests/captions-admin-lifecycle.test.cjs` (new), `tests/captions-gateway.test.cjs`,
`tests/captions-api.test.cjs`, `tests/captions-store.test.cjs`,
`tests/captions-store-postgres.test.cjs`, `tests/captions-live-browser.cjs`,
`tests/captions-live-ui.test.cjs`, and the docs. `live-captions-guest.js` is unchanged.

## Contracts that changed — read before touching either side

- **Operator page states:** `ready`, `detached`, `connecting`, `live`, `paused`.
  `detached` means the run is open on the server and nothing is capturing; Start is
  labelled "Reconnect captions" and reattaches to the same run without calling `start`.
- **"Run closed" signal:** only `error.code === 'RUN_NOT_OPEN'` (HTTP 409) or
  `'NOT_FOUND'` (404). Never a bare 400. `live-captions-client.js` attaches `status` and
  `code` to request errors.
- **`start` on an event with an open run:** HTTP 200
  `{ eventId, runId, alreadyOpen: true }`. The page adopts it as `detached` and neither
  attaches nor stops it unasked.
- **Declaring lost audio:** a stream that is not the first of its attachment starts at
  `sequence = frames lost` and `sampleOffset = sequence * 1200`; the gateway records
  `initial_offset`. If that stream is closed or drained before sending audio, the page
  sends one silent frame first.
- **`drained`:** now carries `failures: { captions, sources }` beside `delivery`.
- **Gateway closes:** 1011 on a session-level speech-recognition failure (after an
  `asr_unavailable` error) and on any authentication failure; 1001 on the hard shutdown
  timer. The page reconnects on an unexpected close, at most three times a minute.

## Actual validation, and what it does NOT prove

Run on Windows x64, Node 24.15.0, Chrome 153, on the final files:

```text
node --test --test-isolation=none tests/captions-*.test.cjs tests/captions-*.test.mjs   136 pass / 0 fail
node tests/captions-live-browser.cjs                                                    PASS
node tests/captions-ui-check.cjs                                                        PASS at 344/390/744/1280
npm run build ; node --test --test-isolation=none tests/captions-build.test.cjs         PASS ; 2 pass
git diff --check (tracked) and --no-index scan of the untracked caption files           clean
```

Everything runs against local fakes: mocked providers, PGlite for PostgreSQL, fake
sockets and a fake microphone. None of it measures a real microphone, the real speech or
translation provider, a deployed WebSocket, Supabase Realtime, or a phone. The offline
audio segmentation figures in the test report are Codex's and were not rerun.

## Open items found by the reviews and not resolved

- **Reconnect budget (unmeasured).** One automatic reconnect has three seconds for a
  ticket, the WebSocket, about eight database calls, a new speech-recognition session and
  the microphone. A miss now costs one click on Reconnect captions instead of a lock-out,
  but it should be measured on the preview before anyone relies on it.
- **Handoff every 240 seconds.** The same sequence has to fit inside the three-second
  buffer. A recorded gap every four minutes during continuous speech is plausible.
- **Provider errors end the connection.** Deliberate: after a provider error the adapter's
  pending-order bookkeeping cannot be trusted. If the real provider emits harmless errors
  in normal use, each costs a reconnect gap. Watch for this in the capped real API test.
- **Reloading the operator page** loses the event and run ids. The reloaded page starts a
  new event; earlier guest links point at the old one.
- **One operator page per event.** Each page creates its own event. The two admins cannot
  run one event's captions from two pages.
- **Recovery of a partly translated final** retranslates all three languages and, by
  reading the SQL only, overwrites already-final rows without a new revision.
- **No timeout on the page's API requests.** A hung request leaves the page on
  "connecting" with Emergency stop available.
- **Service-role read of `caption_events`.** Now granted explicitly in the migration and
  tested on PGlite, and confirmed on the real project on 2 October after the migration was
  applied (`has_table_privilege` true). If it were ever refused, `start` would fall back to
  409 and the lost-Start-reply lock-out would return.

## Artifact hashes at the morning checkpoint (SHA-256)

Superseded: from the afternoon commit on, git history is the record of these files.

```text
lib/captions/gateway.cjs CCD553755ACEF82E8B8950B5979DF8369830C5BCF08A4988E6935DD4A833E379
lib/captions/store.cjs 2D9524500D72152D727B29AE9ED4F758831CC7ED91CCD5238DC7AAB3F7A7F8A0
supabase/migrations/2026-10-02_live_captions.sql 19330356A381E26048F884B66F06CF2C18908F274B0B9ABC075875D893D32A1E
live-captions-admin.js DF8EFA113F464FAF1B58CC040374EC5F23E7840B40DFD2762B773AFFA96D8C5A
live-captions-guest.js 45C5CAEF9AE41D1FF4891EDD44D10997961387CC27323759A35220625282124A
live-captions-client.js 05FC78FAD1C76469A96D3A4B5E25A7C9C1055AA9458A9D0B3C7937ED862DA36D
api/captions.js 16139D0F134B8450BEF376376CD9B0D337C09B466FD418E037A378EE3485BEA3
```

## Hosting and shared-data gates (Codex's findings, not re-verified by Claude)

Read-only CLI found the existing Vercel project **mc-wedding** (not mcwedding), Node 24.x,
root `.`, URL `https://mc-wedding-ten.vercel.app`, project ID
`prj_a0VXPP8IZ5q5qIDPyoim98g7D4Jh`. No `.vercel` link, settings or deployment changes.
The dashboard preset said Next.js; the repository says `framework: null`. Verify the
resolved preview build. Vercel's documentation describes WebSocket support as public beta
with connections pinned to an instance; the project's actual behaviour is untested.

Keep `CAPTIONS_ENABLED=false` in production until the release gates pass. (Updated 2 October:
guests no longer use anonymous Auth at all; see LIVE_CAPTIONS.md "Guests: scan a QR code". The
flag `CAPTIONS_GUEST_AUTH_AUDITED` is gone.) The existing schema exposes personal invitation
and RSVP views to `authenticated`, and anonymous Auth users are `authenticated` too, so
anonymous sign-in must stay off unless those grants are audited first. `supabase/audit_captions_auth.sql` is read-only metadata SQL; it has
not been run against the live project. A paid Supabase plan does not settle this.

Codex checked only that `SUPABASE_URL` and a server-role key were present in its session
environment; `DATABASE_URL`, a Supabase management token and an OpenAI key were not. No
values were printed. Do not assume those keys target the right project. Private audio and
earlier test evidence are in the sibling `wedding-live-captions/private/`; keep them out
of deployment and Git.

## Next steps, in order

1. Decide whether to commit this work to the branch. It is a large untracked change with
   no history; a commit of explicit paths is the first thing that would protect it.
2. Get approval for the exact additive SQL (14 `caption_*` tables, their functions,
   policies and grants) and run the read-only Auth audit on the existing project.
3. Apply the approved database change before any dependent frontend is exposed.
4. Deploy a feature-disabled Vercel preview. Probe the WebSocket there, including a
   shortened rotation interval, and measure the reconnect and handoff timings above.
5. Run one explicitly capped real API test.

Still outstanding after that: three phones, same-IP Auth refresh, 50 readers, a three-hour
soak, cost and quality evaluation, and the Peninsula audio and network rehearsal. No
wedding-ready claim, paid plan change, production activation or automatic destructive
cleanup.
