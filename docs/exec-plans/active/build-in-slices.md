# Ship HashiNet in seven lovable slices

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
protects their sign-in, has a router set up, and sells vouchers at the counter of three venues, each
made at its sale (ADR-0017), with a business manager, a venue manager and an operator; HashiNet invoices the business monthly and records its
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
  - [x] (2026-11-13) (i) finish-work on the branch: review, security, simplify, the journey-level
    design audit (18/20), docs and CHANGELOG. Integration 137/137.
  - [x] (2026-11-14) (j) Production reset (Concrete Steps), released (`84422b4`, run 43392223246),
    and accepted live: Paul's home's package agreed and its setup scheduled, its router (the CHR sim,
    tunnel up) set up from its page, and a guest online through it, which closed the setup.
- [ ] Slice 3: onboarding a business (before slice 2: owner, 13 November 2026). Built on the local branch
  `slice-3`. Steps, each ending with `bun run verify` and the integration tests passing, and a commit:
  - [x] (2026-11-13) (a) Platform roles by invitation (business-scopes M3), `apps/api/src/team/`:
    `GET /api/team` (people and pending invitations, what the reader may assign, who they may manage),
    invite, resend, revoke, change a role and remove, all by rank (`access/rank.ts`: the admin gives
    manager and operator, a manager only operator; nobody acts on their own rank or above, or on
    themselves). Accepting (`POST /api/invitations/accept/member`) asks only a name, creates or finds
    the person and gives their one platform membership (back, if removed earlier); removing signs them
    out. The business invitation routes now act only on invitations to start a business, so a
    manager can't reach a manager's invitation through them. The invitation page takes a team
    invitation. Tests: `team.integration.test.ts`. Verify passes; integration 141/141.
  - [x] (2026-11-13) (b) Issues (ADR-0011, 11; redesign-admin's Issues decisions), `apps/api/src/issues/`:
    one model (`issues`, `issue_events`) kept per workspace (the platform's, or one business's, read
    within a venue role's venues), at most one open issue per key there. A job every minute keeps
    router issues in step: a router that has served and is offline or in error opens one in both
    workspaces; serving again resolves both. `open` and `resolve` are for the journeys that own the
    other kinds; (c) opens a venue's package and setup issues. Claim, Release, Hand to (someone in the
    workspace who can work on it), Take over (only above the holder, with a reason), and a note, which
    claims an unheld issue first; a resolved issue keeps its page and takes no more steps. A held
    issue with no step for a day is stalled. Tests: `issues.integration.test.ts`. Verify passes;
    integration 144/144.
  - [x] (2026-11-13) (c) Onboarding (API), `apps/api/src/onboarding/`: a row per venue
    (`venue_onboardings`) and its stage, decided by `onboardingStage` (choose, confirm, pay,
    schedule, add-router, set-up, first-guest, done). Every new venue, from an accepted invitation or
    Add a venue, starts with its package issue. The owner or a business manager sends a preference
    (Connect, Install, Launch, or talk first) until the package is agreed; the platform's admin and
    managers confirm the package as lines on HashiNet's bill (one onboarding fee agreed for the business,
    the MikroTik router for Install and Launch, the line or fibre, an ISP router, anything else; the
    plan sets the starting lines, `ONBOARDING_STARTING_LINES`; a total of 0 is nothing to charge) and
    notes, record the payment by hand in full (cash, mobile money or bank transfer), and schedule the setup day, which
    resolves the package issue and opens the setup issue for the whole team, held by whoever goes. A
    job closes the setup when the first guest is online at a serving router. A router is added only
    to a venue whose setup is scheduled, and no venue serves a guest until the business's owner has
    protected their sign-in (the portal's context, redeeming and buying refuse with `NOT_OPEN`).
    Steps go on the issue's log as structured data (`IssueEventData`) the web words. Existing venues
    are backfilled: with a router, done; without, at their package. Tests:
    `onboarding.integration.test.ts`, `onboarding-stage.test.ts`. Verify passes; integration 149/149.
  - [x] (2026-11-13) (d) Counts-only reach into a business's guests for HashiNet's team (ADR-0014, 1):
    `GET /api/guest-counts` (`guest.count`, the whole platform team) gives each venue's devices online
    now and mid-session (on a session at a router that is down), and nothing else. The platform
    already reaches no guest list (sessions, devices, vouchers are `BUSINESS_ALL`; the live socket
    sends hotspot updates only to `session.read`; analytics returns totals). Tests:
    `guest-counts.integration.test.ts`. Verify passes; integration 150/150.
  - [x] (2026-11-13) (e) The screens, against the prototype, each audited as it is built: Issues (open
    count in the menu) and an issue's page (Claim, Hand to, Release, Take over, notes, history; a
    venue's package confirmed line by line, its payment, its setup scheduled for whoever goes; the
    setup's steps; a router issue's checks); Businesses and a business's page (`GET
    /api/businesses/:id`: its owner, open issues, venues with their stage and guest counts, owners
    and managers); the platform's Venues and Routers; Team for platform roles; the owner's
    getting-started overview; Help's slice 3 guides. The platform's menu groups Manage and Platform
    as the prototype does; operators keep a flat list. Walked as the admin, a manager, an operator
    and owners at 1280 and 375, light and dark: no overflow and every text at AA contrast, measured.
    Prices are hidden from operators on the page (the API still serves them to the platform).
  - [x] (2026-11-13) (f) Leftovers of slice 1's stand-ins removed: the owner's "team is setting up
    your router" panel (now getting started), the Businesses rows' router links (rows open the
    business), and the platform's home, which is Issues, its worklist, in place of Businesses.
  - [x] (2026-11-13) (g) finish-work on the branch:
    - **Code review**, fixed:
      - claims made exclusive;
      - a removed router's issues closed;
      - a removed person's issues given back;
      - a race to open an issue no longer stops the sync;
      - operators able to install from the router page;
      - seeded venues begin their onboarding;
      - absence is `null`.
    - **Security review:** no findings.
    - **Simplify:**
      - the API serves who may act;
      - one handed rule;
      - operators get no prices;
      - count route, set-based syncs, an index;
      - guest counts on the businesses list;
      - shared helpers.
    - **Design audit:** 19/20; a row is its one link.
    - **Docs:** a setup stalls by its date (ADR-0011, 11); docs, CHANGELOG, technical debt and
      the handbook updated.
    - Verify passes; integration 153/153.
  - [x] (2026-11-14) (h) Released (`888b6da`, run 43463945212), then `3354c54` (a router's hotspot
    port; the ISP router's address in its setup script) and `6698aaf` (Set up replaces portal pages
    left by an earlier install). Accepted live with Paul's home as the business: its package
    confirmed, its setup scheduled, its router set up, its first guest online, the setup issue
    closed. Asha inviting a fresh test business is left for slice 5's second venue, which walks the
    same journey.
- [ ] Slice 2: the counter, where a voucher exists only by its sale (ADR-0017). Built on the local
  branch `slice-2` against the prototype (`#musa-overview` then Sell; `#neema-vouchers`;
  `#neema-venue-v1`). Steps, each ending with `bun run verify` and the integration tests passing, and
  a commit:
  - [x] (2026-11-14) (a) The audit rows' venue and business (Surprises): `AuditEvent` requires both,
    so every call says whose event it is; `AuditLog.atVenue` gives a venue's business for events
    about a venue's routers, sessions, sales and vouchers; HashiNet's team acting on a business's
    router lands in that business's and venue's Audit log. Devices belong to the business that acted
    until (f) makes them per business. Test: `routers.integration.test.ts`. Verify passes;
    integration 155/155.
  - [x] (2026-11-14) (b) Business roles by invitation (business-scopes M3): `api/team` serves the
    reader's workspace, HashiNet's or their business's. The owner invites a business manager, a
    venue manager or an operator; a business manager the two venue roles; a venue manager only
    operators, only to their own venues, and reaches only the people there. A venue role needs at
    least one of the business's venues and nothing else has any; changing a role moves its venues.
    Accepting (`accept/member`) joins the business with the invitation's venues; the preview names
    the business. Venue-only packages moved to slice 5 (Decision Log). Tests:
    `team.integration.test.ts`. Verify passes; integration 159/159.
  - [x] (2026-11-14) (c) A voucher only by its sale: batches, Print vouchers and revoking are gone
    (their routes, `VoucherBatch`, the batch column, their types, tests and the web's print page).
    `POST /api/sales` sells one voucher with the money in hand and needs no payment provider; the
    package sets the price; mobile money needs the guest's mobile money number, cash takes one
    optionally; the voucher and its paid sale are one transaction, naming who sold it. Revenue is
    paid payments alone (`revenue_events`), as every voucher now has its sale. Migration
    `20261114100000_voucher_only_by_sale`: `revoked` became `refunded`, `revoked_at` `refunded_at`,
    and the batch table and column were dropped (test data only: its vouchers stay). The web shows
    the sale-model states and no Print vouchers; Sell comes with (g). Tests:
    `vouchers.integration.test.ts`, `without-providers.integration.test.ts` (was printed-launch),
    the analytics and packages tests rewritten on sales. Verify passes; integration 157/157.
  - [x] (2026-11-14) (d) Payment details (ADR-0017, 4), `apps/api/src/payment-details/`: up to three
    ways per venue, in order (paid through, number in digits, name), in `venue_payment_ways`
    (migration `20261114144947_venue_payment_ways`, a CHECK on the three). `GET` and `PUT
    /api/venues/:id/payment-details`: whoever sells there reads them (`payment_details.read`); its
    owner and managers replace the list in one transaction (`payment_details.update`), a venue
    manager only at their venues; audited with the venue and its business. Tests:
    `payment-details.integration.test.ts`. Verify passes; integration 160/160.
  - [x] (2026-11-14) (e) Refunds (ADR-0017, 7 and 8): `POST /api/vouchers/:id/refund`
    (`voucher.refund`, owners and managers) gives a voucher's full sale back while it is unused, by
    cash or by mobile money with the guest's number and the reference; once (a conditional update),
    with an optional reason. The voucher becomes `refunded` and leaves its routers. A `refunds` row
    (migration `..._refunds`, CHECKs on the amount and on mobile money's number and reference) is
    the refund's own line: `revenue_events` counts it as minus its amount on its day, so every sum
    is net and counts of vouchers sold count sales only. Today adds the day's refunds and the
    reader's own cash to hand over (their cash sales less the cash they gave back); Payments lists
    a refund as its own row. Tests: `refunds.integration.test.ts`. Verify passes; integration 162/162.
  - [x] (2026-11-14) (f) `POST /api/vouchers/:id/release` (`voucher.release`, whoever is at the
    counter): a voucher in use loses its devices and their sessions, so the guest's new phone signs
    in with the code; its time runs on; audited. Blocking is per business: `device_blocks` (migration
    `..._device_blocks_per_business`, which moved each earlier block to the businesses where the
    device was seen, then dropped `devices.status`); the portal, the routers' sync and the device
    list read the venue's or reader's business, and a block ends sessions at that business's venues
    only. Ending a session was already there. The switch PIN is slice 7. Tests:
    `devices-sessions.integration.test.ts`, the guest and payments block tests. Verify passes;
    integration 164/164.
  - [x] (2026-11-18) (g) The screens, each built with design-build and audited at 390, 768 and
    1440, light and dark: Sell a voucher (package rows, the centred check with Paid by and Pay to,
    Confirm sale and Change package, Voucher sold with Sell another, Send, Print), answering at once
    while the router is told in the background, from a Sell tab on the phone's tab bar; the
    operator's Today with their sales and cash to hand over; Vouchers with Refund and Release; the
    venue's Payment details; Payments with Sold by and refunds as their own rows; Live sessions,
    soonest to end first, found by device, MAC address or a voucher's digits, with End session;
    Devices with Block, Unblock and Remove; Team and invitations for business roles; the Audit log
    filtered by who, venue, action and business day, naming targets only within the row's
    business; Help for every business role. The API gained what the screens needed: sessions
    `order=ending`, `voucherExpiresAt` and code search; payments received `by=me` and `day`; the
    audit log's filters and names. Removing a device forgets it for the remover's business alone
    (Decision Log). Walked in the browser as the owner and an operator invited through Team: sold
    by cash and mobile money, refunded, released, ended a session, blocked, unblocked and removed
    devices, filtered the Audit log. A sweep of 16 routes at the three widths in both themes found
    no overflow, unnamed control, small target or contrast failure. Verify passes; integration
    167/167.
  - [x] (2026-11-18) (h) finish-work on the branch. The code review found ten, eight fixed with
    tests (a removed device's block lifted on the routers; a refunded voucher never pushed back; a
    venue manager's Team and Audit log; one list-item mapping; the failure count reset without a
    query); two skipped (blocks copied by the per-business migration: production had one business;
    printed-batch revenue: test data, ADR-0017). The security review found one, fixed with a test:
    inviting no longer revokes a pending invitation the inviter couldn't revoke. PRODUCT.md, the
    README, AGENTS.md, DESIGN.md, SECURITY.md, ARCHITECTURE.md, four ADRs, the runbooks and the
    CHANGELOG say the sale model; the handbook follows the release. Verify passes; integration
    170/170.
  - [ ] (i) Release and live acceptance: Paul's home invites an operator, who sells a voucher by
    mobile money reading out the venue's Lipa namba; the guest gets online with it; the owner
    refunds an unused one and sees both in Payments.
  - [x] (2026-11-24) (j) Outages: a router with no internet, and the time given back (owner, 18 and 19
    November; prototype approved: `#juma-overview~nointernet`, `#musa-overview~nointernet`,
    `#juma-issue-r3`, `#juma-guest-givenback`, `#juma-guest-nointernet`). On a local branch:
    1. **The router's own internet.** The live monitor, which already connects to each online
       router every poll, pings from the router (`/ping` to 8.8.8.8 and 1.1.1.1, as readiness
       does) and records `internet_ok` and `internet_checked_at` on the router. Two failed polls in
       a row mark it down, one good one marks it up, so one lost ping doesn't flap it. A router
       that answers with no internet has the condition "No internet" (`RouterCondition`), opens a
       router issue like offline, does not serve (`SERVING` adds `internet_ok`), and pauses selling
       with its own reason (`VenueSelling` "no-internet"). The guest portal's context says so, and
       the portal shows "This WiFi has no internet right now" instead of taking a code.
    2. **Outages.** A table `router_outages` (router, kind offline or no internet, started at,
       ended at, given back at). The monitor opens one when a set-up router stops serving
       (unreachable, failing, or no internet) and closes it when it serves again with its internet
       working; one open outage per router (a partial unique index). The time an outage starts is
       when the router was last seen serving.
    3. **Time given back.** When an outage closes, every paid voucher whose time ran during it at
       that router (a session there open at its start, or opened during it) is given the overlap
       of the outage with its time, never more than it had left when the outage began, from when
       it can be used again: its `expires_at` becomes the later of its end and the outage's, plus
       that much (a voucher that would have ended 20 minutes into the outage gets its 20 minutes
       after it), a voucher expired during the outage goes back to active, and the router's hotspot
       user gets the same added to its `limit-uptime` (RouterOS counts a logged-in user's time,
       which runs while the internet is down; `given_back_minutes` keeps it on every push). Once
       per outage (`given_back_at`, conditional update), audited as a system event with the count,
       and logged on the router issue ("Gave 3 guests their time back: …"). A router issue records
       what took the router down (`issues.cause`), so it reads "had no internet" after it closes.
       The portal's "You're online" page says how much was added back; the router's own status
       page already follows the voucher's end from the API, so it is left as it is (changing it
       would mean setting every router up again).
    4. **Screens,** from the prototype: the router's status and issue title say "No internet"; the
       paused-Sell dialog's third reason with what to check; the guest portal's two pages.
    5. **Tests:** integration for the internet hysteresis, outage open and close, the give-back
       rule (20 minutes left gives at most 20; a week gives the whole outage; an expired voucher
       comes back; once per outage) and the paused reason; `guest-test` on the router sim cuts the
       router's uplink (`/ip route disable`) and checks No internet, the pause, and the time given
       back once the route is enabled again.
    Built: integration 175/175 (`outages.integration.test.ts`); `guest-test` on the router sim 20/20,
    its uplink cut and restored: "No internet" within two polls, the portal saying so, the outage
    closed and the online guest given 2 minutes back. Three things the sim run found: the tracker
    ran on its own minute and missed an outage shorter than that, so it runs right after each
    monitor poll and health check; the sim's `setup` didn't record its result as the API does
    (`storedSetup`, now shared), so HashiNet didn't count the sim router as set up; and `guest-test`
    didn't migrate the sim database first.
  - [x] (2026-11-25) (k) The portal for every guest, and a QR code that joins the WiFi (owner, 24 and 25 November
    2026; prototype approved 25 November). The voucher's QR code is the venue's WiFi
    (`WIFI:T:nopass;S:<name>;;`): a phone's camera offers to join, the phone opens the sign-in
    page by itself, and the guest types the code printed beside it. Typing a code is easy; finding
    the right WiFi is what the QR code saves. So the portal has no scanner: its Scan, Camera blocked
    and Scan with your camera pages go, and so does the page a QR link opened outside the WiFi, with
    its Continue. Every guest sees the plans: where the business takes payments online, the buy
    page as it is; otherwise the buy page lists the plans and prices, says where to buy in person
    and shows a number to call, if the venue gives one. It never shows a number to pay ahead: a
    sale is recorded as it happens, online or at the counter (ADR-0017). The voucher page's button
    is Connect (the phone has already joined); "No voucher?" leads to the plans.
    - API: the brand's `voucher_help` becomes `where_to_buy`, with `contact_phone` (optional), on
      the default and on a venue's brand; `GuestContext.settings` carries both. A venue record
      carries its WiFi name (`wifiName`: its router's SSID, else the venue's name), so the sell
      dialog and the card no longer look it up.
    - Web: the portal as the prototype; the card's and the sell dialog's QR code and wording ("Scan
      to join <name>, then enter the code"); the text a seller sends names the WiFi and the code.
      Setting where to buy and the number is the Portal design page of slice 5; until then the
      portal says "Buy a voucher in person at <venue>."
    Built: integration 176/176 (a venue's where to buy and number, the number a mobile number or
    nothing); unit tests for the WiFi QR code's escaping and the venue's WiFi name. Walked at 390 on
    the dev portal: Connect, the plans with no radio buttons, where to buy and Call
    (`tel:+255…`), and the sell dialog's QR code and wording. An in-sentence link's default button
    padding left a gap before its full stop on every portal page; `.g-link` has none.
  - [ ] (l) Guest WiFi that protects guests with no password (owner, 25 November 2026). A guest
    network has no password; it is encrypted where the phone can be. Built in two stages, the first
    because the WiFi QR codes now printed say `nopass`, and a board that ships with a password
    would refuse them.
    - Stage 1, the open radio (built 25 November 2026): `hotspot-radio-open`, non-critical, after
      the SSID. On the wifi package it empties `security.authentication-types` on the guest radio
      itself, which wins over any profile (MikroTik's documented priority), so a profile the
      owner's own WiFi (a second radio) shares is never touched; on legacy wireless it gives the
      guest radio setup's own `wbs-open` profile (`mode=none`) and never changes `default`. Verify
      warns when the guest WiFi may still ask for a password. Unit tests for both stacks; the router
      sim (no radio) sets up and verifies as before, the new check skipped. Open on hardware: what
      a real board reports for an emptied `security.authentication-types` (if it omits the key,
      the step stays "not done" and verify warns), and whether a factory password comes from the
      interface or a profile. Make the step critical once a board has shown it.
    - Stage 2, OWE transition mode (waits for a router with a radio): the guest radio and a hidden
      OWE twin with the same name (`authentication-types=owe`, `owe-transition-interface` each
      way) under a guest bridge (`wbs-guest`) that the hotspot runs on, so a phone that supports
      Enhanced Open joins encrypted and an older one joins open, and both reach the portal. It
      separates the radio from where the hotspot runs: the radio steps and `verify` read the radio,
      the addressing reads the bridge, and the unbridge step leaves the guest bridge alone, or it
      and the bridge step undo each other on every run. The twin joins the bridge before the base
      radio names it, and the base radio drops it if anything after fails, so no phone joins a twin
      with no portal. Legacy wireless has no OWE and stays open, and the router's page says its
      guests' traffic is not encrypted. Accepted on a real router: an iPhone and an Android join,
      one over OWE, and both see the portal; the sim must still pass `guest-test` 20/20.
- [ ] Slice 4: getting paid. Started 26 November 2026, with slice 2's router checks still open (owner:
  start slice 4, 26 November). Built on the local branch `slice-4`; the prototype's Payments, a
  business's bill, an invoice, the owner's Billing and Fees (approved 12 November).
  - [x] (2026-11-26) (a) Fee terms. The platform's fee terms (5%, 2.5% above TSh 2,000,000 a venue's month, a
    TSh 5,000 minimum a venue) and HashiNet's payment details (a mobile money business number, a bank
    account), on Fees: the platform admin edits, managers read. Each business keeps its own copy of
    the fee terms, made when it is added; a change applies to businesses added after it. The
    migration gives every existing business today's terms.
    Built: a business's terms are four columns on it (`fee_*`, defaulting to today's figures, so
    the migration and any business made outside an invitation get them); `billing_settings` is
    one row (checked), absent until the admin saves; `GET`/`PUT /api/billing/settings`
    (`fees.read` admin and managers, `fees.update` the admin), audited with only what changed.
    Accepting a business invitation copies the platform's terms. Fees in the platform's Settings,
    with "Where businesses pay" added to the prototype first. Integration 178/178.
  - [x] (2026-11-26) (b) Invoices. One definition of a venue's net sales in a Dar es Salaam month (vouchers sold,
    less refunds made that month, as Payments counts them). The fee per venue: marginal bands, never
    below zero; the minimum from the first full month after the venue's setup, prorated by the share
    of the month a router served it (outages, `router_outages`; before outages were recorded a router
    counts as serving), raising the fee only when it falls short. On the 1st, in Dar es Salaam, a job
    issues each business's invoice for the month before: one line per venue, its net sales and fee,
    stored as issued and never recomputed; at most one per business and month (unique, conditional);
    numbered from a sequence (`INV-2026-11-0001`); due on the 7th; emailed to the owner. Confirming a
    venue's package with a charge issues its onboarding invoice, one line per package line, due 7
    days later, and emails it. A month with no fee issues nothing.
    Built: `billing/fee.ts` (the bands, the prorated minimum, the share of a month a venue was served,
    with unit tests from ADR-0013's figures); `invoices` and `invoice_lines` (unique business and
    month, one onboarding invoice a venue, numbers from `invoice_number_seq`); net sales from
    `REVENUE_EVENTS`, the one revenue definition; an hourly job issuing last month's invoices from
    November 2026 (`BILLING_STARTS`), and any onboarding invoice a crash left behind; the onboarding
    invoice issued once a confirmation commits, updated while unpaid if the package changes, removed
    if it becomes free; `GET /api/billing/invoices` and `/:id` (`billing.read`: the platform's admin
    and managers naming a business, the owner their own). Integration 182/182, including a sale at
    00:30 on 1 December in Dar es Salaam falling in December, and a refund counted in the month it
    was made.
  - [x] (2026-11-26) (c) Payments. Recording a payment (amount received, date, mobile money, bank transfer or
    cash, an optional reference) by the platform admin or a manager, never above what is owed:
    recorded on a business it settles the oldest invoice first; recorded on an invoice, or on the
    setup issue for its onboarding charge, it settles that invoice. Allocations per invoice, so a
    part payment leaves the rest due; an invoice is Due, Part paid, Paid, or Overdue after its due
    date whatever came in. Remind emails the owner what is due (audited); the owner is also reminded
    by email on a due date left unpaid. The setup issue's pay step reads its invoice, and slice 3's
    by-hand payment (`venue_onboardings.paid_*`, `POST …/onboarding/payment`) goes: a package paid by
    hand becomes its invoice and the payment that settled it, as it was recorded.
    Built: `bill_payments` and `bill_allocations` (positive amounts, checked); `POST
    /api/billing/payments` (`billing.record`, the platform's admin and managers), which locks the
    business row so two payments can't settle the same amount, refuses more than is owed and a date
    in the future, and is audited with the invoices it settled; `POST /api/billing/reminders`
    (`billing.remind`), audited; the hourly job reminds on a due date left unpaid, once
    (`invoices.due_reminded_at`). A venue's stage reads its onboarding invoice; the package changes
    only while nothing is paid on it; the package issue logs "Paid in full" when the last of it
    comes. The migration carries each package paid by hand into its invoice and payment, then drops
    `venue_onboardings.paid_*` and `onboarding_paid_by`; `onboarding.pay` stays in the audit
    actions for the rows already logged. The shared Record payment dialog (prototype `payForm`)
    is on the setup issue. Integration 186/186.
  - [x] (2026-11-26) (d) Screens. The platform's Payments (every business for a month, a quarter, a year or a
    range: sales, rate, billed, paid, due, status; Record payment and Remind on each), a business's
    bill and an invoice, the owner's Billing (their terms, what is due, how to pay, their invoices)
    and its issue when a bill is due or overdue, Fees.
    Built: `GET /api/billing/account` (a business's account: owner, terms, where to pay, paid, due,
    overdue, what is owed oldest first, its invoices) and `GET /api/billing/overview` (every
    business for a range of months, with the months there are and the day the month in progress
    is invoiced; `billing.overview`, the platform's admin and managers); `GET /api/billing/invoices`
    gave way to the account. Pages: `/billing` (the platform's Payments, or the owner's Billing),
    `/billing/[businessId]`, `/billing/invoices/[id]`; Record payment and Remind in the shared
    dialog; Payments and Billing in the menus. The owner's bill is an issue (`bill_due`, in the
    business's workspace, its cause due or overdue), seen by the owner alone, never claimed or
    noted, opened and resolved by billing (on issuing, on each payment, and hourly). Its title in a
    list says only due or overdue; its page says the amounts. Walked at 1440 and 390 as Paul
    (Payments, a bill, an invoice with a part payment) and Zuhura (Billing, the bill issue).
    Integration 188/188.
  - Review of (a) to (d), 26 November 2026: a code review found a month re-priced hourly all month
    (a business that owed nothing on the 1st invoiced later, overdue at once), a package changed
    while a payment landed on its old invoice, the minimum charged to closed businesses and venues
    out of service, a row's Record payment offering only the period's due while settling the
    oldest first, one-off charges counted in periods before they were issued, a lower rate allowed
    above the fee, and the by-hand migration dropping an overpayment silently. Each is fixed with a
    test that fails before it (`invoice_runs`; the package's invoice synced inside its confirmation
    under the business lock; the migration stops on an overpayment). The security review found
    nothing crossing a boundary. Simplify: one owner mailer, invoice summary and oldest-first
    order; the month helpers beside the business day's; the invoice page in one request; the API's
    default month, effective rate and collected share; a per-kind issue table. Integration 192/192.
  - [ ] (e) Invoice PDFs: Download PDF on each invoice (owner, 26 November: an additional step).
  - [ ] (f) Extra-site slots: a venue's second and further open sites, TSh 10,000 each, once,
    invoiced when added; the site opens once paid (owner, 26 November: an additional step).
  Accepted live: Paul's home's first monthly invoice is issued on 1 December (its router not yet
  serving, so 5% of its net sales and no minimum); Asha records its payment; the owner sees it paid.
  An onboarding charge can be confirmed, invoiced and paid live before then.
- [ ] Slice 5: many venues.
- [ ] Slice 6: online (held until the providers' credentials exist).
- [ ] Slice 7: one voucher, devices online at once, through RADIUS (ADR-0015), with its switch PIN.

Each slice records, separately: implemented and `bun run verify` passing locally; published (pushed,
CI green); deployed (Dokploy running the new image); accepted live (the slice's acceptance, done on
`hashinet.hashikome.com`).

## Surprises & Discoveries

- Observation: the API has no signal for "installed at the venue" apart from the router reaching
  HashiNet, which an office setup also does. The owner settled it: where the setup happens makes no
  difference, so a setup's steps are add the router, set it up, and the first guest.
- Observation: Better Auth runs its `after` hooks for failed calls too, with the error as the result,
  so the first-enrollment upgrade in (c) turned an email-code session into an "authenticator" one on
  a wrong code: a way past the protection rule.
  Evidence: `better-auth/dist/api/dispatch.mjs` (`runAfterHooks` after an `APIError`); fixed in (g)
  part 1 with a regression test ("a failed authenticator check never upgrades an email-code session").
- Observation: the first build's form floor of TSh 1,000 on package prices survived into the API and
  refused the approved default hour of TSh 500; voucher codes still had the old prefix form that
  ADR-0008 had replaced with 12 digits.
  Evidence: `package-input.ts`, `voucher-codes.ts` before (g).
- Observation: most audit events record neither the venue nor, when HashiNet's team acts on a
  business, the business: `record` defaults `businessId` to the actor's and services seldom pass
  `venueId`, so a venue manager's or an owner's scoped Audit log would miss them. To fix with the
  Audit log screen in slice 2, before any data is kept (nothing is deployed yet).
  Evidence: `apps/api/src/audit/audit-log.ts`, finish-work's code review of slice 1.
- Observation: every guarded request reads the session row again after Better Auth has, and counts
  passkeys even when that cannot change the access level; `/api/me` then re-reads what the guard
  read. Left for a later pass: correct, only slower.
  Evidence: `apps/api/src/access/principal-from-session.ts`, finish-work's reviews of slice 1.
- Observation: Better Auth's own recovery codes mix cases and use 0, O, 1, I and l, hard to copy off
  paper.
  Evidence: `better-auth/dist/plugins/two-factor/backup-codes`.

## Decision Log

- Decision: a venue's package is itemized, all on HashiNet's bill: an onboarding fee agreed per
  business for whatever its onboarding takes, plus a line for each thing the plan brings (ADR-0013,
  2, widened). Rationale: an owner sees why the total is what it is; HashiNet deals with the partner
  sellers so the business pays one bill. Date/Author: 2026-11-13 / owner.

- Decision: platform operators are the technicians who install routers at venues. They see only
  the issues handed to them, never an unhandled one or a venue's package; a handed setup is their
  pass to add its router and run its script and setup (`router.install`, checked against the
  issue). Editing and removing routers stay with the admin and managers (`router.manage`). Release
  and Hand to answer 204, as the issue may leave the reader's sight.
  Rationale: the admin and managers do everything that belongs to them and hand the rollout over.
  Date/Author: 2026-11-13 / owner.

- Decision: in slice 3, a venue's package changes only until it is paid or its setup scheduled; a
  payment is recorded once, in full (ADR-0013, 6). Rationale: payments by hand have no ledger to
  reverse; slice 4's invoices bring corrections. Date/Author: 2026-11-13 / Claude.
- Decision: the 7 days in slice 3 are the owner's setup window that access already enforces
  (ADR-0011, 9); removing a venue left without a router (the prototype's "removed in N days") is
  for added venues, slice 5. Date/Author: 2026-11-13 / Claude.

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

- Decision: in slice 3, a venue package's "get it paid" step is marked paid by hand: HashiNet's admin
  or a manager records that it was paid, with the amount and how, logged on the issue. Slice 4's
  onboarding-charge invoice and Record payment replace it.
  Rationale: invoices are slice 4's; the step still needs a person to say the money came.
  Date/Author: 2026-11-13 / owner.
- Decision: slice 3 (onboarding a business) comes before slice 2 (the counter).
  Rationale: onboarding is the first thing a new owner meets; walking slice 1 live, the owner looked
  for Issues and the getting-started steps, and found slice 1's stand-in. Slice 3 needs nothing of
  slice 2: its team is the platform's, invited in slice 3 itself.
  Date/Author: 2026-11-13 / owner.
- Decision: slice 2 sells a voucher only at its sale (ADR-0017): no printed stock, refunds instead of
  undoing a sale, and the venue's payment details on the sale for mobile money at the counter.
  Rationale: printed stock can be taken, left unsold or sold unrecorded; at a counter the guest pays
  the venue's own number, so a sale by mobile money needs no provider. Designed and walked in the
  prototype first, then approved, so the slice is built without guesses.
  Date/Author: 2026-11-14 / owner.
- Decision: the switch PIN and RADIUS (ADR-0015) become slice 7; slice 2 keeps to the counter.
  Rationale: the PIN rests on HashiNet answering every router login through RADIUS, which nothing
  has built: a RADIUS server reached through the tunnel, router setup changes, the PIN and its
  limits, and a real-phone test. Slice 2 releases a voucher by clearing its devices and sessions,
  which works with today's sign-in.
  Date/Author: 2026-11-14 / owner.
- Decision: a venue sells only while one of its routers is serving guests: set up and online.
  The API refuses a sale otherwise (`VENUE_NOT_SERVING`), and each venue says whether it sells, so
  the web offers Sell only there.
  Rationale: Paul's home had a router record but no router, and its Sell sold a voucher nothing
  could take; a guest pays, cannot get online, and the refund follows ("No network").
  Date/Author: 2026-11-18 / owner.
- Decision: guests get back the paid time an outage took. HashiNet records when each router stops
  serving (unreachable, or reachable with no internet) and when it serves again; once it serves
  again with a working internet line, every paid voucher whose time ran during the outage at that
  router is extended by the time lost, up to the time it had left when the outage began (20 minutes
  left gives back at most 20; a week's voucher that lost two hours gets two hours). Vouchers stay
  wall-clock, not counted by connected time: a voucher that only ran while connected would never
  end for a guest who doesn't come back. Not built yet; it comes with checking each router's own
  internet line, so "no internet" stops sales and counts as an outage.
  Date/Author: 2026-11-18 / owner.
- Decision: API answers are `private, no-cache` with their ETag, so a browser revalidates and gets
  a 304 when nothing changed; only answers carrying voucher codes are `no-store`. A blanket
  `no-store` (e2c2184) made every screen download every answer in full, and the dashboard lagged on
  phones. Showing cached data at once and refreshing it in the background (stale-while-revalidate,
  invalidated after a change) is the next step for the web.
  Date/Author: 2026-11-18 / owner.
- Decision: slice 2's live acceptance is split while there is no physical router: the counter on
  `hashinet.hashikome.com` (selling with payment details, the operator invited, a refund, Payments);
  the guest getting online on the router sim (`guest-test`); and a real phone on a real MikroTik
  recorded as an open check (ADR-0008's Consequences), not slice 2's to close.
  Date/Author: 2026-11-18 / owner.
- Decision: everyone at a business blocks a device their venues have seen, operators included; the
  block stays the business's, at every venue. Removing a device stays with the owner and business
  managers. A router's sync and push failures are audited once per run, with the run's count on the
  router (`failed_syncs`), since the audit log is append-only (ADR-0012).
  Rationale: whoever is at the counter sees a misusing device first; a person misusing one venue's
  WiFi is the same at the business's others, and most businesses have one venue. An unreachable
  router wrote a row per poll (thousands in development), burying what people did.
  Date/Author: 2026-11-18 / owner.
- Decision: removing a device forgets it for the remover's business alone; the device row goes
  only once no business refers to it.
  Rationale: a device is shared by every business that saw it, and its blocks and voucher places
  cascade with it, so deleting the row let one business unblock a device at another's venues and
  unlink their history. Found building the Devices screen in (g); test in
  `devices-sessions.integration.test.ts`.
  Date/Author: 2026-11-18 / Claude.
- Decision: a venue manager's venue-only packages move from slice 2 to slice 5.
  Rationale: they need a package's own venue and a change to the on-sale rule (a venue with no
  assignments sells every active package, so a venue-only package would leak there), with their own
  permission and routes, and they sit on the same screen as prices per venue, which slice 5 builds.
  Slice 2's counter needs neither.
  Date/Author: 2026-11-14 / agent; confirmed by the owner 2026-11-18.

- Decision: the monthly minimum is prorated by the share of the month a router served the venue
  (owner, 26 November 2026): down 10 days of 30, it is TSh 3,333. Outages are recorded from 24
  November 2026; before then a set-up router counts as serving. Rationale: the minimum pays for
  infrastructure in use, and HashiNet records when it was not.
  Date/Author: 2026-11-26 / owner.
- Decision: a payment recorded on a charge settles that charge; one recorded on a business settles
  the oldest invoice first (owner, 26 November 2026). Rationale: paying a new venue's onboarding must
  schedule its setup, not quietly pay an older fee. ADR-0013, 6 is narrowed to match.
  Date/Author: 2026-11-26 / owner.
- Decision: HashiNet's payment details are a platform setting on Fees, edited by the platform admin
  (owner, 26 November 2026); until they are set, Billing says to contact HashiNet.
  Date/Author: 2026-11-26 / owner.

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

**Slice 2, the counter.** For a venue manager and an operator (Daudi, Musa), and the owner.
A voucher exists only by its sale (ADR-0017): no printed stock, no sale recorded by hand, no price
typed. Backend: business-scopes M3's business-role invitations with venues; the audit rows' venue and
business; selling one voucher with the money in hand, by cash or mobile money to the venue's own
number, with no payment provider; the venue's payment details; refunds of unused vouchers; releasing
a voucher to a new device; ending a session; blocking and unblocking a device, per business; live
sessions. Removed: voucher batches, Print vouchers, revoking, and Payments' To confirm.
Screens: Sell a voucher and Voucher sold; the operator's Today (their sales today and the cash to hand
over); Vouchers with Refund and Release; the venue's Payment details; Payments with Sold by; Live
sessions; Devices; Team and Invitations; the Audit log; Help for the venue manager and operator.
Accepted live: Paul's home invites an operator, who sells a voucher by mobile money at the counter;
the guest gets online with it; the owner refunds an unused voucher and sees both in Payments.

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
Backend: monthly invoices (5% of each venue's net sales, its vouchers sold less that month's refunds
(ADR-0017, 9), at least TSh 5,000 a venue, 2.5% above TSh 2,000,000 a month), onboarding and router fees (ADR-0013), recording a payment (oldest invoice
first), reminders, the fees the admin sets for new businesses.
Screens: the platform's Payments, a business's invoices, the owner's Billing with How to pay and its
invoices, Fees (the admin only).
Accepted live: the test business's first invoice is issued; Asha records its payment; the owner sees
it paid.

**Slice 5, many venues.** For an owner of several venues and their team (Neema, Grace, Daudi).
Backend: the business manager role; venue managers over several venues; Add a venue and its
onboarding package; prices per venue; packages a venue manager adds, sold only at their venues
(ADR-0011, 4), which need a package's venue and the on-sale rule to keep them there; captive portal branding (ADR-0009); business-scopes M5 (the
business profile with its logo); analytics computed by the API; the packages CSV export.
Screens: the venue switcher, Venues and a venue's page, Captive portal, General, Analytics (usage
and sales), the business manager's and venue manager's views (H4: every list and form on a phone).
Accepted live: the test business adds a second venue with its own price and portal; its business
manager and venue manager each see what their role allows and nothing else.

**Slice 6, online.** Held until Snippe's and BRIQ's credentials exist (build-hashinet M6).
Self-service purchase on the portal, payouts, SMS credits, and the owner's request for online
payments with the platform's review. Accepted as build-hashinet M6 says, then live with a real payment
and a real message (M8).

**Slice 7, a voucher across a venue's routers.** For every guest and the staff who help them.
Backend: HashiNet answers every hotspot login through RADIUS over the management tunnel, counting a
voucher's devices online at once across the venue's routers; the switch PIN, made at the first
sign-in, shown once and limited; release clears it too; the time left from HashiNet; router setup
asks RADIUS (ADR-0015). Proved on the router sim first, then on real phones.
Accepted live: one code online on one device at a time across two routers; a second phone moves it
only with the PIN; a release at the counter frees it.

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
`hashinet` database forward; its rows are an early test deploy's, kept by nobody. With the owner's
explicit go at that time: take a final backup, drop every object in the `hashinet` database's
`public` schema (keep the schema: the runtime role's default privileges are attached to it), deploy (the release's migrate stack applies the baseline), run the
production bootstrap for the platform admin, then set up `chr-test` and any physical router again so
they regain management. Record each step's time and outcome here.

Slice 1's reset, 13 November 2026 (UTC), with the owner's go:
- 08:15: final backup, `pg_dump -Fc` of `hashinet` on the server (28 tables); deleted afterwards at
  the owner's word, as the early test deploy's data is kept by nobody. The daily off-host backups
  hold it until they age out.
- 08:18: everything in the `public` schema dropped in one transaction (the early test deploy's
  tables, rows and types; nothing kept). The schema itself stayed, because the migrator's default
  privileges that let `hashinet_runtime`, the new API's role, use the tables migrations create are
  attached to it; dropping it would have left the new release unable to read or write.
- 08:18: `main` fast-forwarded to `slice-1` (`84422b4`) and pushed; release run 43392223246 passed
  at 08:24: verify, images, the migration stack applied the five migrations from the baseline, the
  application stack promoted.
- 08:28: `platform:bootstrap` in the API container: the admin (admin@hashikome.com, Paul John) and the
  default packages created; `/api/health/ready` 200.
- 08:44: the runtime role's rights on `_prisma_migrations` revoked by hand, as `allocate-hashinet.sql`
  asks after migrations; migration `20261113180000_runtime_never_edits_history` now does it in every
  release (runbook [rebuild-from-nothing](../../runbooks/rebuild-from-nothing.md)).
- Pending: `chr-test` set up again from the router page, and live acceptance.

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
