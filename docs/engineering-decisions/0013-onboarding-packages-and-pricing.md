# ADR-0013: Onboarding packages and pricing

Status: accepted, 4 November 2026, by the owner. Figures are starting points, set in the platform's
Defaults; the model is the decision.

## Context

hashifi is an infrastructure fee on a business's WiFi sales. Most venues already have an internet
router from their ISP. A hashifi venue needs a MikroTik router configured by hashifi's team (a
router is configuration, never something a business enters: ADR-0011), placed between the ISP router
and the guests. Owners are not network technicians, so the team installs it.

## Decision

1. **The venue's network.** The ISP router stays as it is and gives the MikroTik its internet on
   port 1. Guests join the MikroTik's WiFi, or the business's other WiFi routers plugged into the
   MikroTik's other ports, which must run as access points (bridge mode, no DHCP or NAT of their
   own) so the hotspot sees each device. The business's own staff network stays on the ISP router.
   The MikroTik runs RouterOS 7 with the hotspot; any ISP router with an Ethernet port and DHCP works.
2. **Three onboarding packages**, chosen per venue:
   - **Bring your own:** the business has a compatible MikroTik and ISP router; the team configures
     and sets up on site.
   - **hashifi MikroTik:** the team brings a MikroTik configured at the office and connects it to
     the business's ISP router.
   - **Everything:** the team brings the MikroTik and an ISP router (Vodacom, Yas, Airtel, as
     needed), sets up on site and tests that guests get online.
   Routers are sold at their price. The onboarding fee covers travel and time: free in town, charged
   by distance otherwise.
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

## Consequences

- The bootstrap script must take the MikroTik's internet address from the ISP router by DHCP on
  port 1, keeping the fixed address as an option, so a router configured at the office works at
  any venue (`apps/api/src/services/router-provision/bootstrap.ts`).
- Readiness warns about a downstream router that hands out its own addresses.
- A **Billing** page: per venue, the month's activated vouchers and their value, the fee by band,
  the onboarding and router charges, what is due and how to pay; the platform sees every
  business's. Payment states for an unpaid account are still open.
- The getting-started checklist follows the package: invitation accepted, package chosen, router
  configured, installed on site, set up, a phone checked.
