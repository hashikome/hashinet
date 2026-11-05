# ADR-0014: Service access, archiving, and the venue lifecycle

Status: accepted, 5 November 2026, by the owner. The model follows Pigfarm's organization service
access (`pigfarm/docs/designs/platform-administration.md`), adapted to WiFi.

## Context

hashifi charges a share of each business's sales (ADR-0013), so it needs a way to act when a business
stops paying, breaks its terms, or ends its contract. ADR-0013 left the states of an unpaid account
open. ADR-0011 gave only Hashikome the right to create a business's further venues, which keeps a
business waiting on a call. Platform staff also need a clear line between what is theirs to change
and what belongs to the business.

## Decision

1. **What the platform does, and what the business does.** hashifi's team acts on businesses
   (invite, onboarding package, billing, service access, archive), on routers (add, configure, set
   up, check, replace, remove), on Defaults, and on its own team, invitations and audit log. It sees
   a business's owners and managers (name, email, role, venues), its venues, packages and captive
   portal read-only, and the invitations it issues itself (its own team, new businesses' owners). A
   business's operators, its sign-ins and its own team's invitations are the business's; what anyone did
   is in the audit log. Of its devices and sessions it sees only counts:
   never a device list, a session or a customer's number. Everything a business
   sells and shows is the business's: its venues' names, locations, open hours and allowed sites, its
   packages and prices, captive portal, vouchers, payments, devices, team and profile.
2. **Service access is its own state** on the business, separate from its lifecycle:

   | State | The business | Its customers |
   | --- | --- | --- |
   | Enabled | Everything | Normal |
   | Grace period (7, 14 or 30 days) | Everything, with a notice to its owner and managers | Normal |
   | Read-only | Signs in and looks; no new vouchers, packages or prices | Vouchers already sold keep working |
   | Suspended | Signs in to see why, the bill, and how to get access back | The portal takes no new vouchers; anyone online keeps their time until it ends |

   Allowed changes: enabled to grace period, read-only or suspended; grace period to enabled,
   read-only or suspended; read-only to enabled or suspended; suspended to enabled. Anything else is an
   audited override. A business is never suspended on its first failed payment.
3. **Customers are not punished for the business's account.** They paid the business, so vouchers
   already sold keep working while the business is read-only, and sessions in progress run out
   rather than stop when it is suspended.
4. **Who may change it.** The platform owner and platform managers start a grace period, restrict to
   read-only, and restore. Only the platform owner suspends, applies an override, archives, or
   restores an archived business. Every change takes a reason (payment overdue, payment received,
   policy violation, customer request, contract ended, issue resolved, other), an internal note, and an
   optional message to the customer; it needs a fresh authenticator code, is written to the audit log
   with the note, and emails the business's owners with the reason in plain words and the message,
   never the note.
5. **Archiving closes a business without deleting it.** The platform owner archives a business
   (contract ended, terms broken) by typing its exact name; its owner may close it themselves, which
   archives it too. Archived, it reads as closed, the hotspot is switched off on its routers, and its
   data is kept for retention (to be set with the data-retention decision). Restoring brings it back
   as it was.
6. **A business adds its own venues; there are no empty venues.** The owner adds a venue with its name,
   location and how its router will come (one of ADR-0013's onboarding packages). It starts **Waiting
   for a router** and lands in Needs you for hashifi's team. Once the team adds and sets up its
   router, it goes live through the usual steps. A venue with no router after **14 days** is removed:
   the owner is warned at day 10, and the removal is audited. The business edits its venues' details
   from then on.

## Consequences

- ADR-0011's "only Hashikome creates further venues" is replaced by point 6; routers stay
  Hashikome's.
- ADR-0013's open question on unpaid accounts is answered by points 2 to 4.
- PRODUCT.md's data table: devices and customers are visible to a business's people for their venues,
  and to platform staff only as counts.
- The API enforces service access in one policy after authentication and scope (ADR-0003), and the
  router workers stop new vouchers and logins while a business is read-only or suspended.
- Pages: a business page has Service access (and Archive for the platform owner); a platform venue
  page is read-only; an owner's Venues page has Add a venue; Needs you lists venues waiting for a
  router with the days left.
