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
  (`DESIGN.md`, `apps/web/app/globals.css`).
- [x] (2026-11-12) This plan written; slices agreed with the owner.
- [ ] Slice 1: one owner, one venue, selling. Built on the local branch `slice-1`; merged to `main` only
  when it passes its acceptance, as every push to `main` releases. Steps, each ending with
  `bun run verify` passing and a commit:
  - [ ] (a) The baseline schema (business-scopes M1), a development seed of invented businesses, and a
    separate production bootstrap that creates only the platform admin (replacing `staff:add`).
    Merged with (b) if the web's typecheck against `@hashinet/types` can't pass without it.
  - [ ] (b) The access policy, `Principal`, `GET /api/me` with capabilities, the audit log (ADR-0012);
    every old module rewired or deleted.
  - [ ] (c) Sign-in: passkeys, the authenticator, recovery codes, and the session-based protection
    rule, with tests (ADR-0011 §9).
  - [ ] (d) Inviting a new business's owner, and acceptance.
  - [ ] (e) Packages per business (M4); a sale stores its price when its voucher is issued.
  - [ ] (f) Routers under the access policy: add, bootstrap script, setup, readiness.
  - [ ] (g) The screens, against the prototype (read the version-matched Next.js guide first), each
    built with design-build and audited with design-audit as it is finished, P0 and P1 fixed before
    the next screen.
  - [ ] (h) Whatever is left of the first build, removed.
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

- Observation: none yet.
  Evidence: -

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
