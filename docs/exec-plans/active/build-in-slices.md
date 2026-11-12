# Ship HashiNet in six lovable slices

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

HashiNet is rebuilt from the approved Hearth prototype (`prototypes/hearth-design/prototype/`) as six
slices. Each slice ships one complete journey that a real person can rely on, from the database to
the screen, through the normal release path, and is accepted live before the next starts. Nothing is
built for a journey that isn't in the slice being built, and nothing is kept for one that has been
replaced.

This plan sets the order and each slice's acceptance. The detail lives where it already is:
[business-scopes.md](business-scopes.md) for the schema, the access policy, sign-in protection,
invitations, packages and the business profile (its M1 to M5); [redesign-admin.md](redesign-admin.md)
for every screen decision (its H2 to H7); [build-hashinet.md](build-hashinet.md) M6 and M8 for mobile
money, SMS and the physical router. The prototype is the reference for every screen and workflow;
where the build and the prototype differ, the prototype wins unless this plan records why.

Observable result when the plan completes: a platform admin invites a business; its owner accepts,
protects their sign-in, has a router set up, and sells printed vouchers at three venues with a business
manager, a venue manager and an operator; HashiNet invoices the business monthly and records its
payments; guests buy online once Snippe's and BRIQ's credentials exist.

## Progress

- [x] (2026-11-12) Full prototype reviewed and approved by the owner after the journey and role review
  (every persona walked in the browser, the interface audited, the logic code-reviewed); the rules it
  settled are in redesign-admin.md's Decision Log. Theme surface steps approved and applied
  (`DESIGN.md`, then `apps/web/app/globals.css`, now `apps/web/app/hearth.css`).
- [x] (2026-11-12) This plan written; slices agreed with the owner.
- [ ] Slice 1: one owner, one venue, selling. Built on the local branch `slice-1`; merged to `main` only
  when it passes its acceptance, as every push to `main` releases. Steps, each ending with
  `bun run verify` passing and a commit:
  - [x] (2026-11-12) (a) The baseline schema (business-scopes M1): one migration
    `20261112150016_baseline` replacing the twelve, with businesses, memberships (one per person
    per scope, by a NULLS NOT DISTINCT unique index; each role in its own scope, by CHECK), membership
    venues, invitations, passkeys, user preferences, platform default packages, sessions carrying
    the active membership and how they signed in, packages and venues owned by a business (venue
    region and area replacing location), and the ADR-0012 audit log; every key defaults to
    `uuidv7()`. `packageType` and the notification preferences dropped (unused). Better Auth 1.7.22
    with `@better-auth/passkey` 1.7.22. `bun run platform:bootstrap` (replacing `staff:add`)
    creates only the platform admin and the default packages; the development seed holds the
    prototype's personas with example.com addresses, safe to repeat. `REGIONS` and the role types
    in `@hashinet/types`. Verify does not pass yet: 86 type errors in 31 files that still read
    `staff` and `operatorId`, which (b) replaces; (a) and (b) close together.
  - [x] (2026-11-12) (b) The access policy (`apps/api/src/access/`: one table of actions per role, the
    principal from the session's active membership, the protection rule judged by how the session
    signed in, the venue scope through the membership), `GET /api/me` with workspaces, access and
    capabilities, `POST /api/me/membership` (audited), and the ADR-0012 audit log (typed actions,
    bounded changes, no addresses; its own global module). Removed: the staff guard and module,
    the team module, the request-origin plumbing, the first build's admin web (`app/(staff)`), 56
    web files only it used and 11 web dependencies; the web is the captive portal alone until (g).
    The router sim has its own business. `bun run verify` passes (258 unit tests) and
    `bun run test:integration` passes (116); a security review and the tests found two leaks, both
    fixed (cross-business revenue, a venue manager's scope), recorded in the Decision Log.
  - [x] (2026-11-12) (c) Sign-in: the passkey plugin (`@better-auth/passkey`), bound to the web's host,
    with user verification required at registration and every sign-in; its register, sign-in, list
    and delete routes on the allowlist (renaming refused). A session records how it signed in
    (email code, authenticator, passkey, recovery code); deleting a passkey or making new recovery
    codes needs a session that used protection; someone already protected adds a factor only from
    such a session; a first protection set up in an email-code session protects it. Tests: the
    options ask for verification, an email code alone cannot remove a passkey or add a factor, a
    recovery code signs in once and counts as protected. Verify passes; integration 120/120.
    Left for (g), which needs a browser: a WebAuthn ceremony through Chrome's virtual authenticator
    (an assertion without user verification refused), and replacing the authenticator behind the
    flows' 2-hour proof.
  - [x] (2026-11-13) (d) Inviting a new business's owner, and acceptance (`apps/api/src/invitations/`).
    Platform admins and managers invite by email (`POST /api/invitations/businesses`); HashiNet's
    team lists who is pending; Resend gives a new link and Revoke ends it. Issuing creates only the
    invitation, its token's digest (the 256-bit token travels only in the link's fragment), the
    email and the audit row; inviting the same email again replaces it; a link lasts 72 hours.
    Accepting (`POST /api/invitations/accept/business`, public, token in the body) claims the token
    with one conditional update, then creates or finds the person (name, mobile number, now
    `users.phone`), the business with its region and area, its first venue, its copy of the
    platform's default packages sold there, and the owner's membership, all audited; it signs no
    one in. Someone already on HashiNet keeps one identity and gains a workspace. Tests cover
    each of these and the refusals (used, replaced, revoked, expired, unknown links; a bad phone or
    region; others inviting). Verify passes; integration 126/126.
  - [x] (2026-11-13) (e) Packages per business (M4): every package query is scoped by business, the
    owner alone sets them, a new business starts with its copy of the platform's defaults (d), and
    a venue sells only its business's packages. `GET /api/packages/export.csv` lists each package,
    its time, devices, price, whether it is on sale and where it is sold (platform staff also see
    the business); cells are escaped and a value starting `= + - @` is kept as text. A sale keeps
    its price: vouchers and payments store it when made and the figures sum what is stored, with a
    test that raises a price after printing. Venue-limited packages for venue managers come with
    their role in slice 2. Verify passes; integration 128/128.
  - [x] (2026-11-13) (f) Routers under the access policy: HashiNet's admin and managers add, change,
    set up and bootstrap routers at any business's venue (`router.manage`); its operators run
    connection checks (`router.check`); a business reads its own routers in scope and changes
    none; setup output stays the platform's. The setup flow itself (bootstrap script, background
    setup, readiness journey, tunnel) carries over unchanged. Tests cover each role. Integration
    129/129.
  - [x] (2026-11-13) (g) The screens, against the prototype, ported from its stylesheet
    (`apps/web/app/hearth.css`) and building blocks (`components/hearth/`): sign-in (passkey, email
    code, authenticator, recovery code), the shell (business head, venue filter, menu from
    capabilities, account menu and workspace switch), the owner's Overview, Vouchers and Print
    vouchers, Payments, Packages, Account and security with its flows in place, Help, the platform's
    Businesses with Invite a business, accepting an invitation, a venue's router page, and the
    captive portal. Each was walked in the browser and checked at 1280 and 375 (390 for the portal)
    wide, light and dark: no overflow and every text reaching AA contrast, measured from computed
    colours; compared with the prototype side by side. Walked end to end: Paul protected his sign-in,
    invited an owner who accepted and signed in; a passkey registered and signed in through Chrome's
    virtual authenticator and was refused without user verification; the authenticator set up with a
    real code; a sheet of twelve vouchers printed; a guest's voucher kept when the router could not
    confirm it. The API gained what the screens needed (Decision Log). Verify passes; integration
    135/135. Not walked: a router serving guests, which needs a router (the CHR sim or `chr-test`,
    in (j)).
  - [x] (2026-11-13) (h) Leftovers of the first build removed: its portal components, Tailwind, shadcn
    and their packages and config, `globals.css` (`hearth.css` is the one stylesheet), unused web
    helpers and the old logo; DESIGN.md and the web README point at the new code.
  - [ ] (i) finish-work on the branch: review, security, simplify, the journey-level design audit
    across the slice's screens, docs, CHANGELOG and the handbook.
  - [ ] (j) Production reset (owner-run, Concrete Steps), deploy, and live acceptance.
- [ ] Slice 2: the counter.
- [ ] Slice 3: onboarding a business.
- [ ] Slice 4: getting paid.
- [ ] Slice 5: many venues.
- [ ] Slice 6: online (held until the providers' credentials exist).

Each slice records, separately: implemented and `bun run verify` passing locally; published (pushed,
CI green); deployed (Dokploy running the new image); accepted live (the slice's acceptance, done on
`hashinet.hashikome.com`).

## Surprises & Discoveries

- Observation: Better Auth runs its `after` hooks for failed calls too, with the error as the result,
  so the first-enrollment upgrade in (c) turned an email-code session into an "authenticator" one on
  a wrong code: a way past the protection rule.
  Evidence: `better-auth/dist/api/dispatch.mjs` (`runAfterHooks` after an `APIError`); fixed in (g)
  part 1 with a regression test ("a failed authenticator check never upgrades an email-code session").
- Observation: the first build's form floor of TSh 1,000 on package prices survived into the API and
  refused the approved default hour of TSh 500; voucher codes still had the old prefix form that
  ADR-0008 had replaced with 12 digits.
  Evidence: `package-input.ts`, `voucher-codes.ts` before (g).
- Observation: Better Auth's own recovery codes mix cases and use 0, O, 1, I and l, hard to copy off
  paper.
  Evidence: `better-auth/dist/plugins/two-factor/backup-codes`.

## Decision Log

- Decision: build in vertical slices ordered by journey, not by layer.
  Rationale: with no users, the fastest way to a product someone relies on is one complete journey at a
  time; a layer built ahead of its screens goes untested by real use.
  Date/Author: 2026-11-12 / owner and Claude.
- Decision: no backward compatibility, and dead code goes as each slice lands.
  Rationale: HashiNet has no users (owner, 12 November 2026); keeping compatibility costs more than it
  earns. What each slice builds is the authoritative code and the base for the next. A slice removes
  the implementation it replaces in the same change: old routes, modules, models, screens, types,
  tests and docs, with no shim, alias, adapter, deprecated path or feature flag kept for them. Screens
  of the first build that no slice has rebuilt yet are removed when their replacement lands, never
  kept beside it. AGENTS.md's Pre-deployment compatibility section is the standing rule; the data
  safety it keeps (no rewritten applied migration, no discarded data without approval) still holds,
  and the one baseline migration was approved on 4 November 2026 (business-scopes.md).
  Date/Author: 2026-11-12 / owner.
- Decision: each sale stores its price when it is made.
  Rationale: a later price change must never re-price past sales (journey review, 12 November 2026).
  Date/Author: 2026-11-12 / Claude, from the code review.

- Decision: each slice is built on a local branch (`slice-<n>`) that is never pushed and has no pull
  request; when the slice passes its checks it is merged into `main` locally with
  `git merge --ff-only`, then `main` is pushed, which releases it.
  Rationale: the owner's workflow (12 November 2026); `main` stays releasable while a slice is broken.
  Date/Author: 2026-11-12 / owner.
- Decision: run finish-work at the end of every slice, on its branch, before the merge.
  Rationale: each slice ships and becomes the base for the next, so its review, security pass,
  simplification, design audit and docs land with it; problems found later cost more to undo. The
  last slice's run also completes this plan.
  Date/Author: 2026-11-12 / owner and Claude.

- Decision: the cross-business revenue routes (`/api/revenue/*`, `/api/analytics/monthly` and
  `/venues`) stay the platform's (`revenue.read`) until they are scoped by business.
  Rationale: a security review of slice 1b found that granting them to owners exposed every
  business's revenue; a business reads its own takings through scoped routes (slice 1's Overview
  and Payments, slice 5's Analytics).
  Date/Author: 2026-11-12 / Claude, from the automated security review.

- Decision: a device's blocked status is shared across HashiNet today (one row per MAC address),
  so blocking reaches every business; until slice 2 makes blocking per business (the prototype's
  blocked list is the business's), only an owner or business manager blocks.
  Rationale: ADR-0011, 7 (nothing from one business applies in another); found while recasting
  the device tests.
  Date/Author: 2026-11-12 / Claude.
- Decision: router setup output (a run's transcript, the live setup stream) is HashiNet's team's
  (`router.check`); guests' hotspot updates in the live view are the business's, never the
  platform's (ADR-0014).
  Rationale: the live view carried both to "admins"; the new roles separate them.
  Date/Author: 2026-11-12 / Claude.
- Decision: a venue manager's or operator's scope goes through their membership's venues
  (`members.some`), never an `id` filter.
  Rationale: an `id` key in the scope replaced the id a caller asked for, so a venue manager could
  read another venue's brand; the integration tests caught it.
  Date/Author: 2026-11-12 / Claude.

- Decision: someone who already has protection adds an authenticator or a passkey only from a
  session that used protection; only a person's first protection marks their email-code session
  protected.
  Rationale: a background security review found that adding a credential from an email-code
  session would have marked it protected, so an email inbox alone could lift ADR-0011, 9's limit.
  Regression test in `sign-in.integration.test.ts`.
  Date/Author: 2026-11-12 / Claude, from the automated security review.

- Decision: a session records when it last proved the person's protection (`sessions.proved_at`: a
  passkey, an authenticator code or a recovery code, at sign-in or since). Removing a passkey, new
  recovery codes, replacing the authenticator, and adding a passkey or an authenticator for someone
  already protected need proof from the last 2 hours; registering a factor never proves a session,
  except a person's first protection (finish-work's security review); replacing it
  (`POST /api/me/authenticator/replace`) removes the old app, then the person sets up the new one.
  Rationale: the prototype's 2-hour proof, as GitHub's sudo mode; Better Auth cannot enable a second
  authenticator while one is verified. Left half done, the session asks for protection again, which
  is safe; `/api/me` gives `provedUntil`, so a flow asks only when it must.
  Date/Author: 2026-11-13 / Claude, from the approved prototype.
- Decision: recovery codes are eight `XXXX-XXXX` codes from an alphabet without 0, O, 1, I or L,
  accepted in any case and spacing.
  Rationale: they are read off paper (prototype); 40 bits each, single use, rate-limited.
  Date/Author: 2026-11-13 / Claude.
- Decision: removing a package takes it off sale for good and keeps it.
  Rationale: the prototype's Remove: printed or sold vouchers keep working and its sales stay in the
  figures. The earlier refusal while vouchers lived came from the first build.
  Date/Author: 2026-11-13 / Claude, from the approved prototype.
- Decision: TSh 500 is the lowest price of a voucher, so of a package and of a platform default
  package; the API refuses less and database CHECKs hold it (`20261113150000_minimum_price`).
  Rationale: the owner's rule (13 November 2026). The first build's TSh 1,000 floor refused the
  default hour of TSh 500, and an interim TSh 100 was too low. The mobile-money provider's own lowest
  amount is a separate rule (`MINIMUM_PAYMENT_TSH`, now 500): the 1,000 may have been Snippe's, which
  the owner is confirming; if so it rises to 1,000, and packages below it sell only as printed
  vouchers, never online.
  Date/Author: 2026-11-13 / owner.
- Decision: voucher codes are 12 digits with no prefix, as ADR-0008 decided; the batch, portal and
  brand prefixes are dropped. A code typed in groups or with dashes is the code.
  Rationale: the prototype's portal keypad and printed cards; no backward compatibility to keep.
  Date/Author: 2026-11-13 / Claude, from ADR-0008.
- Decision: new API for slice 1's screens: `GET /api/businesses` (HashiNet's team), a business's
  `GET /api/analytics/today`, and the theme and setup deadline in `/api/me`.
  Rationale: the prototype's Businesses and Overview need them; the old summary hid a business's own
  revenue from its owner.
  Date/Author: 2026-11-13 / Claude.
- Decision: deferred from slice 1's screens: the signed-out "Contact support" and "Send feedback"
  forms are `mailto:` links until the email form and its Turnstile check exist; the phone tab bar
  waits for selling at the counter (slice 2); a recovery code signs in after an email code, as Better
  Auth's second factor, not in place of it.
  Rationale: each needs a journey that is not in slice 1.
  Date/Author: 2026-11-13 / Claude.

- Decision: slice 1's router page keeps the first build's setup: Add router asks the router's address
  on the venue's network (the script sets it statically), not the prototype's "from the ISP router,
  automatically". The script's API password is stored on the router when the script is made, so the
  first build's warning to copy it into a form went.
  Rationale: the setup flow carries over unchanged in slice 1; taking the address by DHCP changes
  provisioning and is tested on the physical router (build-hashinet M8).
  Date/Author: 2026-11-13 / Claude.

- Decision: slice 1's Help holds the guides for slice 1's journeys only (an owner's printing,
  guests, an offline router, packages and sign-in; the platform's invitations and router script),
  kept in the web (`apps/web/lib/help.tsx`); each later slice adds its guides with its screens.
  "Was this guide helpful?" and serving Help from the API wait until there is somewhere to keep the
  answers.
  Rationale: Help never explains a page that isn't there; the prototype's API-served Help adds a
  store and an endpoint that slice 1 does not need.
  Date/Author: 2026-11-13 / Claude.

## Outcomes & Retrospective

Not started.

## Context And Orientation

- `apps/api` is NestJS on Bun with Prisma on PostgreSQL 18 (`apps/api/prisma/schema.prisma`). Its
  modules today (`staff`, `team`, `venues`, `routers`, `packages`, `vouchers`, `devices`, `sessions`,
  `live`, `payments`, `analytics`, `portal`, `brand`, `audit`, `auth`, ...) serve the first build: one
  owner, venues without a business, and `staff` for roles.
- `apps/web` is Next.js; the first build's admin is under `apps/web/app/(staff)/`, the captive portal
  under `apps/web/app/join/`. The web reaches the API only through `lib/api.ts` and `@hashinet/types`.
- The prototype (`prototypes/hearth-design/prototype/`, plain HTML and JavaScript, served locally) is
  the approved design and workflow for every role: personas Paul (platform admin), Asha (platform
  manager), Hamisi (platform operator), Neema (owner of three venues), Juma (owner of one), Rehema
  (owner with online payments), Baraka (owner setting up), Grace (business manager), Daudi (venue
  manager) and Musa (venue operator).
- Roles and what the owner and the platform admin keep: ADR-0011. Platform staff see a business's
  guests only as counts: ADR-0014. Branding: ADR-0009. Onboarding packages and fees: ADR-0013.
- A slice is "lovable" when its journey works end to end for the person it serves, on a phone and a
  desktop, in light and dark, with design-audit reporting no P0 or P1 on its screens.

## Plan Of Work

**Slice 1, one owner, one venue, selling.** For Paul's home and owners like Juma.
Backend: business-scopes M1 (the baseline schema with businesses, memberships, invitations and
business packages; `staff` and its module removed), M2 (the access policy, `GET /api/me` with
capabilities, sign-in with email codes, passkeys and the authenticator, the session-based protection
rule, recovery codes, the audit log), the part of M3 that invites a new business's owner and accepts
it, and M4 (packages per business). Routers: the existing setup (bootstrap script, background setup,
readiness) moves under the access policy for the platform admin, so Paul's home router is set up
from the new screens.
Screens (redesign-admin H2, H3, H5, H6): the shell with the business head, scope filter and account
menu; the owner's Overview; Vouchers and Print vouchers; Payments (cash, read); Packages; Account and
security as a page with its flows in place; Help for the owner; the captive portal with vouchers; the
platform admin's minimal Businesses page with Invite a business, and a venue's router page.
Removed: the first build's admin screens, `staff`, `team`, `@Roles` and every route, type and test
only they used.
Accepted live: Paul is invited as the owner of Paul's home, accepts, protects his sign-in with a
passkey, prints vouchers, and a guest redeems one through `chr-test`. No physical router is installed
yet (owner, 12 November 2026), so that stays with build-hashinet M8 and does not block the slice.

**Slice 2, the counter.** For a venue manager and an operator (Daudi, Musa).
Backend: business-scopes M3's business-role invitations with venues; recording a sale (cash or mobile
money, its code issued at once and its price stored); confirming an operator's sale; releasing a
voucher and its switch PIN (ADR-0015); blocking and unblocking a device; live sessions.
Screens: the operator's Today (Sold today and Cash today counting every recorded sale); Sell a voucher
and the issued code; Payments with To confirm; Live sessions; Devices; Team and Invitations; the Audit
log; Help for the venue manager and operator.
Accepted live: Paul's home invites an operator, who sells a voucher at the counter; the owner confirms
it; the guest gets online with it.

**Slice 3, onboarding a business.** For the platform admin, manager and operator (Paul, Asha, Hamisi).
Backend: invitations for platform roles; the business's 7 days to get set up; the router preference
and the package call as an issue; issues with claims kept per workspace; serving and selling only
once the owner's sign-in is protected; counts-only reach into a business's guests.
Screens: Businesses and a business's page, Issues with claim, hand to and take over, the platform's
Venues and Routers, the Team for platform roles, the owner's getting-started overview (Baraka), the
platform's Help.
Accepted live: Asha invites a test business; its owner accepts, protects their sign-in and chooses how
the router comes; Asha confirms the package and sets up its router; the venue serves.

**Slice 4, getting paid.** For the platform admin and manager, and every owner.
Backend: monthly invoices (5% of each venue's sales, at least TSh 5,000 a venue, 2.5% above
TSh 2,000,000 a month), onboarding and router fees (ADR-0013), recording a payment (oldest invoice
first), reminders, the fees the admin sets for new businesses.
Screens: the platform's Payments, a business's invoices, the owner's Billing with How to pay and its
invoices, Fees (the admin only).
Accepted live: the test business's first invoice is issued; Asha records its payment; the owner sees
it paid.

**Slice 5, many venues.** For an owner of several venues and their team (Neema, Grace, Daudi).
Backend: the business manager role; venue managers over several venues; Add a venue and its
onboarding package; prices per venue; captive portal branding (ADR-0009); business-scopes M5 (the
business profile with its logo); analytics computed by the API; the packages CSV export.
Screens: the venue switcher, Venues and a venue's page, Captive portal, General, Analytics (usage
and sales), the business manager's and venue manager's views (H4: every list and form on a phone).
Accepted live: the test business adds a second venue with its own price and portal; its business
manager and venue manager each see what their role allows and nothing else.

**Slice 6, online.** Held until Snippe's and BRIQ's credentials exist (build-hashinet M6).
Self-service purchase on the portal, payouts, SMS credits, and the owner's request for online
payments with the platform's review. Accepted as build-hashinet M6 says, then live with a real payment
and a real message (M8).

Within each slice the order is: schema, then the API with its tests, then the screens against the
prototype, each built with design-build and audited with design-audit at 1280 and 375 pixels in light
and dark as soon as it is finished, its P0 and P1 fixed before the next screen (redesign-admin H7);
then removal of what the slice replaced; then finish-work on the branch, whose design audit checks the
slice's journeys across screens (review, security, simplify, docs, CHANGELOG, the handbook); then
`git merge --ff-only` into `main`, push, and live acceptance.

## Concrete Steps

Run from the repository root, for each slice:

```bash
bun run infra:up
bun run db:migrate
bun run db:seed
bun run verify
bun run test:integration
```

Expected result: every check passes. The prototype runs for comparison with
`python3 -m http.server 8797` in `prototypes/hearth-design/prototype/`.

**Production reset, slice 1 only, run with the owner just before its first deploy.** The baseline
replaces the twelve applied migrations, so `prisma migrate deploy` cannot move the existing
`hashinet` database forward; its rows are test data, but they include the owner's account and the
routers' credentials and WireGuard peers. With the owner's explicit go at that time (the 4 November
approval predates the cutover): take a final backup, drop and recreate the `hashinet` database's
schema with the migrator role, deploy (the release's migrate stack applies the baseline), run the
production bootstrap for the platform admin, then set up `chr-test` and any physical router again so
they regain management. Record each step's time and outcome here.

## Validation And Acceptance

- Each slice's live acceptance above, done by the owner or with them, on `hashinet.hashikome.com`.
- `bun run verify` and `bun run test:integration` pass; the access policy has a test for each role's
  allowed and refused actions in the slice.
- design-audit reports no P0 or P1 on the slice's screens at 1280 and 375 pixels, light and dark.
- A search for the removed modules, routes and types finds nothing outside the plans' history.

## Idempotence And Recovery

The seed can be re-run on a fresh database. The baseline migration (slice 1) replaces the first
build's migrations and drops their data, approved on 4 November 2026; after it, migrations are only
added, never edited. A slice that fails live acceptance is fixed forward; nothing is kept from the
previous build to fall back to.

## Artifacts And Notes

- The journey and role review of 12 November 2026: redesign-admin.md, Decision Log.
- Prototype personas and routes: `#<persona>-<screen>[-<id>]`, for example `#musa-overview`.

## Interfaces And Dependencies

- `@hashinet/types` carries every API contract; the web never imports Prisma.
- `GET /api/me` returns the person, their memberships and the active membership's capabilities; the
  web draws navigation and buttons from them (business-scopes M2).
- Better Auth for sign-in (ADR-0007) with its passkey and two-factor plugins (ADR-0011 §9).
- Snippe (payments) and BRIQ (SMS) only in slice 6.
