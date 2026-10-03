# MCWedding live captions — Claude → Codex handover

Written 2026-10-03 by Claude Code on the main Windows PC. Codex holds the branch from here;
Claude has stopped and holds nothing.

**State in one paragraph.** Live captions work end to end on a public Vercel **preview** of
branch `codex/live-captions-ui` (HEAD `10988b5`, pushed). The operator runs captions from the
admin portal; guests scan a QR code and read, with no account. The user tested it with the
Mac's microphone and with a phone, and called both good. **Production (`main`, the live
wedding site) is untouched**: no merge, no production variables, captions off there.

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
