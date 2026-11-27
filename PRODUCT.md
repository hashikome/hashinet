# HashiNet product requirements

The canonical product definition: what HashiNet must do and why. How it is built is in
[ARCHITECTURE.md](ARCHITECTURE.md) and [docs/design-docs/](docs/design-docs/README.md).

## 1. Summary

**HashiNet: the platform for running WiFi businesses.**

It began with a chore at home: letting a guest's phone onto the router, then remembering to take
it off again. Every venue that shares its WiFi has the same chore, multiplied: a guest house, a
café, a hostel, a bar. Most hand out one password that never changes, or switch devices on and off
by hand. HashiNet lets them sell access instead: by time and number of devices, through a captive
portal in the venue's own name, bought at the venue's counter or on the portal. The router enforces
what was bought and ends it on time, and nobody has to ask for the password.

HashiNet is the software and the setup behind that service. It is not what guests see: they see
the venue.

### How it fits together

- **The platform** is HashiNet, run by Shikome Technology Limited under the Hashikome brand. Its
  team onboards businesses, sets up their venues and routers, and supports them.
- **A business** is a customer that sells WiFi, at one venue or many.
- **A venue** is a place where the business offers WiFi: a lodge, a café, a home.
- **A router** is a MikroTik router installed at a venue. It enforces each guest's package; a large
  venue has several, and a voucher works on any of them.
- **A guest** joins the venue's WiFi on a phone and gets online through the venue's own portal, with
  a voucher bought at its counter or on the portal.

## 2. Users and use

| User | Context and goals |
| --- | --- |
| Platform admin | Responsible for HashiNet itself. Alone manages platform managers, platform settings and what businesses pay, and pauses a service for every business |
| Platform manager | Runs businesses, venues, routers and onboarding in the admin's place, except what the admin keeps |
| Platform operator | Supports businesses: connection checks, setup help, looking things up |
| Business owner | Accountable for the business, which sells WiFi at one or more venues: packages and prices, captive portal, analytics, their team. Alone invites business managers, sets business-wide prices, pays Hashikome, holds the payout account, adds venues and closes the business |
| Business manager | Manages the whole business, across every venue, in the owner's place, except what the owner keeps |
| Venue manager | Runs the venues they are assigned, one or a few, day to day |
| Venue operator | Works the counter at their venues: vouchers, live sessions, devices, the day's cash |
| Guest | Joins a venue's WiFi on a phone, often on a slow link, and wants to get online quickly |

A business is the tenant and owns its venues; roles and what the admin and each owner keep are in
[ADR-0011](docs/engineering-decisions/0011-platform-and-business-scopes.md). Paul's home is the
first venue.

## 3. Principles

- **Nobody has to ask.** Self-service purchase on the portal is the default way in; it works at
  any hour without the owner or a venue's staff acting for the guest.
- **Cash still works.** A sale at the counter, for cash or mobile money paid to the venue, is a
  first-class way in for guests who will not pay on the portal.
- **Every way in is one mechanism and is recorded.** Self-service and a sale at the counter both end
  in a voucher the router confirms, and a voucher exists only by its sale, so every one is counted
  as a sale at its venue (ADR-0017).
- **Access follows the router, not the database.** HashiNet reports access granted only
  after the router confirms it.
- **The voucher is the guest's identity.** MAC addresses are a soft device signal:
  modern phones randomise them per network, and anyone nearby can observe them.
- **The ISP router is only an uplink.** HashiNet controls a MikroTik behind it.
- **Routers are probed, not assumed.** Board and RouterOS differences are detected.

## 4. Scope

### 4.1 Venues and routers

A venue gets online through two issues in turn (ADR-0013, 2). Its owner says how the router
should come (Connect their own, Install one HashiNet brings, or Launch with a new internet line too,
or talk first); HashiNet's admin or a manager calls them, agrees the package line by line (an
onboarding fee agreed for the business and what the plan brings, all on one bill), which invoices
it, due 7 days later; once its payment is recorded they schedule the setup. The setup goes to whoever goes, a platform operator as a rule: they
add the router, run its bootstrap script on a freshly reset MikroTik, and HashiNet configures the
hotspot automatically and safely repeatably, with a readiness checklist of what is working. The
setup closes when the venue's first guest is online. No router is added before its setup is
scheduled, and no venue serves a guest before its owner has protected their sign-in.

A venue can list sites guests may open before paying, such as its own website.

Acceptance: a reset router becomes a working hotspot through the bootstrap script and the
automated setup alone, and the checklist reports each check's real state.

### 4.2 Packages

A package defines a price in TSH, a duration, optional speed and data limits and a device
limit. The business's packages are sold at every venue at their price, unless a venue has its own
price for one or stops selling it there; the owner keeps them, and the owner and business managers
set a venue's prices (ADR-0011, 4). A venue's managers add packages sold only at that venue. A
voucher keeps the price it was sold at.

### 4.3 Vouchers

A voucher exists only by its sale (ADR-0017): it is made when whoever is at the counter sells it,
or when a portal payment is confirmed, never in advance as stock. A voucher belongs to its venue and
works on every router there, and its device limit counts the devices online at once. Whoever is at
the counter releases a voucher in use for a guest whose phone changed: its devices go offline and
the next one signs in with the code, while its time runs on (ADR-0015). An owner or manager refunds
a voucher while it is unused, recording how the money went back; it stops working, and is never
revoked or undone. A voucher's lifecycle is `unused → pending_activation → active → expired` (or
`used`), or `unused → refunded`, decided by the API and the router.

### 4.4 Captive portal

Anyone in range taps the venue's WiFi, which has no password, and sees that venue's branded portal
with its plans and prices. They buy a package with mobile money where the business takes payments
online (4.7) and are logged straight in, or are told where to buy in person and who to call; or they
enter a voucher's code, and are online once the router confirms. A voucher's QR code joins the WiFi,
as any WiFi QR code does; the code is typed. A returning device with an active voucher reconnects
without re-entering the code, without the code ever being exposed.

Acceptance: a phone on a HashiNet hotspot reaches the portal, redeems a voucher and browses;
the voucher's limits and expiry are enforced by the router.

Branding is per venue: its name, logo, background, colours and wording, shown on its portal and
the vouchers it sells. A venue that has set none shows the HashiNet default. Admins edit the default,
and managers brand their own venues.

### 4.5 Sessions and figures

Live sessions per venue and router, soonest to end first, which anyone at the venue can end;
automatic expiry; usage analytics and revenue, calculated by the API. Revenue is sales less refunds:
a refund is its own line on the day it is made, so takings show gross, refunds and net, and each
seller's cash to hand over is their cash sales less the cash they gave back. HashiNet's fees are
monthly, on net sales.

A venue sells only while one of its routers serves guests: set up, reachable and with its own
internet working, which HashiNet checks from the router itself. Otherwise Sell stays in its place,
quieter, and says why (offline, no internet, needs attention, or not set up yet), and the guest
portal says when the WiFi has no internet rather than starting a voucher's time. When a router that
stopped serving serves again, each paid voucher whose time ran through it gets that time back, up to
what it had left, from when it can be used again.

A device is a guest's phone or laptop as the network sees it. Anyone at a business blocks a device
their venues have seen, for every venue of that business; another business that saw it is not
affected. The owner and business managers remove one, which forgets it for their business alone.

### 4.6 Team and audit

Owners, managers and operators, on the platform and in each business (ADR-0011). An owner of
several venues sees all of them with a venue switcher; a business sees nothing of another. People
are invited by email from a Team page, only to roles below the inviter's own. Sensitive actions,
invitations and role changes are audited.

Everything that needs someone is an issue in its workspace's Issues: a router that stopped serving,
a venue's package, a venue's setup. Someone claims it (or acting first does), releases it, or hands
it to a colleague; only someone above the holder takes it over, with a reason; every step is on its
history. HashiNet's operators see only the issues handed to them. HashiNet's team sees a business's
owners, managers, venues and its guests as counts, never a device, code or session.

### 4.7 Selling access: three paths, one mechanism

**At launch, the counter is the way in.** Self-service is built and held: it turns on when the
mobile money provider's credentials are set, and texting codes when the SMS provider's are. Until
then a guest sees the voucher form and what the venue sells, and buys at the counter.

Both end in a voucher confirmed by the router before access starts, and both record a sale for the
venue's figures. A venue can use both.

- **Self-service on the portal (the default).** The guest picks a package and pays with their
  mobile number. When the payment is confirmed, HashiNet issues a voucher and logs **the device
  that paid** straight in: no code to type. The code is also **shown on screen with a Copy
  button**, so the guest can keep it elsewhere, and sent to the phone number by SMS on a package of a
  day or longer, if the business has bought SMS credits (ADR-0013). Either copy
  is the receipt and the way to add a second device (within the package's limit) or reconnect;
  the screen copy is what makes a failed SMS harmless. The code is shown only to the portal
  session that made the payment, and that session can show it again until the voucher expires.
  Works at any
  hour with nobody acting for the guest. A payment that succeeds while the router is
  unreachable is retried until the guest has access, and is shown as access owed until then.
- **A sale at the counter.** Anyone at the counter sells a voucher in one step, with the money in
  hand: they tap the package, choose cash or mobile money and confirm. For mobile money the guest
  pays the business directly, to the venue's way to pay (a Lipa namba, a mobile money number or a
  bank account, from the ways the business keeps in Settings › Payments), read out from the screen, and the seller enters the guest's mobile
  money number; for cash the number is optional. HashiNet makes the voucher and shows its code, with a QR
  code that joins the venue's WiFi; the seller can also send it (by the phone's share
  sheet, or by SMS when the business has credits) or print it. The fullest record: who sold it, how
  it was paid, at which venue.

Codes reach phones by **SMS**, through BRIQ, the messaging provider shared with other Hashikome
products. Not WhatsApp or email: a guest asking for WiFi usually has no data, and SMS reaches
any phone with signal. Every code is also shown on screen where it was bought, with a Copy
button, so an SMS that never arrives costs nothing; only if both are lost does the guest
contact the venue. Payments use Snippe (build plan M6).

Acceptance: on the router sim with Snippe's test environment, each path gets a guest online and
expiry cuts them off, and each appears in the venue's figures; then on a physical router with a
real payment and a real message (M8).

### 4.8 What businesses pay HashiNet

HashiNet invoices each business on the 1st for the month before, in Dar es Salaam: each venue's
net sales at 5%, and 2.5% on the part above TSh 2,000,000 a month, with at least TSh 5,000 a month
a serving venue from its first full month after setup, prorated by the days a router served it
(ADR-0013, 3). Invoices are due on the 7th and emailed to the owner; a venue's package is invoiced
when it is confirmed, due 7 days later. Each business keeps the terms it was added with; the
platform admin sets those new businesses start with, and where businesses pay, on Fees. HashiNet's
admin or a manager records what arrives, by mobile money, bank transfer or cash: on an invoice it
settles that invoice, on the business the oldest first or the invoice chosen, never more than is
owed. The owner sees their terms, what is due and their invoices on Billing, each a PDF that says
how to pay, and what they owe as an issue at the top of theirs; the owner is reminded on a due date
left unpaid, and on request. HashiNet's team sees every business's bill on Payments.

Overdue fees set a business's service access by themselves (ADR-0014, 2): a grace period from the
day after a month's fees fall due, and read-only 14 days after the due date for a business late
before (an earlier month paid after its due date); a first late bill stays in its grace period.
Read-only sells nothing new, at the counter or on the portal, and changes no packages or prices;
vouchers already sold keep working. The owner's bill issue says selling is paused; its managers get
an issue of their own; the owner is emailed at each step, and paying restores it at once. HashiNet's
team holds a business at a state by hand, for a time or until changed; only the platform admin
suspends.

Acceptance: a business's first monthly invoice is issued on the 1st; its payment is recorded; its
owner sees it paid.

## 5. Data

| Data | Purpose | Visible to |
| --- | --- | --- |
| Memberships | Sign-in (a passkey, or an email code with an authenticator code for platform roles, owners and managers), role, scope, venues | Platform owner and managers; a business's owner and managers for their business |
| Devices | A guest device's MAC address, name and type, and its sessions (not a person: one guest can be several devices) | A business's people for their venues; platform staff see counts only (ADR-0014) |
| Customers | A paying guest's mobile number, their devices and payments (from M6) | A business's people for their venues; platform staff see counts only (ADR-0014) |
| Router credentials | Configuring routers | Encrypted at rest; never returned to clients |

Development and tests use invented data only.

## 6. Non-functional requirements

- **Guests on cheap phones and slow links:** the portal is small and works on a first visit
  with nothing cached.
- **Time:** stored in UTC; business days in `Africa/Dar_es_Salaam`.
- **Money:** whole TSH, never decimals in presentation.
- **Copy:** never name a mobile-money provider.
- **Security:** voucher codes are credentials; see [docs/SECURITY.md](docs/SECURITY.md).

## 7. Out of scope

- **Routers other than MikroTik** (OpenWrt, UniFi, Omada, pfSense) are future options.
- **PPPoE** is not offered.

## 8. Delivery

Active plan: [build in slices](docs/exec-plans/active/build-in-slices.md).

HashiNet is in development and built in slices from the approved prototype
(`prototypes/hearth-design/`), each a complete journey accepted live before the next
([build-in-slices](docs/exec-plans/active/build-in-slices.md)): HashiNet's team and onboarding a
business, then the counter. `hashinet.hashikome.com` runs the build; it has no customers yet. Routers
are tested on a virtual MikroTik router and virtual phones (`bun run router-sim`); a physical router
has yet to pass the same tests.
