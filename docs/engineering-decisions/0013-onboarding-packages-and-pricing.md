# ADR-0013: Onboarding packages and pricing

Status: accepted, 4 November 2026, by the owner. Figures are starting points, set in the platform's
Settings; the model is the decision. Widened 13 November 2026: the agreed package is itemized, all
on HashiNet's bill, and platform operators work the setups handed to them.

## Context

hashifi is an infrastructure fee on a business's WiFi sales. Most venues already have an internet
router from their ISP. A hashifi venue needs a MikroTik router configured by hashifi's team (a
router is configuration, never something a business enters: ADR-0011), placed between the ISP router
and the guests. Owners are not network technicians, so the team installs it.

## Decision

1. **The venue's network.** The ISP router stays as it is and gives the MikroTik router its internet on
   port 1. Guests join the MikroTik router's WiFi, or the business's other WiFi routers plugged into the
   MikroTik router's other ports, which must run as access points (bridge mode, no DHCP or NAT of their
   own) so the hotspot sees each device. The business's own staff network stays on the ISP router.
   The MikroTik router runs RouterOS 7 with the hotspot; any ISP router with an Ethernet port and DHCP works.
   The ISP router sees one device, so its own limit on WiFi clients does not apply: a venue's limit is
   its line, the MikroTik router's radio and processor, and how many are active at once. A venue grows
   in two ways. Access points and extenders carry a MikroTik router's WiFi further and are not routers
   to hashifi: nothing counts them. Adding a router always means another MikroTik router at the same
   venue, such as one for a hotel's restaurant, garden or floors. A router's name is its WiFi name, the
   one guests see in their network list and the one a voucher tells them to join. It is separate from
   the venue's name: naming it after the venue helps guests, but nothing requires it. The ISP router is the business's own
   and never counts. Each MikroTik router takes its internet on port 1 from the ISP router, a switch on
   its network, or a line of its own, never from another MikroTik router's ports, which sit behind that
   router's hotspot. An owner adds a router by naming its venue; it then follows the same steps and the same
   two issues as a new venue, and its WiFi name is set when the router is added at setup. The router is what guests see, so Hashifi
   matches it: it writes the name at setup, confirms it from the router, and keeps reading it, and a name
   changed on the router updates Hashifi by itself.
   Every router starts from such a request: the platform has no way to add one without an issue behind it.
   When an owner asks by phone for a router or a venue, the team starts the same request for them, with
   Add a router on Routers or Add a venue on Venues. A new
   business still comes only by invitation. Replacing a router that failed is Set up again, not a new router. Its router and setup are one one-off charge on the bill, agreed
   on the call, and nothing else changes: the percentage and the minimum stay per venue, however many
   routers it has. A voucher works on every router at its venue (ADR-0008).
2. **Three onboarding packages**, chosen per venue:
   - **Connect:** the venue has a compatible MikroTik router and ISP router; the team sets it up.
   - **Install:** the team brings the venue a MikroTik router, sets it up and installs it behind the
     venue's internet router. Where the setup script runs, at the office or on site, does not matter.
   - **Launch:** Install, plus a new internet line from a partner seller of the provider. hashifi
     never supplies the line itself: SIM and line registration must be in the business's name, so the
     owner is there on the day to register it with the seller.
   The names step up (connect what is there, install a router, launch with a line), each with a
   one-line summary, so they read the same to an owner and to the team.
   **What a package costs is itemized, all on HashiNet's bill.** An onboarding fee, agreed per business
   for whatever getting it onto HashiNet takes (travel, time, coordinating the partners), and what the
   plan brings, each a line at its price: the MikroTik router, and for Launch the internet line or fibre
   and the ISP router, or anything else agreed. Connect starts with the onboarding fee alone, Install
   adds the MikroTik router, Launch the line too; the team changes them on the call. HashiNet deals
   with the partner sellers and the business pays one bill, so the owner sees why the total is what
   it is and never deals with a seller over money.
   The owner chooses a package as a preference, or asks to talk to the team first, as the first thing
   after signing in to a new business; adding a venue asks the same, and leaving it unchosen means
   talk it through. It commits nobody: hashifi's team always calls the owner to go over the venue, how the team
   will help and what is already there, then confirms the package and its lines. No router is added
   and nothing is charged before that, and the team can change the package until it is paid or its
   setup scheduled.
   A package says what it includes, never a price or a model: the router that fits depends on the
   venue, so its model and price are agreed on that call, as the router's line.
   Every venue includes one site open before paying, its business website; each further one takes
   a slot paid for once, TSh 10,000, issued
   when the site is added, due 7 days later, and the site opens once it is paid. A paid slot stays
   with the venue if its site is removed. Blocking sites is free.
   A venue goes through two issues, one after the other. **Its package**, for the platform's owner
   and managers only: call the owner, confirm the package, its lines and notes; get it paid in full
   when there is a charge, due 7
   days after the package is confirmed (the platform admin or a platform manager records it); then schedule the setup with a date and, optionally, who
   goes. **Its setup**, once scheduled: add the router, set it up and check a phone, wherever the setup
   happens; it closes when the first guest is online. The admin and managers do everything that is
   theirs and hand a setup to a platform operator, the technician who goes: an operator sees only the
   issues handed to them, and a handed setup is their pass to add its router and set it up.
   Issues lists setups by date, soonest first.
3. **One plan, a percentage of sales, per venue.** 5% of each voucher's price, so a TSh 500
   voucher pays TSh 25, with a minimum of TSh 5,000 a month per venue: a venue that sells little or
   nothing still pays for the infrastructure it uses, and a venue selling TSh 100,000 or more a month
   never meets the minimum. The minimum counts from the first full month after setup, and only while
   a router is serving. Volume lowers the rate, as bank transaction fees do: a
   venue's sales above TSh 2,000,000 in a month pay 2.5%. The bands are marginal, like tax bands: only
   the part above the threshold pays 2.5%, so selling one more voucher never raises the bill. A venue
   selling TSh 4,000,000 pays TSh 150,000. Rates, threshold and minimum are figures in the platform's Settings. There is
   no cap and no plan to choose: above the minimum, hashifi earns as the business earns, at every size.
4. **The fee is on the voucher's price, counted when the router confirms it** (a voucher that went
   `active`): the price printed on the voucher, which the business sets. Every printed voucher shows
   its price, so a guest can see when they are asked for more. What a business charges a guest above
   it is its own.
5. **VAT** does not apply while hashifi's turnover is under the TSh 200 million registration
   threshold. Revisit when it nears it.
6. **Invoices are paid in full by their due date.** The business has already collected the money its
   fee is a share of, so hashifi offers no instalments, and invoices, reminders and any payment link
   ask for the full amount. Each business is reminded on its own when its bill is due, by email and,
   once set up, by SMS; staff remind one business as a follow-up, never all at once.
   Confirming a package with a charge emails its invoice to the owner at once, and the setup issue can
   record the payment or remind without leaving it. With online payments, a payment against the
   invoice's control number closes that step by itself. Whatever does arrive is recorded as it arrived and settles the oldest
   invoice first. A part payment does not stop an invoice going overdue, and service access follows
   the overdue amount as usual (ADR-0014). Only fees count: they pay for service already used, while a one-off
   payment, such as an onboarding charge or an extra site, comes before what it buys, so leaving it
   unpaid only holds that back and leaves service access alone.
7. **SMS is the business's choice and its cost.** The fee includes no messages: a business that wants
   codes sent by SMS buys credits in advance, TSh 30 a message, at least 1,000 at a time (TSh 30,000).
   Credits arrive once the purchase is paid, and it is a one-off charge. Only packages of a day or
   longer send a code by SMS: on an hourly package the message costs more than the sale earns and the
   guest is gone before they need it. Without credits, or on a shorter package, the code still appears
   on screen, so no guest is stranded. This narrows
   ADR-0010, which sends a code by SMS on every payment.
8. **Collecting payments online costs the business per sale,** on top of its fee: Snippe's 2.5% of
   each successful payment, so an online sale costs 7.5% in all. Snippe holds the money in escrow and
   charges TSh 1,500 a payout. Businesses are paid out weekly, once TSh 20,000 or more is waiting, and
   the TSh 1,500 comes out of the payout. Whether hashifi may direct payouts from that escrow to other
   businesses is still to be confirmed. Printed vouchers stay at the plain fee. Payouts are sent by
   HashiFi's API through Snippe's payout API and recorded from its webhooks (`payout.completed`,
   `payout.failed`, `payout.reversed`), with a daily check for any it has not heard back on; nobody
   records a payout by hand. A failed or reversed payout is a platform issue to retry
   (7 November 2026).

## Consequences

- The bootstrap script must take the MikroTik router's internet address from the ISP router by DHCP on
  port 1, keeping the fixed address as an option, so a router configured at the office works at
  any venue (`apps/api/src/services/router-provision/bootstrap.ts`).
- Readiness warns about a downstream router that hands out its own addresses.
- A **Billing** page: per venue, the month's activated vouchers and their value, the fee by band,
  the onboarding and router charges, what is due and how to pay; the platform sees every
  business's. An unpaid account follows ADR-0014's service access.
- The getting-started checklist follows the package: invitation accepted, package confirmed, router
  configured, installed on site, set up, a phone checked.
