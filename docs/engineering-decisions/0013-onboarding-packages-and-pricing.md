# ADR-0013: Onboarding packages and pricing

Status: accepted, 4 November 2026, by the owner. Figures are starting points, set in the platform's
Defaults; the model is the decision.

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
2. **Three onboarding packages**, chosen per venue:
   - **Connect:** the venue has a compatible MikroTik router and ISP router; the team sets it up.
   - **Install:** the team brings the venue a MikroTik router, sets it up and installs it behind the
     venue's internet router. Where the setup script runs, at the office or on site, does not matter.
   - **Launch:** Install, plus a new internet line from a partner seller of the provider. hashifi
     never supplies the line itself: SIM and line registration must be in the business's name, so the
     owner is there on the day to register it with the seller.
   The names step up (connect what is there, install a router, launch with a line), each with a
   one-line summary, so they read the same to an owner and to the team.
   Routers are sold at their price. The onboarding fee covers travel and time: free in town, charged
   by distance otherwise.
   The owner chooses a package as a preference, or asks to talk to the team first, as the first thing
   after signing in to a new business; adding a venue asks the same, and leaving it unchosen means
   talk it through. It commits nobody: hashifi's team always calls the owner to go over the venue, how the team
   will help and what is already there, then confirms the package and its price. No router is added
   and nothing is charged before that, and the team can change the package until the router is added.
   A package says what it includes, never a price or a model: the router that fits depends on the
   venue, so its model and price are agreed on that call, and the model is set when the router is added.
   Every venue includes one site open before paying, its business website; each further one is a
   paid add-on (price to be set), and blocking sites is free.
   A venue goes through two issues, one after the other. **Its package**, for the platform's owner
   and managers only: call the owner, confirm the package, router model, agreed price (router and
   onboarding together, on the business's bill) and notes; get it paid when there is a charge, due 7
   days after the package is confirmed (only the platform owner records payments); then schedule the setup with a date and, optionally, who
   goes. **Its setup**, for the whole team, operators included, once scheduled: add the router,
   install it on the date, set it up and check a phone; it closes when the first guest is online.
   Issues lists setups by date, soonest first.
3. **One plan, a percentage of sales, per venue.** 10% of each voucher's price, so a TSh 500
   voucher pays TSh 50; no sales, no fee. Volume lowers the rate, as bank transaction fees do: a
   venue's sales above TSh 2,000,000 in a month pay 5%. The bands are marginal, like tax bands: only
   the part above the threshold pays 5%, so selling one more voucher never raises the bill. A venue
   selling TSh 4,000,000 pays TSh 300,000. Rates and threshold are Defaults figures. There is no
   fixed monthly plan and no cap: hashifi earns as the business earns, at every size.
4. **The fee is on the voucher's price, counted when the router confirms it** (a voucher that went
   `active`): the price printed on the voucher, which the business sets. What a business charges a
   guest above it is its own.
5. **VAT** does not apply while hashifi's turnover is under the TSh 200 million registration
   threshold. Revisit when it nears it.
6. **Invoices are paid in full by their due date.** The business has already collected the money its
   fee is a share of, so hashifi offers no instalments, and invoices, reminders and any payment link
   ask for the full amount. Whatever does arrive is recorded as it arrived and settles the oldest
   invoice first. A part payment does not stop an invoice going overdue, and service access follows
   the overdue amount as usual (ADR-0014).

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
