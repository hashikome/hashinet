# Group the code by what the product does

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work proceeds.

## Purpose / Big Picture

`apps/api/src` holds 37 folders side by side: features (`vouchers`, `billing`), plumbing (`http`,
`database`) and grab-bags (`services` with 5,359 lines of router code, `utils`, `serializers`). A reader
can't tell which belong together, and a new piece has no obvious home. After this plan, the API is
eight areas that follow the product, the tests, the shared types, the web's components and the router
sim follow the same areas, and the grab-bags are gone. Nothing behaves differently: every slice is a
move, proved unchanged.

Asked for by the owner (28 November 2026) before the provider-neutral payment and SMS gateways, so
those land in their final homes (`sales/payments/providers/`, `sales/sms/providers/`).

## Progress

- [x] (2026-11-28) Survey, grouping tested against the import graph, shape approved by the owner.
- [x] (2026-11-28) M1 `core/`: what every area uses. 49 files moved (6 integration tests to
  `test/integration/core/`), 3 dead files removed; verify, 234 integration tests and the route and
  module map identical to the baseline.
- [x] (2026-11-28) M2 `network/`: the routers. 58 files moved (5 integration tests to
  `test/integration/network/`); verify, 234 integration tests, the map identical, and the router sim's
  `guest-test` 22/22 on two RouterOS 7.25 routers.
- [x] (2026-11-28) M3 `platform/`: HashiNet running businesses. 36 files moved (6 integration
  tests to `test/integration/platform/`), the `platform:bootstrap` script repointed; verify, 234
  integration tests, the map identical, the bootstrap command starting from its new path.
- [x] (2026-11-28) M4 `people/`: auth, team, invitations. 18 files moved (3 integration tests);
  verify, 234 integration tests, the map identical.
- [x] (2026-11-28) M5 `venues/`: venues, sites, packages, payment-ways. 20 files moved (3
  integration tests); verify, 234 integration tests, the map identical.
- [x] (2026-11-28) M6 `sales/`: vouchers, payments, devices, sessions, sms (was messaging). 28
  files moved (3 integration tests); verify, 234 integration tests (3 payment tests timed out once at
  load 13 and passed alone and on a rerun), the map identical.
- [x] (2026-11-28) M7 `guest/` (sign-in, portal, brand), and `analytics/` alone; the root holds
  only bootstrap. 30 files moved (every integration test now sits in its area's folder, the shared
  harness at the root); the codemap and `apps/api/README.md` show the eight areas.
- [x] (2026-11-28) M8 `packages/types/src/index.ts` (1,803 lines) split by area, with
  `ref/restructure/split-types.py`: its 136 top-level declarations byte-identical before and after,
  all 163 exported names still exported (a probe file referencing each from `index.ts` typechecks; a
  missing name fails it), and every workspace typechecks. `platform.ts` is the largest at 539 lines.
  The files import each other with `.ts` specifiers (`allowImportingTsExtensions` in the root, API and
  web tsconfigs, all `noEmit`): the API's NodeNext needs an extension and Turbopack doesn't map `.js`
  to `.ts` inside a workspace package.
- [x] (2026-11-28) M9 The web's components: `components/hearth/` into `ui/` (primitives, importing
  no area), `app/shell.tsx` (the frame, which holds the sell flow) and one folder per area; 24 files
  moved, 66 importers rewritten; verify, and `next build`'s 35 routes identical.
- [x] (2026-11-28) M10 `tooling/router-sim.ts` (1,816 lines) into `tooling/router-sim/`: `sim.ts`
  (settings, the `--router` choice, saved state; imports no sibling, so it runs first), `vm.ts`,
  `onboarding.ts`, `setup.ts`, `guest.ts`, `guest-test.ts` (529 lines), `hub.ts`, `main.ts` (the
  commands), with `ref/restructure/split-sim.py`. Every non-import line is unchanged but for `export`,
  `ROOT` one folder deeper and the two strings naming the sim's own path; `guest-test` 22/22 before
  and after a hub restart that runs the relay from the new path.
- [ ] Later, not moves (each its own milestone when reached): the upward imports `core/` keeps
  (below); the files over 500 lines split by job.
- [x] (2026-11-28) M11 The API's files over 500 lines, split by job (a long file with one job stays):
  - [x] (2026-11-28) `network/provisioning/steps.ts` (1,029): the firewall rule-placement toolkit to
    `firewall-order.ts`, the RouterOS yes/no reader to `ros-client.ts`; the ordered step list (875
    lines, one job) stays. Every line unchanged but for `export` and two doc comments.
  - [x] (2026-11-28) `platform/billing/invoices.ts` (764): issuing stays (`Invoices`); bill issues,
    reminders and what a business owes to `bill-reminders.ts` (`BillReminders`); Billing's reads to
    `billing-accounts.ts` (`BillingAccounts`); an invoice's API shape and its query to
    `invoice-record.ts`. Lines unchanged but for the cross-class calls and the class headers; the
    map gains only the two providers; the billing and venue integration tests pass.
  - [x] (2026-11-28) `sales/payments/payments.service.ts` (715): the online purchase stays
    (`PaymentsService`); the counter sale to `counter-sales.ts` (`CounterSales`); staff's lists to
    `payment-lists.ts` (`PaymentLists`). Drawing an unused voucher code, written twice, is one
    `unusedCode` in `sales/vouchers/voucher-codes.ts`. The sales integration tests pass; the map
    gains only the two providers.
  - [x] (2026-11-28) `platform/issues/issues.service.ts` (657): router issues kept in step with the
    routers, and their logged steps, to `router-issues.ts` (`RouterIssues`, the same job); the issues
    workflow (590 lines, one job) stays. The issue and network integration tests pass; the map gains
    only `RouterIssues`.
  - [x] (2026-11-28) `network/routers/routers.service.ts` (622): running setup (from the router's
    page, again after a release, the setup issue, the provision runs) to `router-setup.ts`
    (`RouterSetup`, with `setupIssueKey`); records and checks stay. The network, issue and
    onboarding integration tests pass; the map gains only `RouterSetup`.
  - (2026-11-28) Kept whole: `guest/sign-in/guest.service.ts` (556), signing a device onto a voucher
    (redeem, admit, the claim and the PIN checks, about 300 lines) with the portal's small reads that
    share its router lookup; `packages/types/src/platform.ts` (539), one area's contract.
- [ ] M12 The web's files over 500 lines (`join/portal.tsx` 959, the sign-in page 921, the packages
  page 791, `components/guest/portal-editor.tsx` 773, the router page 636, `lib/help.tsx` 590, the
  onboarding steps 562, the issue page 548, `components/sales/sell.tsx` 526), each read for its jobs
  and split where it holds several, proved by verbatim lines, `next build` and a look at each screen.

## Surprises & Discoveries

- (2026-11-28) `utils/retry.ts` and `utils/duration.ts` have no users in the API (only their own
  tests); the web's `lib/duration.ts` only names the API copy in a stale comment. Removed in M1.
- (2026-11-28) M1 moved `core/config/config.ts` a level deeper, and its defaults for the email and
  SMS outboxes and the brand store found `data/` from the file's own place, so they pointed under
  `apps/data/` (local development only; production sets Resend and R2). Found by the workspace
  session after the release; fixed with a test against git's root. Every slice should grep its moved
  files for `import.meta.url`, `import.meta.dir` and `__dirname` before moving them.
- (2026-11-28) The router sim computed its root from its own folder and named its own path in two
  strings (the hub runs it in a container): splitting a file into a folder moves both one level.
  Its destructured `command` and `args` escaped the splitter's declaration pattern; they moved to
  `sim.ts` with the argument parsing.
- (2026-11-28) The shell imports the sell flow (`SellProvider`), so it is not a primitive: it is the
  app's frame, above the areas, in `components/app/`. The move tool's first M9 run rewrote nothing:
  it tried `.ts` but not `.tsx` for an extensionless specifier; undone, fixed, rerun.
- (2026-11-28) The web's `lib/duration.ts` still describes a `backend/` that rendered the portal
  (`DURATION_BUCKETS`); the API has no such code. Left for an upkeep pass, not a move.
- (2026-11-28) The move tool let a folder's line override files named on their own lines; M2's
  tunnel and outage files landed in `network/routers` and were moved on in the same slice. The tool
  now lets an explicit file win.
- (2026-11-28) M3 to M6 committed `apps` and `docs` only, leaving the move tool's rewrites of
  `tooling/router-sim.ts` uncommitted (verify passed, since it checks the working tree); they are
  committed after M8. Each slice now stages everything with `git add -A`, after `git status` shows
  nothing that isn't the slice's.
- (2026-11-28) `access` (96 imports from other folders) and `audit` (23) are used by every feature,
  so they are foundations, not "people" features: with them in `core/`, imports between areas fell
  from about 450 to about 100.

## Decision Log

- (2026-11-28) Eight areas, each a folder of the feature folders it groups (owner):

  ```text
  apps/api/src/
    main.ts  entrypoint.ts  app.module.ts     bootstrap only
    generated/        the Prisma client (unchanged; git-ignored)
    core/             config database http observability jobs crypto email health live
                      access (the one policy)  audit (the log)  time  records  phone.ts
    people/           auth team invitations
    platform/         businesses onboarding billing issues bootstrap
    venues/           venues sites packages payment-ways
    sales/            vouchers payments devices sessions sms
    guest/            sign-in portal brand
    network/          routers tunnel provisioning mikrotik monitor radius mac.ts
    analytics/
  ```

- (2026-11-28) Folders inside an area keep their files' names; a slice renames a folder only where
  the old name stops making sense in its area (`services/router-provision` is `network/provisioning`,
  `messaging` is `sales/sms`, `guest` is `guest/sign-in`, `serializers/records.ts` is
  `core/records/records.ts`, `platform/` is `platform/bootstrap/`).
- (2026-11-28) Moves only. A move touches imports, paths that name files (scripts, Dockerfiles,
  docs) and the codemap, and nothing else. Breaking a cycle or an upward import changes code, so it
  is a later milestone, not part of a move.

## Context And Orientation

The API is NestJS on Bun with Prisma; each feature folder has its module, controller and service.
Integration tests live in `apps/api/test/integration/` and import from `src`; unit tests sit beside
their source. `tooling/router-sim.ts` imports API internals by relative path. The web never imports
the API (`ARCHITECTURE.md`, dependency rules); it reads `@hashinet/types`.

What `core/` still imports from areas above it, kept by the moves and named for a later milestone
(`config/config.module.ts` building the payment and SMS adapters and the brand store went with the
provider gateways, 28 November 2026; `config/config.ts` still reads `network/provisioning/ipv4.ts`); `records/records.ts` reads billing and
router helpers; `http` reads the brand's upload limits; `access` reads auth and billing; `audit`
reads analytics' periods. Two-way pairs between areas after the moves: platform and venues, guest and
venues, counter and network, counter and guest, network and platform.

## Plan Of Work

Each milestone moves one area on the branch `restructure`, one commit each:

1. Write the slice's map (`old new` per line) and run the move tool:
   `bun ref/restructure/move.ts <map>`. It `git mv`s each file (history follows) and rewrites every
   relative import pointing at a moved file, and the moved files' own relative imports, including the
   tests and `tooling/`. The tool lives in git-ignored `ref/`; its method is the paragraph above, so
   it can be rewritten if `ref/` is gone.
2. Fix what names a moved path outside TypeScript: `apps/api/package.json` scripts,
   `apps/api/Dockerfile`, `.dockerignore`, `biome.json`, `AGENTS.md`, `ARCHITECTURE.md` (codemap and
   dependency rules), `docs/SECURITY.md`, ADRs and runbooks that name `apps/api/src/...`.
3. Move the area's integration tests to `apps/api/test/integration/<area>/` in the same slice.
4. Prove it (below), update this plan's Progress, commit.

The slice maps:

- **M1 core:** `config database http observability jobs crypto email health live access audit` to
  `core/<same>`; `serializers` to `core/records`; `analytics/business-day.ts` (and its test) to
  `core/time/`; `utils/phone.ts` to `core/phone.ts`; `utils/retry.ts`, `utils/duration.ts` and
  `utils/duration.test.ts` deleted.
- **M2 network:** `routers` to `network/routers`, with `tunnel-allocator.ts`,
  `tunnel-peers.controller.ts` and `tunnel-secret.ts` to `network/tunnel/`;
  `services/router-provision` to `network/provisioning`; `services/mikrotik*.ts`,
  `router-credentials.ts`, `router-log.ts` to `network/mikrotik/`; `services/live-monitor.ts`,
  `router-sync.ts` and `routers/router-outages.ts` to `network/monitor/`; `radius` to
  `network/radius`; `utils/mac.ts` to `network/mac.ts`.
- **M3 platform:** `businesses onboarding billing issues` to `platform/<same>`; `platform/bootstrap*`
  to `platform/bootstrap/`.
- **M4 people:** `auth team invitations` to `people/<same>`.
- **M5 venues:** `venues sites packages payment-ways` to `venues/<same>`.
- **M6 sales:** `vouchers payments devices sessions` to `sales/<same>`; `messaging` to `sales/sms`.
- **M7 guest and analytics:** `guest` to `guest/sign-in`; `portal brand` to `guest/<same>`;
  `analytics` stays, alone. `utils/` and `services/` are empty and gone.
- **M8 types:** `packages/types/src/index.ts` into one file per area, `index.ts` exporting them as
  the package's entry (consumers keep importing `@hashinet/types`).
- **M9 web:** `components/hearth/` into `components/ui/` (`ui dialog confirm-dialog icons chart
  shell auth-frame always-dark protect`) and `components/<area>/` (`sales/` sell, voucher-actions,
  voucher-card; `platform/` billing, record-payment, service-access, bill-paused, onboarding;
  `venues/` venues, sites, payment-ways; `guest/` portal-editor, logo-picker; `analytics/`
  analytics). Imports use the `@/` alias already configured.
- **M10 router sim:** `tooling/router-sim.ts` into `tooling/router-sim/` by part (the router, the
  guest, the hub, the command line), `package.json`'s `router-sim` script pointing at it.

## Concrete Steps

From the repository root, for each API slice:

```bash
bun ref/restructure/move.ts ref/restructure/m1.txt
bun run verify
bun run test:integration
cd apps/api && JOBS_ENABLED=false bun <scratch>/route-map.ts > map-after.txt && diff map-baseline.txt map-after.txt
```

`route-map.ts` boots the app (port 0, jobs off) and prints every HTTP route and every module's
providers and controllers, sorted; module and provider names are class names, so the listing is
independent of file paths. Baseline (2026-11-28, `e9abcac`): 134 routes, 134 providers, 34
controllers.

## Validation And Acceptance

Each slice: `bun run verify` passes; `bun run test:integration` passes (run alone when the machine is
loaded: the 5-second timeouts flake under load, not the moves); the route and module map is
identical to the baseline; `git grep` finds no path under `apps/api/src` that names the old location.
After M2: the router sim's `guest-test` passes once. After M8: the package's declarations are byte-identical and its exported names unchanged (TypeScript
7 emits no declarations through a JS API, so this replaces the emitted-declarations diff). After M9: `next build`'s route list is identical. The release after the merge is the last
proof: the same live checks as any release.

## Idempotence And Recovery

A slice is one commit; `git reset --hard HEAD~1` on the branch undoes a bad one. The move tool
refuses to run if a destination exists, so it can't half-apply twice. `main` is untouched until the
whole plan (or a finished prefix of it) is merged with `--ff-only`.

## Artifacts And Notes

Import-graph test (2026-11-28): with this grouping, 437 of 554 cross-folder imports cross area
lines, of which about 340 point down into `core/`.

## Interfaces And Dependencies

No interface changes: routes, providers, the database, `@hashinet/types`' public names and the web's
pages are the same before and after.
