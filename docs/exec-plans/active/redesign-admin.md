# Rebuild the admin and captive portal in the Hearth design

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

Every person who signs in sees a screen built for their job, in Hashikome's bonfire brand. An owner
opens the overview and knows in five seconds whether everything is all right and what needs them;
trends live on Analytics. A guest on a cheap phone sees the venue's name and logo, a welcome, one
field and one button. The look is Hearth: mist ground, white panels, midnight ink, ember on the one
action and on live data, Figtree, and the open ring with the ember in its gap.

Observable result: Neema, owner of three venues, sees "Neema Hospitality" at the head of the
sidebar, filters to one venue at the top, switches workspace from the account menu at the foot,
reads today's takings against the same hour last week, and opens Analytics for the week. Musa, an
operator, sees only his venue's day. A guest at Mama Neema Lodge sees the lodge's portal under the
business's logo. design-audit reports no P0 or P1 at 1280 and 375 pixels, light and dark.

The roles and scopes come from [ADR-0011](../../engineering-decisions/0011-platform-and-business-scopes.md)
and are built by [business-scopes.md](business-scopes.md); branding from
[ADR-0009](../../engineering-decisions/0009-venue-branding.md).

## Progress

- [x] (2026-11-01) Audit of the admin (16/40), with findings recorded below.
- [x] (2026-11-01) Setup runs in the background with progress stored on the router; the router page
  holds the journey; the venue form is cut to what is used.
- [x] (2026-11-03) Production test with CHR: a guest VM redeemed a voucher, was let through, and
  showed in Live Sessions.
- [x] (2026-11-03) Design rounds: ten variations, then Hearth with Night Band's portal, then each
  role's view; chosen by the owner.
- [x] (2026-11-04) H1: tokens, the mark and `DESIGN.md` in Hearth.
- [ ] Full prototype reviewed and approved by the owner (`prototypes/hearth-design/prototype/`). No schema or
  screen work starts before this; the finished screens must match it.
- [ ] H2: the shell: grouped navigation from capabilities, scope filter, account menu, business head.
- [ ] H3: the overview as "right now", and the Analytics page, both computed by the API.
- [ ] H4: lists and forms that work on a phone; named actions; the router edit form.
- [ ] H5: the captive portal: night top over a white sheet, the logo fallback, the welcome.
- [ ] H6: the business screens: Team, Packages with a CSV export, Settings, Account and security, Add a business,
  and the platform's Settings (the fees, packages and captive portal every new business starts with).
- [ ] H7: design-audit on the result, findings fixed; `DESIGN.md`, runbooks and CHANGELOG current.

## Surprises & Discoveries

- Observation: every Set up router and Check it's serving click failed, and only a toast said so.
  Evidence: three 400s in 7-23ms in the production logs; `parseInput` turned an absent flag into `{}`.
- Observation: a reset router has no DNS, so a tunnel to a host name never connected.
  Evidence: `failure: dns server failure` on CHR; fixed in `aec19d9`.
- Observation: Cloudflare adds a bot-detection script and a hidden link to any text/html it serves,
  so a router's portal page arrived about 1.1 KB larger than rendered and setup refused it.
  Evidence: 8,057 bytes rendered, 9,171 on the router; `__CF$cv$params` in the body. Guests' pages on
  `hashifi.hashikome.com` get the same treatment, which the walled garden must be checked against.
- Observation: seven venue fields are read only by the form and its serializer.
  Evidence: road, street, ward, district, postal code, latitude and longitude, by search of the code.

- Observation: after a host reboot, `router-sim guest-run` hangs. The guest's shell asks the terminal
  for its cursor position and waits, and a freshly booted guest has `eth0` down.
  Evidence: `ESC[6n` on the console; DHCP answered once `ip link set eth0 up` ran.

## Decision Log

- Decision: Invitations is the platform's page for finding and acting on invitations, not for issuing
  them: hashifi's team and new businesses' owners, with Search, Kind and State filters and
  Resend, Revoke or Invite again. A business has the same page, beside Team and the audit log, for an
  owner their business's and for a manager their venues'. Issuing stays where the grant lives: Invite a business on Businesses, people on Team, always as
  Invite someone; the form decides which roles the inviter can give.
  Date/Author: 2026-11-04, owner.
- Decision: a business's owner has their own Billing page, in the top of the menu beside Payments, kept as simple as a
  way to pay their bills: what is due, their rate, how to pay and every invoice, each opening its own
  page, with no Remind or Record payment. What they have spent on hashifi belongs to their own books. Services holds what an owner opts into from hashifi: SMS credits, where each purchase is an invoice, and Online payments. Managers and
  operators see neither. Both pages are built to hold the place and get their polish in the business
  owner's review; how to pay uses sample numbers until how payments arrive is settled.
- Decision: the platform's Payments page and an owner's Billing follow ADR-0013 (5% of sales, 2.5% above TSh 2M a month per venue, a minimum of TSh 5,000 a
  month per serving venue; onboarding and router charges, and one-time extra site slots).
  Date/Author: 2026-11-04, owner.
- Decision: the logo is the ring alone, with no wordmark; the platform workspace adds a solid
  `PLATFORM` tag beside it; the
  product is written `hashifi` in all copy. The rename of user-facing copy, emails, page titles and
  docs prose ships with H1's remaining work; identifiers (`HashifiMark`, package names) keep their
  code casing.
  Date/Author: 2026-11-04, owner.
- Decision: everything that needs someone lives on one **Issues** page (an issue is anything that needs an action, not only an error), with
  its open count on the nav item. Router issues are derived from router state and close themselves
  only when the router serves and passes its checks; businesses waiting on the team close when their
  venue's first guest gets online. A router that is not installed yet raises no issue. People say
  "I'm on it" (claimed, never assigned: an assignment does not show anyone has seen it). The page is
  one table with Search, Kind and Status (Open by default) filters, each open row with its own
  action. The overview shows one banner: an item's own action when there is one, otherwise "N issues" and a button to the page. Figures are one number with context below, never N/N.
  Date/Author: 2026-11-05, owner.
  A venue being set up is two issues in turn, each a page with its steps down a rail and the
  current step beside it: its package (call and confirm, get it paid, schedule; owner and managers)
  and its setup (add the router, install, set up; the whole team, operators included). The venue is
  linked from the header rather than repeated; setups are listed by date, soonest first.
- Decision: business and venue pages open with a profile column (logo; name with its address under
  it, as a venue reads in a table; when it joined; facts and actions) beside their panels. For a business the facts are its owner, what it has paid hashifi in
  total with what is due now, and its service access; Businesses lists the same total, so the
  biggest customers show at a glance. Amounts are whole shillings (TSh has no cents in use).
- Decision: every email to an owner, from an issue or a reminder, uses one form on the page, sent by the API through Resend, with
  replies to the team's support address; it counts as acting on the issue and stays on its log. No
  mailto links anywhere, sign-in included: Contact support and Send feedback there open the same form,
  which also asks for the sender's email (7 November 2026). The form is one shared component, as Record
  payment is, backed by one API endpoint.
- Decision: email addresses, phone numbers, business and account numbers, payment references and voucher
  codes are information: clicking one copies it. Only a step whose job is to reach someone has an
  explicit Email {name} or Call {name} button; no number is a tel link (7 November 2026).
- Decision: the signed-out forms (Contact support and Send feedback on sign-in and recovery) verify with
  Cloudflare Turnstile, as namestarlit.com's contact forms do: the public site key renders in the form,
  the API checks the token with the secret (a Docker secret) and the request's hostname, and sends with
  Reply-To set to the visitor's validated address. The widget is Cloudflare's own and is not designed
  here: dark theme, flexible size, appearance interaction-only, so most people see nothing and the rare
  one asked to click gets Cloudflare's box above Send. Signed-in forms need no check.
- Decision: someone is responsible for an issue: whoever claims it (Claim, or by acting first), or
  whom Who goes names when scheduling; the holder can Release or Hand to, and only someone above
  them can Take over, with a reason (ADR-0011, 11). While someone else is
  responsible, the steps are theirs: others see them read-only and take over to act, except recording
  a payment, which stays the platform owner's. Each step is recorded with who did it, and a resolved issue names who was responsible and who helped. It stays
  so once it is resolved; Issues shows Started, Completed and Responsible for open and resolved alike. A
  resolved issue keeps its own page at the same address: what happened, in order, with who and when.
- Decision: a venue's sites are their own table on the venue page, each open before paying or
  blocked for everyone, with who added it, when and why; the business edits it, the platform reads
  it. Blocking depends on what the router supports, so the dialect probes for it. An extra site says
  what its slot costs before it is added ("Add and pay TSh 10,000"), then goes straight to its own
  invoice with how to pay, and waits for payment before it opens; while it waits, its row has Pay,
  which opens that invoice. Blocking a site is free (7 November 2026).
- Decision: a router's page follows its state. Setting up, it is the same steps as the business's
  Getting started (add the router and run its script, install, set up, check a phone), each ticking itself. Once
  it has served, a profile card (model and RouterOS, venue, status, internet, hotspot network, added,
  last set up) sits beside its devices, health checks (with the last check and Run checks) and
  history; sales stay with the venue. A venue has no router page until one is added.
  Getting started is the venue's, on the venue page, since a business can have venues serving while
  another is being set up. A business page is the same for every business: its notices link to the
  issue, and its venues table opens each venue. Set up again is
  the card's action and opens the same setup steps for this router: a reset or replaced router runs a
  new script from step 1, which stops the old one; one that still reaches hashifi skips to Set up.
  Cancel leaves the router as it was.
  Date/Author: 2026-11-05, owner.
- Decision: the platform has no Live sessions and no device lists. hashifi runs no router and serves
  no guests; it keeps only counts, and a business sees its own devices. What is the platform's and what
  is the business's is ADR-0014. The platform's Analytics is about hashifi itself: sales across businesses, the
  fees they bring in (ADR-0013), venues serving, new businesses, and which businesses grow or go
  quiet; busiest hours and what guests buy stay in each business's own Analytics. A business page
  shows its figures, venues today, people, details, the month's billing and its recent activity.
  Date/Author: 2026-11-05, owner.
- Decision: each platform page is scoped by why the team opens it and what it may do there. The
  platform menu is Overview, Issues, Payments, Analytics; Manage: Businesses, Venues, Routers;
  Platform: Team, Invitations, Audit log; Settings: Fees, Packages, Captive portal (themes, layout and messages; a venue takes the platform's theme choices and default layout, and its business can choose its own). Venues is a list to find any venue across businesses, like
  Routers; venues stay read-only for the platform (ADR-0014). A business page holds one table, its
  venues, beside its profile card (with Change service access and Archive). A venue page shows its
  router, its sales, then its sites with Load more, or Getting started while it is set up. Lists end in
  Load more. Every page keeps to one job, and profile cards carry no audit link: the Audit log page filters by business, venue,
  action and date, and only issue pages keep their own log. Payments, on the platform, is one page for tracking every business's bills:
  a summary (billed, paid, due, overdue), filters for By (month, quarter, year, custom months) with
  the named period, status and search, and on each bill Remind (an email form to its owner, sent through Resend with the invoice; no SMS) and
  Record payment (an amount, date, method and reference, settling the oldest bill first; a part payment
  leaves the rest due); each row opens that business's bills, one list of
  issued invoices (a month of fees or a venue's onboarding charge); the month in progress is not one
  until it closes. A row opens that invoice's own page, as a business opens a venue: its lines, total,
  payments and what is due, with a Download PDF link. Everything shows once.
  Each business has one row: its fees for the period plus its onboarding charges, which stay on the
  row until paid. An invoice shows its issued date and due date: a month of fees is issued on the 1st
  and due on the 7th, and an onboarding charge is issued when its package is confirmed and due 7 days
  later, going overdue like any other; the setup is scheduled once it is paid. Remind and Record payment act on the business, on the row and on its bills page, and
  a payment settles the oldest invoice first, fees and charges alike. How payments arrive and are matched is still open. Trading figures live in Analytics.
  That page names whole months; Analytics, for the platform and for businesses, follows Superset: Range
  (Last, Current, Custom), its Period, and Show (the units below the period, never its own: day,
  hours; week, days; month, weeks or days; quarter and year, months or weeks), opening on the next unit
  unless it holds a single point, narrowed by the scope filter. The chart's axis spans the whole period and its line stops at now.
  It shows no "on the period before" figures; the line chart carries the comparison.
  Date/Author: 2026-11-05, owner.
- Decision: Analytics is three pages opening under its menu item, sharing one filter and the scope
  filter: Usage first (devices, sessions, data, peak hours, busiest venues), Sales, and for the team
  Reliability (uptime, router drops, failed setups, portal sign-ins). Counts only (ADR-0014); nothing
  else in the menu nests. Needs measuring before it ships: peak hours, sessions and data from router
  accounting; tunnel drops and outage length from the tunnel; portal sign-in attempts and why they fail.
  Date/Author: 2026-11-05, owner.
- Decision: online payments, end to end (7 November 2026). An owner asks from Online payments with a
  one-page form in four sections, each titled on the left with its fields on the right: You first (the
  owner verified once and kept on their account: the sign-in email, already verified; the national ID
  checked by an identity provider, to choose (Snippe uses Veriff, which takes a photo of the ID and a
  selfie; a NIDA database check would need neither); the mobile number by an SMS code), then the business (its type as two cards, one per line, then that type's documents in one column), then where
  payouts go (a bank account first and by default, its bank and account number; or a
  mobile money network, picked from the networks the platform supports, and number, kept only if
  the provider pays out to one, to confirm) and the name on that
  account; its business type and that type's documents, as the payment provider verifies them (a sole
  proprietor, who may be informal: personal TIN and its certificate, and a business licence in their
  own name from the Tausi portal if they have one; a registered company: BRELA number with its Certificate of
  Incorporation, business licence, and TIN with its certificate; only these two: individuals and
  companies; NGOs are added if Hashifi ever serves them); and agreeing to 7.5% a sale and weekly payouts less TSh 1,500. While Hashifi checks,
  the page says "We're checking your details", when they asked and that the owner is emailed once it is on, then what was sent and Change details. The platform's row opens a
  review: what they sent (each certificate to view, and the owner shown as verified), three checks
  (the account is in the business's or owner's name, the documents name the same business, with the TIN
  given); a manager reviews and approves. View on each document opens that
  uploaded file (an image or PDF preview, with Open original), then Turn on, or Ask for changes by email. Once on, the owner sees online sales,
  fees, what waits for payout and when, what was paid out, the latest three payouts with All payouts, a
  table with search, Month and Status filters and Load more, where each payout opens its statement
  like an invoice (the week of online sales and how many vouchers, less 7.5%, less the payout fee, what
  was sent, to which account, with its reference and a PDF). A payout's status is the provider's:
  On its way, Paid, Failed or Reversed; a failed or reversed one says why, tells the owner to check
  their details, and is a platform issue with Retry payout, which shows paid only once confirmed and the payout details with Change, which pauses payouts until the new details are
  checked; the platform sees the same for the business, with Turn off. What the provider requires to
  pay a business out is to confirm with it (ADR-0013, 8); these fields are the expected set.
- Decision: the platform has a Services section too (7 November 2026), beside Settings, for owners and
  managers: Online payments lists the businesses that asked, are on, or used it before (an Off one
  keeps its sales and payouts; one that never asked is not listed), asked first, with its venues,
  online sales this month and last payout, Turn on for one that asked and Turn off for one that is on;
  SMS credits lists the businesses that have bought credits or have a purchase waiting for
  payment (one that never bought is not listed), with credits left, sent this month, how long they last at this month's rate and the last
  purchase, with those waiting for payment and those running low first, and Record payment on an unpaid
  purchase. Each has its figures and a Status filter; prices stay on Fees, and a business's request to
  turn on online payments still raises an issue. Platform operators have neither page.
- Decision: Account and security is one column of three sections (7 November 2026): Profile (name;
  the sign-in email shown, not editable), Sign-in (Passkeys with each one listed, Authenticator app,
  Recovery codes) and Appearance (Theme). Each setting is a row: its name and state on the left, its
  action on the right. Setting up or replacing the authenticator is a dialog over the page: the QR code
  centred, the setup key behind "Unable to scan?", a code to verify, then the recovery codes to save
  (Download, Print, Copy, then "I have saved my recovery codes"). Replacing it, or making new
  codes, opens "Confirm it's you" first: a code from the current app, or "Lost your old phone? Use a
  recovery code" (or the passkey, when there is one). Adding a passkey opens the browser's
  own prompt; nothing of ours.
- Decision: the captive portal settings show the settings on the left and a phone preview on the right
  (below them on a phone); a picker above the phone, grouped by path (voucher, buying, signing in and
  after) with previous and next, chooses which of its 17 pages it shows, and the phone can be tapped
  through too (7 November 2026).
- Decision: General is one Business profile section (7 November 2026): the logo with Replace, the
  business name, then Region (a select) and Area or street apart, as at the invitation; the address
  goes on invoices.
- Decision: Settings is its own section, apart from the person signed in, whose Account and security
  stays in the account menu, and it will grow: General (the business's name, address and logo, for
  owners, replacing Profile), Packages and Captive portal, which managers see for their own venues.
  There is no business Defaults page: Packages has All venues, the default set new venues start with,
  and each venue's own version from the same picker, showing each price as default, its own, not sold
  there or only there. A package keeps its name, time and devices for good, as its vouchers carry them:
  each package of the business, and each venue-only one, has Change price and Remove (which asks
  first), and anything else is a new package. A removed package stops selling; its vouchers keep
  working and its sales stay in the figures (7 November 2026). Captive portal has New venues. Manage is Venues, Routers, Devices for every owner, one venue or several, so an owner can always reach their venue and ask for another; a manager's is Router, Devices.
- Decision: devices connect to a router, not a venue. A venue shows its details, sales, sites, router
  and captive portal, with no device counts; the router page shows the count and links to Devices,
  scoped to it. The platform sees the count only, so it has no link (ADR-0014).
  Date/Author: 2026-11-06, owner.
- Decision: Issues is a business's centre too: anything that needs someone becomes an issue, shown on
  the overview as the platform's are, and is worked from its own page. Router issues reach everyone
  with Issues; vouchers running low reach owners and managers; SMS credits running low and bills reach
  owners. They follow the venue in scope: bills and credits belong to the business, so they show only
  with every venue in scope. Each closes itself once dealt with, and every page has Contact support, an
  email form to hashifi that carries the issue and reaches the platform's Issues, where replying closes
  it. An operator sees vouchers running low on Today. A venue's issues can be claimed and handed between
  owners and managers, a bill or credits stay the owner's, and someone working alone sees no Responsible
  column. There
  are no alert panels on the overview.
  Date/Author: 2026-11-06, owner.
- Decision: the API builds every voucher sheet and invoice as a PDF, and the browser only shows or
  downloads it. No QZ Tray: operators work on phones and it needs a computer. A counter printer waits for
  the pilot, as a printer that pulls jobs from the server or a tested Bluetooth one, and needs its own
  voucher layout for a narrow roll.
- Decision: a printed voucher is 100 by 46mm, twelve to an A4 sheet. A tear-off stub is the counter's
  record: a running number in bold to count by at the top, price, time and devices in the middle, and the code at the bottom. The whole voucher is white, and it prints in colour or in black and white. The guest's card has the venue's name and no WiFi name: a voucher works on any WiFi at its venue (ADR-0015). It has the venue's name at the left end of the top row and its logo at the right, the price, which is
  largest, what it buys, the WiFi to join, the code, and a QR code centred on the right. The
  QR code signs the guest in once they have joined; they can type the number instead. The logo is optional and changes nothing else: a venue without one, or that
  chooses Hide when printing, gets the same voucher with that end empty. The app's letter tile is never printed.
  Date/Author: 2026-11-06, owner.
- Decision: a venue can hold several MikroTik routers. Venues and overviews read as a count ("2 of 3
  online"), a router's name is its WiFi name, the one guests see in their network list, and nothing is added to
  it. Routers lists every router, Live sessions and Devices gain a Router column where a venue has more
  than one, the menu says Routers for everyone. An owner asks for a router
  (ADR-0013). Voucher codes use JetBrains Mono: the prototype loads it as it loads Figtree, and the
  real app must self-host it in `apps/web/public/fonts` in place of its system stack.
  Date/Author: 2026-11-06, owner.
- Decision: a business's Payments page has the platform's shape: a month's figures, its filters, then a
  table with its actions. It shows payments as they come in, to check them, confirm them and record them.
  Recording a payment and selling a voucher are one step, Sell a voucher (PRODUCT 4.7), from
  Vouchers, Overview, Today and Payments. Past months open by the Month filter; trends live in Sales, and what
  Hashifi charges in Billing.
  Date/Author: 2026-11-06, owner.
- Decision: adding a venue takes its name and location in a popup. The venue then opens on the same Getting
  started steps a new business sees, where the owner chooses how its router comes, so there is one workflow.
  Adding a router is the same journey: its venue in a popup, then the same steps; its WiFi name comes at setup.
  Date/Author: 2026-11-06, owner.
- Decision: guest limits are measured, not assumed. Before "room for N" means anything, stress-test each
  MikroTik model on a real line with its packages' speed limits: add guests in steps (10, 20, 30, 50),
  some browsing and some streaming, and record each one's speed, page load, processor load and whether
  sign-in still works. The limit is where speeds fall below what is promised; until then the number on
  the router page is a sample.
  Date/Author: 2026-11-06, owner.
- Decision: what a business pays hashifi is its own page, not defaults or settings. Payments is always
  money coming in: to an owner what guests pay them, to the platform what businesses pay it, every
  business's charges. Billing is money going out, an owner's view of their own bills.
  Date/Author: 2026-11-04, owner.
- Decision (replaced on 2026-11-03 by the Hearth direction below): keep `accent-ladder`, teal and
  Figtree.
  Rationale then: `DESIGN.md` committed to it, and the audit's problems were structural.
  Date/Author: 2026-11-01 / Claude
- Decision: setup runs in the background, and its state lives on the router row.
  Rationale: Cloudflare ends a request at about 100 seconds, and a result held in a dialog is lost
  on refresh. The API owns the workflow (ADR-0003), so the page only reads it.
  Date/Author: 2026-11-01 / Claude
- Decision: a venue is a name, a region from the closed list of 31, a typed area, its allowed sites and a
  status (superseding one location of 1 and 3 November; `Venue.location` splits as business-scopes plans).
  Rationale: nothing else was used; a town and an address are the same answer to "where". Production
  held only test data, so dropping the columns discarded nothing of value.
  Date/Author: 2026-11-01 and 2026-11-03 / Paul
- Decision: the journey has three stages: connect, set up, serving.
  Rationale: they are what an owner does; the six internal phases show only as progress within
  Set up.
  Date/Author: 2026-11-01 / Claude

- Decision: the Hearth direction: mist ground, white panels, midnight ink, ember on the one action
  and live data, Figtree, the open ring with the ember in its gap; the captive portal's night top
  over a white sheet; a vertical, grouped navigation with a scope filter at the top and the account
  menu, holding the workspaces, at the foot.
  Rationale: chosen by the owner from ten variations and two further rounds (3 November 2026).
  Date/Author: 2026-11-03 / Paul
- Decision: the overview shows what is happening now and what needs attention; trends move to a
  new Analytics page.
  Rationale: the overview was doing the glance and the analysis at once, and repeated Live sessions.
  Date/Author: 2026-11-03 / Paul and Claude

## Outcomes & Retrospective

Not started for H1 to H7.

## Context And Orientation

- `apps/web/app/globals.css`: the tokens (teal today); `DESIGN.md` documents them.
- `apps/web/app/(staff)/admin/`: the admin routes; `components/admin-sidebar.tsx` the navigation.
- `apps/web/app/(portal)` and `components/portal-view.tsx`: the captive portal and its preview.
- `apps/web/public/logo.svg`: the mark; `portal_settings` holds the portal's default brand.
- `apps/api/src/analytics/`: today's figures; the comparisons and ranges of H3 are new.
- Design reference: the review pages in git-ignored `prototypes/hearth-design/` (`round-1-variations/`,
  `round-2-hearth-and-night-band/`, `round-3-roles/`, and `generator/`). The tokens and layouts this
  plan needs are written below, so it stands without them.

## Plan Of Work

**H1, tokens and mark.** Light: ground `#F4F6F8`, panels `#FFFFFF`, tone step `#EDF0F3`, ink
midnight `#0D1B2A`, muted `#4E5D6E`, borders `#DFE3E8`, primary ember `#F59E2A` with midnight text,
data ember, ember as text `#A9530A`; problems in red, never ember. Dark: midnight ground, panels
`#132538`, ink `#EEF1F4`, ember text `#F6AE52`. The mark: an open ring with the ember in its gap
(`public/logo.svg`, favicon, router pages). Portal defaults in `portal_settings`: midnight and ember.
`DESIGN.md` rewritten for Hearth, recording the deliberate exception that the dark theme is midnight,
not neutral. Every existing screen takes the new tokens; nothing else changes yet.

**H2, shell.** The sidebar in groups (unlabelled: Overview, Live sessions, Issues, Vouchers, Payments,
Billing for owners, Analytics; then Manage, Services for owners, Business and Settings), rendered from the API's capabilities, never from role names. Analytics
and the groups open alike, one at a time: opening one closes the other, clicking it again closes it,
and the one holding the current page opens by itself; operators have
a short list with no groups. Payments shows what guests have paid over time, month by month, and an owner also sees hashifi's fee and what they keep; Billing shows what the business pays hashifi. At the top,
the business's logo and name (HashiFi with the Platform tag for platform staff) and the scope filter
(all businesses or one; all venues or one; absent with one venue). At the foot, the account menu:
name and role, the workspaces, Account and security, Sign out, and "Runs on HashiFi". One sign-in
screen for everyone, named HashiFi with no "staff" or "admin" wording. The sign-in is always dark, whatever the
theme setting: a midnight field, the open ring large in the lower right, and a 420px card (title,
email, Continue, the terms line, "Need help signing in?" with Contact support), sized one step
above the admin's controls; no logo in the corner; a footer strip with
"© <year> Shikome Technology Limited" on the left and the links Privacy, Terms and Send feedback together
on the right, on every step; on a phone the links come first and the copyright closes the page. The
terms of service and privacy notice are stand-in drafts in the prototype (`terms.html`, `privacy.html`),
written from what the product does; before launch a lawyer reviews them against Tanzania's Personal Data
Protection Act, and the points they mark "to confirm" are decided: company registration and address,
registration with the Personal Data Protection Commission, the hosting provider and where data lives,
retention for guests' sessions, invoices and closed businesses, VAT, notice periods, router warranty,
and the liability cap. The code and passkey steps use the
same frame. Prototype: `prototypes/hearth-design/prototype/`. Below 768px a
48px bar and a sheet. Needs business-scopes M2.

**H3, overview and Analytics.** `GET /api/overview` returns what needs attention, the figures with
the same hour a week earlier, each venue today, and devices online today with last week's line;
`GET /api/analytics?range=` returns takings per day, by venue with shares, the package mix and the
busiest hours. The web renders both; the one-venue owner's and the operator's overviews come from
the same endpoint by capability. Lines, never bars, for time.

**H4, phones and forms.** Under 768px every table becomes stacked rows; the packages icon row and
the voucher buttons get names; the router edit form in plain words; the router page shows its model
and RouterOS version after setup.

**H5, captive portal.** The API becomes the only source of portal defaults (ADR-0003): remove
`apps/web/lib/portal-defaults.ts` and the portal page's `DEFAULT_FORM`, and have the print and batch
endpoints return each voucher's resolved brand. Router pages take their colours from the same
templating as their URLs (`portal-files.ts`), not hand-copied values. The night top with the logo, venue name and place, over a white sheet with
the welcome ("Karibu. Pull up a seat."), "Scan the QR code on your voucher, or enter its code.", the code field and the button; the packages below. Logo:
the venue's, else the business's, else HashiFi's. The router's pages stay byte-exact, and the walled
garden is checked against the script Cloudflare injects into guests' pages.

**H6, business screens.** Team (invite a manager or an operator to chosen venues; managers invite
operators), Packages (the defaults, venue-only packages, a CSV export; no import, as a business has only a handful), Business
profile (name, logo, each venue's portal), and for platform staff Add a business and Default
packages. Needs business-scopes M3 to M5.

Every footer and email shows the HashiFi mark and `© <year> Shikome Technology Limited`; the
captive portal's foot keeps "by HashiFi" as its credit.

**H7, audit.** design-audit `critique` and `audit` at 1280 and 375, light and dark, with real seed
data; no P0 or P1 left. Then the docs, and the plan folded away.

## Order across plans

1. H1 (no schema change; can ship at once). Then the prototype, reviewed and approved.
2. business-scopes M1 and M2.
3. H2, then H3.
4. business-scopes M3, M4 and M5.
5. H5 and H6.
6. H4 and H7.
7. business-scopes M6, live acceptance with a test business.

## Concrete Steps

From the repository root: `bun run verify`, `bun run test:integration`, and `bun run dev` to walk
each screen. design-audit runs against the running app.

## Validation And Acceptance

The Purpose's story walked in a browser for each role; design-audit with no P0 or P1; refreshing
any screen keeps its filter and workspace; a guest VM on CHR reaches the portal and redeems a
voucher after H5.

## Idempotence And Recovery

Each milestone ships on its own; H1 is token-only and reverts with one commit.

## Interfaces And Dependencies

`Capabilities` and `Principal` (business-scopes M2), and the overview and analytics shapes (H3), in
`@hashifi/types`.

## Deferred

- `router-sim guest-run` after a host reboot: answer the console's cursor query and bring `eth0`
  up before DHCP.
