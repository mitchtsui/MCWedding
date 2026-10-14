# Wedding party hub — 13 October 2026

## Entry and scope

`wedding-party.html` is the separate bridesmaid/groomsmen hub. Wedding Day is the default;
the other tabs are VIPs, Seating Plan and Live Captions. Tabs retain their iframe state,
including an open caption session. The admin portal remains a separate tool.

The entrance uses a shared password, with a second password for caption operation.
Neither flow asks for email, an account or a Supabase magic link. The passwords selected
by the couple are server-only configuration, never documented here or bundled into HTML.

The server gate covers the hub, standalone rundown and its data, VIP data/photos, the
read-only seating page/data API, and the hub-mode caption operator page. Existing
invitation/admin routes and direct invite-token guest caption viewing retain their own
access rules. Publishing this release makes previously shareable rundown links require
the hub password too. `noindex` is not the access control.

`middleware.js` uses Vercel's Node routing middleware before static-file delivery;
`api/seating-view.js` additionally verifies the session itself. Encoded and repeated-slash
path variants are normalized or fail closed. Protected responses are private/no-store.
Implementation follows the [Vercel routing middleware documentation](https://vercel.com/docs/routing-middleware/getting-started), checked 13 October 2026.

## Contents

- Wedding Day reuses the existing source-based rundown and Hong Kong clock, including
  the confirmed parallel activities. Only the shared-hub navigation is hidden in an iframe.
- VIPs retains all 22 supplied relatives. The private row order and labels live in
  `hub-private/vip-data.json`; the public `vip-guide-data.js` only loads the protected
  endpoint. Rows stay intact and scroll horizontally on narrower screens. Current
  portraits are extracted from the supplied PDF; higher-resolution replacements are
  pending the couple.
- Seating mirrors current physical assignments, including assigned guests whose attendance
  remains pending. It never assigns guests or shows seat numbers. The GET-only endpoint
  returns names and table numbers, excludes preview rows, preserves duplicate names and
  fails closed on unsupported response size. Unassigned guests do not appear. The plan
  remains 13 tables (Room 9, Foyer 4), with tables 4 and 14 absent and stage-right empty.
- Captions has Watch and Operate modes. Generated guest QR links point directly to the
  invite-token viewer, so guests need neither password. A party member can paste that
  link in the hub. Invite tokens stay in URL fragments and are not stored by the hub.

## Session and operation behavior

`GET /api/hub-session.js` returns session status. POST accepts `login` with `password`
or `logout`. Hub logout atomically expires both hub and operator cookies.
`/api/captions.js` adds `operatorStatus`, `operatorLogin` and `operatorLogout`;
all password-cookie caption operations also require the hub session. Existing explicit
Bearer authorization remains separate and takes precedence.

Both eight-hour sessions are signed, HttpOnly, Secure and SameSite=Strict. Password or
signing-secret rotation invalidates the corresponding cookies. Login mutations require
the same origin. Failed-password throttling is five attempts per 15 minutes per IP per
serverless instance; it is not a global/distributed lockout. The requested short passwords
remain a shared secret, not individual accountability or strong identity assurance.

Password operators receive no Supabase JWT. The server keeps its service key and exposes
caption-scoped actions only. Three language snapshots poll every two seconds; each
operator session has its own bounded read-rate identity. Audio still uses single-use
uplink tickets. Logging out is disabled during an open/pending caption run: end/stop it
first. Entrance expiry opens an inline reauthentication dialog, preserving the operator
iframe/run IDs; recovery must not automatically restart audio capture.

## Deployment

The VIP guide deliberately separates its public interface from its private source assets:

- `vip-guide.html`, `vip-guide.js` and `vip-guide-data.js` are safe to include in the
  public static build. They contain the interface and loader, not the private roster.
- `hub-private/vip-data.json` and `photos/vip/` are ignored by Git and excluded from
  `dist/`. Do not copy either path into the public build.
- `GET /api/vip-assets.js?asset=data` verifies the hub session before reading and
  sanitizing the private metadata. The same endpoint serves allowlisted portrait filenames.
  Responses are private/no-store and unsupported assets fail closed.
- `vercel.json` attaches `hub-private/vip-data.json` and `photos/vip/**` to the
  `api/vip-assets.js` serverless function with `includeFiles`. A Vercel CLI deployment
  must therefore run from the authorized machine that holds those ignored files. A Git
  push or Git-based build alone cannot supply them.

Release order:

1. Apply `supabase/migrations/2026-10-13_caption_password_operator.sql` to the wedding
   database before enabling password operation. It only replaces the ticket-issuance
   function, consistently using the stable service-role operator UUID. It does not
   change the guest list. Original applied migrations remain untouched.
2. Configure `WEDDING_HUB_PASSWORD`, `WEDDING_HUB_SESSION_SECRET`,
   `CAPTIONS_OPERATOR_PASSWORD`, and `CAPTIONS_OPERATOR_SESSION_SECRET` as sensitive
   production settings. Use independent random signing secrets of at least 32 characters.
3. Retain the existing caption provider/service credentials and exact allowed origins.
   Run `npm run build`, then deploy with the Vercel CLI from the authorized machine so
   the ignored VIP sources are attached to the server function. Deploy middleware, APIs
   and static output together. A plain static file host cannot provide the password gate.
4. Verify live unauthenticated asset denial, both password gates, seating projection,
   direct guest viewing, and logout. Do not use a paid audio run merely to test login.

The four production secret settings were saved. On 13 October 2026, the couple explicitly
requested live publication while they apply the SQL migration. Source revision
`3f4518c` was deployed to [the production hub](https://mc-wedding-ten.vercel.app/wedding-party.html)
(Vercel deployment `dpl_A4c3Zg9wTaawoPSmDSbmbuXAgR57`). The entrance uses the couple's
revised single-sentence heading.

Production checks passed: protected-route denial; correct/incorrect entrance and caption
passwords; all 22 authenticated portraits and seven row groups; seating response field
limits; direct guest viewer access; caption preflight; and logout clearing both cookies.
No paid audio run was started. The SQL migration is **not yet confirmed applied**; caption
audio operation remains pending that prerequisite even though password/preflight checks pass.

Git excludes the private attachments. Hosted builds fail closed if they are missing,
so a Git-only deployment cannot silently replace the working family guide. Use Vercel CLI
from the authorized workspace holding those files for future releases.

## Evidence and limits

- Local Chromium integration: four widths (344/390/744/1280), tab/iframe state retention,
  keyboard tabs, exact family rows, two password gates, wrong password, logout, direct
  protected-file denial, fragment-only invite links and reload behavior.
- Actual PGlite exercises the original ticket mismatch, applies the new migration twice,
  verifies both service-role and authenticated-user issue/consume paths and grants.
- Independent read-only review caught polling-rate, logout-race, dual-cookie cleanup,
  guest-link and expiry-recovery issues; fixes have focused regressions. Review shares the
  filesystem; the SQL review was given the prior defect, so was not blind.
- Synthetic browser fixtures are not proof of live guest assignments. Local checks do
  not establish Vercel routing, paid stream quality, physical phone/Safari behavior or
  venue/network readiness. Those are separate from a successful hub publication.

## Share preview — 13 October 2026

The hub and public login page carry matching Open Graph and Twitter metadata. The public
1200 × 630 Paris wedding photo (`photos/og-preview.jpg`) is the key visual, with description
“The day’s plans, familiar faces, and everything to keep close.” The title identifies the
wedding party and couple. Unauthenticated share crawlers follow the existing login redirect;
no crawler bypass grants access to private hub data. Actual WhatsApp rendering/cache refresh
must be confirmed in WhatsApp; fetching the deployed metadata only verifies its availability.

## Caption shutdown - 14 October 2026

At the couple's request, five open caption runs were stopped through the existing
caption_transition_run RPC; a second read returned zero open runs. CAPTIONS_ENABLED
was set to false in production, preview defaults and local configuration. Production
was redeployed to block new caption connections while retaining the hub. Historical
deployment URLs retain their own environment snapshots; this does not revoke those
deployments. The reported stale-publisher error stream still needs diagnosis; stopping
open runs does not establish the source of the full error count or prove it has ceased.
