# ADR-0011: Platform and business scopes, with owners, managers and operators

Status: accepted, 3 November 2026; sign-in protection by role settled on 4 November 2026; the platform's
top role named admin on 11 November 2026. Replaces the admin and manager roles of ADR-0007, which keeps
sign-in itself.

## Context

HashiFi is sold to businesses that want to sell their WiFi: a guest house, a café, a home. Hashikome
supplies the software, creates the business's venues, adds its MikroTik routers and sets them up;
the business buys the router and its internet line. One business can own several venues, and adds
one by asking Hashikome, which sets it up the same way.

Until now `staff` had two roles, admin and manager, and a venue had one `operator_id`. That cannot
say that Neema owns three venues, that someone runs one of them for her, or that someone else only
sells vouchers at its counter, and it gives Hashikome's own helpers nothing between "everything" and
"one venue".

## Options considered

- **Keep admin and manager, add venue lists.** Small, but a manager is both the person who runs a
  venue and the person at its counter, and Hashikome's helpers must be admins to help anyone.
- **Each venue its own organization.** An owner of three venues would belong to three tenants, and
  "all my venues" would read across tenant boundaries, which is what the boundary exists to stop.
- **Two scopes, one ladder of roles** (chosen): the platform and the business, each with an owner,
  managers and operators.

## Decision

1. **Two scopes.** The *platform* is Hashikome running HashiFi. A *business* is the tenant: it owns
   one or more venues, and every venue belongs to exactly one business. Packages, vouchers, sessions,
   devices, payments and brands are reached through their venue's business.
2. **Roles at each level** (business roles clarified 11 November 2026; they need not mirror the
   platform's one for one).
   - **Platform:** the **admin** is responsible for HashiNet; a **manager** runs businesses, venues,
     routers and onboarding in the admin's place, except what the admin keeps (below); an **operator**
     supports businesses: connection checks, setup help, looking things up.
   - **Business:** the **owner** is accountable for the business; a **business manager** manages the
     whole business, across every venue, in the owner's place, except what the owner keeps.
   - **Venue:** a **venue manager** runs the venues they are assigned, one or a few, day to day; a
     **venue operator** works the counter there: vouchers, live sessions, devices and the day's cash.
     Anyone covering every venue is a business manager, not a venue manager of each.
3. **What the business owner and the platform admin keep.** The business owner alone invites and removes business managers, sets
   the business-wide packages and prices, holds the payout and billing relationship with Hashikome
   (paying its bills, SMS credits, online payments and the payout account), adds venues (ADR-0014),
   and closes the business (confirmed 11 November 2026). A business manager does everything else
   across the business, including inviting venue managers and operators. The platform admin alone invites and removes platform
   managers, changes platform settings and secrets, sets what businesses pay, and deletes a business. Setting what businesses pay
   is not recording what they paid: a platform manager records payments and sends reminders. The
   captive portal's defaults (its themes, which page opens first, the logo and the wording) are not
   sensitive, so a platform manager changes them too (7 November 2026), as with the default packages. Turning online payments on or off for one
   business is a platform manager's job as well; pausing a service for every business stays the
   platform admin's.
4. **Venue scope inside a business.** A business owner and a business manager reach every venue of
   the business. A venue manager or venue operator reaches only the venues on their membership, at
   least one. A venue manager may add packages that are sold only at their own venues. A business has a default set of packages,
   and a venue follows it until its owner gives that venue its own price or stops selling a package
   there; a change to a default price never touches a venue with its own, and a printed voucher keeps
   the price on it.
5. **Platform staff see every business.** Platform roles reach all businesses and venues, narrowing
   to one with the scope filter at the top of the sidebar, which never changes workspace. Only Hashikome invites businesses and adds and configures routers: a router is configuration, not something a business types in. A business owner creates their business and first venue only by accepting an invitation, and adds further venues themselves, each waiting for a router (ADR-0014). Platform staff see a business's devices and sessions only as counts (ADR-0014).
6. **Nobody gives more than they have.** A person invites only roles below their own, inside their
   own scope: an owner invites managers and operators, a manager invites operators to their venues.
7. **One person, one identity, one active membership.** A membership is a role in a scope, plus its
   venues where that applies. A person keeps one email and may hold several memberships, at most one
   per scope: the platform admin may also own their own business, one person may own two
   businesses, a manager may run venues for two businesses. Switching has two levels:
   - **Workspace,** in the account menu at the foot of the sidebar: which membership the session acts
     as, the platform or one business. Every switch is audited.
   - **Scope filter,** at the top of the sidebar: inside the workspace, all businesses or one for
     platform roles, all venues or one inside a business. It narrows the view and grants nothing.

   There is one sign-in for everyone, with no workspace to choose on it. A session opens in the
   workspace the person used last, if that membership is still active; otherwise in their
   highest-authority active membership (platform before business, then owner, manager, operator).
   Switching stays in the account menu.

   Nothing from one membership applies while another is active, so platform powers never reach into
   a business view or the reverse. Inviting an email that already signs in adds a membership to that
   person rather than a second identity.
8. **Authorization comes only from the active membership**, decided in one policy in the API: may
   this role take this action in this scope. The web shows what the API returns and never infers access from
   what it renders (ADR-0003). Better Auth keeps identity and sessions (ADR-0007); memberships hold
   what HashiFi decides.
9. **Sign-in protection** (ADR-0007). Every platform role, and business owners and managers, protect
   their sign-in with an authenticator app or a passkey, whichever membership is active: once the
   authenticator is on, their email code is always followed by its code, and a passkey signs in on its
   own. Both are set up from Account and security, not during sign-in (7 November 2026). Only a session
   signed in with one of them can act; a session from an email code alone reaches only Account and
   security, so an email account that is taken over can do no harm. Until a person has one: platform
   staff reach only Account and security; a business's owner or manager can get set up for 7 days
   (onboarding, packages, portal, team), but no venue starts serving and nothing is sold, and after
   the 7 days only Account and security opens. Setting up the authenticator shows the recovery codes once.
   Replacing the authenticator or making new recovery codes first asks the person to confirm it's
   them, with a code from the current authenticator, a recovery code (which is then used up) or a
   passkey, so an unlocked device can't move the second factor elsewhere.
   A passkey counts only with user verification (the device unlock: fingerprint, face, PIN, or a
   password manager's unlock): it is requested as required when a passkey is created and when it signs
   in, and the API rejects any assertion without the user-verified flag (7 November 2026). Business operators sign in
   with the email code alone unless they turn the authenticator on. Anyone may add passkeys. Losing
   the phone means a recovery code, or a platform admin or manager resetting the authenticator after
   confirming the person, which signs them out everywhere.
10. **Default packages.** A new business starts with the platform's default packages, which the
    platform admin and managers edit (7 November 2026; a change reaches only businesses added after it): 1 hour for TSh 500, 1 day for TSh 1,500 and 1 week for TSh 7,000. A
    business can change them, add its own, or export them as a CSV file; there is no import, since a
    business has too few packages for one (7 November 2026).
11. **Issues are claimed by rank** (5 November 2026). Anyone in scope claims an issue nobody holds,
    by Claim or by acting on it; its holder releases it or hands it to a colleague; only someone
    above the holder takes it over, with a reason the holder is told. While it is held, its steps are
    the holder's, except recording a payment, which stays the platform admin's. An issue held
    with nothing done on it for 24 hours (a claim counts) is **stalled**; a scheduled setup waits
    for its date instead and stalls only if the date passes before its router reaches hashifi. A
    stalled issue is flagged: its status says so and Issues can filter for it; it is
    never released by itself. The API names these claim, release, hand
    and take over.

## What must hold

- Every API read and write is scoped to the session's active membership; a record in another business, or
  at a venue the membership does not hold, answers not found, never forbidden.
- The policy is the one place that maps a role and scope to an action; no controller compares role
  names.
- An owner-only action stays owner-only for managers in the same scope.
- Every invitation, role change and removal is in the audit log with who did it.
- An invitation is the only way in, and issuing one creates nothing: a business, its first venue and
  its owner exist only once the invited owner accepts and names them (business-scopes M3, as
  Pigfarm's ADR-0012).

## Evidence

Agreed with the owner on 3 November 2026 from the round 3 design review (roles drawn in the Hearth
direction). Implementation, tests and the schema are in
[the plan](../exec-plans/active/business-scopes.md).
