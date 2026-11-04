# Businesses own their venues; owners, managers and operators work in a scope

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

HashiFi is sold to businesses. Hashikome creates a business, its venues and routers; the business's
owner signs in and sees all of their venues, with a venue switcher only when there are several, and
invites managers to run venues for them and operators to work the counter. Hashikome's own platform
owner, managers and operators oversee every business. The rules are
[ADR-0011](../../engineering-decisions/0011-platform-and-business-scopes.md).

Observable result: the platform owner invites neema@neemahospitality.co.tz to start a business. Neema
opens the invitation, names Neema Hospitality and its first venue, signs in with a code, asks for a
second venue, sees both, invites Halima as manager of one venue and Musa as an
operator there. Halima can change that venue's portal and add a weekend package sold only there, but
cannot see the other venue or change business-wide prices; Musa can print vouchers and see live
sessions but not analytics. Every other business is invisible to all three, and a guessed id answers
not found.

## Progress

- [x] (2026-11-03) Roles agreed with the owner; ADR-0011 written; ADR-0007 narrowed to sign-in.
- [ ] M1: schema: businesses, memberships, membership venues, invitations, business packages;
  migration of existing rows.
- [ ] M2: the access policy and the principal; every service scoped through it; the audit log (ADR-0012).
- [ ] M3: invitations and the people API for both scopes; adding a business for platform staff.
- [ ] M4: packages per business, the platform defaults and CSV import.
- [ ] M5: the business profile: name and logo, stored and served as ADR-0009 says.
- [ ] M6: live acceptance against production with a test business, once the Hearth screens exist.

The screens are built by [redesign-admin.md](redesign-admin.md), whose "Order across plans" sets the
sequence of both plans.

## Surprises & Discoveries

- Observation: venue scope is already applied in one place.
  Evidence: `apps/api/src/auth/venue-scope.ts` returns `{}` for an admin and `{ operatorId }` for a
  manager, and 56 call sites read `operatorId` through services; M2 replaces the helper, not each query.

## Decision Log

- Decision: `uuidv7()` as the database default on every generated key, and one new baseline
  migration with all data dropped.
  Rationale: one rule across Hashikome's products; nothing in production is worth preserving.
  Date/Author: 2026-11-04 / Paul
- Decision: one sign-in screen for everyone, opening in the last workspace, else the highest
  authority; switching only in the account menu.
  Rationale: one users table means one way in, a choice at sign-in repeats the account menu, and
  people mostly resume what they were doing.
  Date/Author: 2026-11-04 / Paul
- Decision: one email per person, several memberships, one active per session (ADR-0011, 7).
  Rationale: the platform owner also owns a business, and people should not keep a second identity
  to change hats; one active membership still keeps every query in one scope.
  Date/Author: 2026-11-03 / Paul
- Decision: the business is the tenant, the venue a scope inside it.
  Rationale: an owner's "all venues" stays inside one tenant.
  Date/Author: 2026-11-03 / Paul and Claude
- Decision: one `users` table for everyone who signs in; `memberships` replaces `staff`.
  Rationale: one sign-in, one invitation flow and one policy; the scope column, not the table,
  separates platform staff from a business's people, and only the active membership applies.
  Date/Author: 2026-11-03 / Paul and Claude
- Decision: a business profile (name, logo) above each venue's portal brand; the admin keeps
  HashiFi's design (ADR-0009).
  Rationale: a business with venues known by different names needs the venue on its portal.
  Date/Author: 2026-11-03 / Paul and Claude
- Decision: keep platform operators in the model though none exist yet.
  Rationale: the same ladder in both scopes costs nothing extra and avoids a later migration.
  Date/Author: 2026-11-03 / Paul

## Outcomes & Retrospective

Not started.

## Context And Orientation

- `apps/api/prisma/schema.prisma`: `Staff` (role `admin` or `manager`, status), `Venue.operatorId`,
  global `Package` linked to venues by `VenuePackage`.
- `apps/api/src/auth/staff-guard.ts`: the global guard; reads `staff`, enforces the authenticator
  app for admins, and offers `@Roles(...)`.
- `apps/api/src/auth/venue-scope.ts`: the one venue filter every scoped query uses.
- `apps/api/src/team/`, `apps/api/src/staff/add-staff.cli.ts`: adding people today (admins only).
- `packages/types`: `StaffRole` and the principal as the web reads them.
- Terms: a *scope* is the platform or one business. A *membership* is a person's role in a scope,
  plus venues for a business manager or operator. *Owner-only* actions are listed in ADR-0011, 3.

Production holds only test data (one venue, `chr-test`, and test vouchers) and one staff member, the
platform owner, which are dropped with the old migrations. The platform owner is created again by
the add-staff command, and `chr-test` re-runs setup.

## Plan Of Work

**M1, schema.** Every generated primary key defaults to `uuidv7()` in the database, as Pigfarm's
do, including Better Auth's tables and the tables that replace `staff`. Production and local data
are test data only, so the owner approved dropping everything (4 November 2026): the migrations are
replaced by one new baseline, and the seed writes realistic invented businesses, people and sales
in place of `admin@example.com` and `Sim Manager`. Add `Business` (name, logo key, status; the logo stored as ADR-0009 says), `Venue.businessId` (required; drop `operatorId`),
`Venue.region` (one of Tanzania's 31 regions, a closed list in `@hashifi/types`, chosen, never typed) and
`Venue.area` (the area or street, typed), so analytics and onboarding travel group venues exactly,
`Membership` (user id, scope `platform` or `business`, business id when business, role `owner`,
`manager` or `operator`, status; unique per user and scope), the session's active membership (a
column on Better Auth's session through its additional fields, or `session_memberships`, whichever
Better Auth supports cleanly), `MembershipVenue` (membership, venue), `Invitation`
(email, scope, business, role, venues, invited by, expiry, accepted at), and packages owned by a
business with an optional venue list (`PackageVenue`), plus `PlatformDefaultPackage`. The seed creates the
platform owner, the default packages and sample businesses. `Staff` is renamed `Membership` in the same release
(pre-deployment compatibility: no alias).

**M2, access.** `apps/api/src/access/policy.ts`: actions as a closed union (`venue.read`,
`voucher.print`, `package.price.set`, `member.invite.manager`, ...), each mapped to the least role per
scope and whether it is owner-only. `Principal` is built from the session's active membership: membership id, scope, business id,
role and venue ids. `POST /api/me/membership` switches it (only to one of the person's own,
audited); `GET /api/me` lists the person's memberships for the account menu. A new session opens in the
workspace used last if that membership is still active, otherwise the highest-authority active one
(ADR-0011, 7); each membership records when it was last used. `venueScope(principal)` returns `{}` for platform roles, `{ businessId }` for a business
owner, and `{ businessId, id: { in: venueIds } }` otherwise. `@Can(action)` replaces `@Roles`. The
guard enforces the authenticator app for platform roles, owners and managers (ADR-0011, 9).

**M2 also adds passkeys.** Better Auth's passkey plugin (`@better-auth/passkey`, as ntumie.) joins
its two-factor plugin. Sign-in: email, then a choice of passkey (complete on its own) or an emailed
code; after a code, the authenticator code for platform roles, owners, managers and anyone who turned
it on (ADR-0011, 9); a recovery code signs in on its own. A required authenticator not yet set up is
set up after the email code, then recovery codes are shown once. The email field offers passkey
autofill (WebAuthn conditional UI). WebAuthn
needs HTTPS, so local development uses `localhost`. Tests: a platform membership without an
authenticator reaches only its set-up routes; a recovery code signs in once and removes nothing.

**M3, people.** Invitations are the single way in, as Pigfarm's (its ADR-0012): one role to one
canonical email. Kinds: a platform role; ownership of a new business; a business role with venues.
Issuing creates no person, business or venue, only the invitation, its token digest, the email and
the audit row. The link carries a single-use token in the URL fragment, valid 72 hours; at most one
pending invitation per email and target, and inviting again supersedes it. Accepting is one screen and
one transaction: the invitee gives their full name and, for a new business, its name, first venue and
area and town; the email is never a field. Acceptance creates or resolves the person, the business,
its venue, default packages and owner membership, or the membership and venues, then marks the
invitation accepted. It never signs in: the screen goes straight to an email code, as ordinary
sign-in. Platform staff "Invite a business" from Businesses with only the owner's email; pending
invitations show there with Resend and Revoke. Team pages list people and pending invitations
together. The owner's Business profile page sets the logo. Every change audited.

**M4, packages.** Business packages seeded from the platform defaults on creation; venue-limited
packages for managers; CSV import: parse, validate (name, duration such as `1h`, `24h`, `7d`, devices,
price in TSh, venues as `all` or names), return a preview of adds and updates, apply on confirm; no
deletes.

**M5, business profile.** The business's name and logo (owner only), the logo through the same
checks and store as venue brands, and the portal's fallback (venue, business, HashiFi) served by
the guest brand route. The screens are H2, H5 and H6 of [redesign-admin.md](redesign-admin.md).

**M2 also rebuilds the audit log** (ADR-0012): `audit_logs` with actor, business, venue, typed
action, category, target, outcome and bounded before/after, written in the change's transaction;
`GET /api/audit` scoped by the principal with search, action, dates, read events and a cursor.
Tests: a manager never sees another venue's rows; a failed audit write rolls the change back.

**M2 also returns capabilities.** `GET /api/me` answers the person, their memberships and, for the
active one, the actions it allows, so the web draws navigation and buttons from them.

## Concrete Steps

From the repository root: `bun run db:migrate` (M1), `bun run verify`, `bun run test:integration`.

## Validation And Acceptance

- Integration tests per role and scope: for each of the seven memberships (three platform, owner,
  manager, operator, and a manager of another business), every scoped route answers its data, not
  found, or forbidden as the policy says; a guessed id from another business is not found.
- Invitation tests: no one invites a role at or above their own, or to a venue they do not hold;
  issuing creates nothing but the invitation; acceptance creates the business, venue and owner in one
  transaction and no session; a forwarded link cannot sign anyone in; inviting an existing user adds a
  membership; expiry, supersession and revocation work; the audit log records each.
- Switching tests: a person with a platform and a business membership sees only the active one's
  data; switching to a membership that is not theirs is refused; each switch is audited.
- CSV import tests: a valid file previews then applies; a bad row names its line and nothing is saved.
- Live: a test business in production walks the Purpose's story end to end.

## Idempotence And Recovery

The new baseline starts from an empty database. Before dropping production's, the backup runner's
latest snapshot is confirmed in R2.

## Artifacts And Notes

Design reference: round 3 of the Hearth review, each role's view, in git-ignored
`ref/hearth-design/round-3-roles/`. This plan and ADR-0011 stand without it.

## Interfaces And Dependencies

`Principal` and `Capabilities` in `@hashifi/types` are the contract between the API and the web; the
web renders navigation and actions from capabilities, never from role names.
