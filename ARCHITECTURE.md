# Architecture

The stable system map. Evolving detail belongs in [docs/design-docs/](docs/design-docs/README.md).
The [build plan](docs/exec-plans/active/build-hashinet.md) tracks what is left to build.

## Purpose

Grant WiFi access only as a paid or issued voucher allows, enforced by the venue's router,
with a cloud backend that is the single authority for venues, packages, vouchers and
sessions.

## System shape

```text
guest phone ── venue WiFi ── MikroTik hotspot ──► ISP router ──► internet
                                  │   ▲
           portal redirect        │   │ RouterOS API over a router-initiated tunnel
                                  ▼   │
dashboard browser ──► apps/web (Next.js: dashboard + captive portal)
                         │
                         ▼
                  apps/api (NestJS on Bun) ──► PostgreSQL 18 (shared platform)
```

- The MikroTik intercepts unauthenticated guests and redirects them to the portal; the
  walled garden lets the portal host through before login, and the web proxies the guest API on
  it ([ADR-0008](docs/engineering-decisions/0008-captive-portal.md)).
- The API reaches each router over a tunnel the router opens to the platform, because routers
  sit behind NAT. The tunnel design is [ADR-0006](docs/engineering-decisions/0006-router-management-tunnel.md).

## Codemap

| Path | Responsibility |
| --- | --- |
| `apps/api` | NestJS API on Bun, grouped into eight areas under `src/` (below), each a folder of feature modules; `main.ts`, `entrypoint.ts` and `app.module.ts` only start it: business rules, authorization, router provisioning and sync, background jobs, persistence (Prisma, `prisma/schema.prisma`) |
| `apps/api/src/core` | What every area uses, importing none of them: validated configuration and secrets (`config`), the Prisma client (`database`), sign-in with Better Auth, email codes, passkeys and authenticator codes, and which factors a change accepts (`auth`), HTTP plumbing (`http`), telemetry and wide events (`observability`), interval jobs (`jobs`), `crypto`, `email`, `health`, IPv4 arithmetic (`net`), the access policy (`access`: one table of actions per role, rank, and what a business's service access allows), the audit log and its filters (`audit`), business days (`time`), phone numbers, and the record conventions with the plain records (`records`) |
| `apps/api/src/people` | Who works where: a person's own account and sign-in protection (`account`), the people of each workspace (`team`), and joining by invitation (`invitations`) |
| `apps/api/src/platform` | HashiNet running businesses. `billing`: what businesses pay HashiNet (ADR-0013): fee terms and where to pay, the fee rules (`fee.ts`), invoices issued once a month and on a package's confirmation (`invoices.ts`), payments allocated to invoices, reminders and each owner's bill issue (`bill-reminders.ts`), what Billing shows (`billing-accounts.ts`), and service access by bills or by hand (`access-rule.ts`, `service-access.ts`, ADR-0014). `issues`, `onboarding`, `businesses`: issues per workspace (claimed, handed, taken over by rank, every step logged; router issues kept in step with the routers), a venue's way to serving (its package, then its setup), and the businesses as HashiNet's team sees them, guests as counts only. `bootstrap`: the first admin and the default packages |
| `apps/api/src/venues` | What a business sells and where: venues and each venue's page (`venues`), its sites open before paying (one free, each more a slot invoiced once and opened when paid, pushed to its routers: `sites`), a business's ways to pay and each venue's choice (`payment-ways`), and packages (`packages`): the business's, sold at every venue at its price unless a venue has its own or stopped selling one (`on-sale.ts`, the one rule), and a venue's own |
| `apps/api/src/sales` | Selling access: a sale makes its voucher (ADR-0017), refunds and release, and mobile money behind its gateway, each provider one file in `payments/providers/` (`payments`); voucher codes, their devices and expiry (`vouchers`); devices blocked per business (`devices`); live sessions (`sessions`); texts and their delivery reports, each provider one file in `sms/providers/` (`sms`) |
| `apps/api/src/guest` | What a guest meets: signing a device in, its switch PIN and the guest context (`sign-in`), the captive portal copied down (`portal`, `copy-down.ts`): the platform's content and themes start a business's, which starts each venue's; each venue's and business's logo (`logos.ts`: re-encoded, stored, served on the portal's origin, swept when unreferenced); the business profile; the guest context the portal and the editor's preview share (`guest-context.ts`) |
| `apps/api/src/network` | The routers: the live view's WebSocket hub (`live`), their records and journey (`routers`), the management tunnel's addresses and peers (`tunnel`), provisioning and its dialects, setup versioned so a release's routers are set up again (`provisioning`), the RouterOS client (`mikrotik`), and the live monitor, `RouterSync` and outages (`monitor`); `radius` answers every hotspot login and session report from the routers, relayed by the tunnel service (ADR-0015): the RADIUS codec, who may be online on which voucher, accounting into sessions |
| `apps/api/src/analytics` | Periods decided by the API (`period.ts`), and the reports over them (`reports.ts`): sales from `revenue_events`, usage from sessions, sales across businesses with HashiNet's fees; a business's day and Payments' received list |
| `apps/web` | Next.js: sign-in and invitations, the dashboard (a business's and HashiNet's team's), Account and security, Help, and the captive portal; screens built from `prototypes/hearth-design/prototype/` on its stylesheet (`app/hearth.css`); building blocks in `components/ui/`, the app's frame in `components/app/`, and each area's components in `components/<area>/`, named as the API's areas; the guest portal, shared by `/join` and the editor's preview, in `components/guest/portal/` |
| `packages/types` | The API's JSON contract, shared by the API and the web: one file per API area (`core.ts` … `analytics.ts`), `index.ts` its entry |
| `tooling/router-sim/` | A virtual MikroTik, guest and tunnel hub for testing against real RouterOS: settings and saved state (`sim.ts`), the VM and its serial console (`vm.ts`), onboarding, setup and verify, the guest VM, the guest test, the hub, and the commands (`main.ts`) |
| `docs/` | Design documents, decisions, plans and runbooks |

## Dependency rules

- The web reaches data only through the API; it never imports Prisma or API internals.
- Prisma rows leave the API only as `@hashinet/types` records, mapped by a records function
  (`src/core/records`, or an area's own `*-record.ts` built on its helpers).
- `src/core` imports no area; areas import `core` and each other.
- Only the API talks to routers.
- Router-specific behaviour lives in the provisioning dialect, nowhere else.

## Runtime

- One API service with background jobs, every minute unless noted: voucher expiry, router issues
  kept in step with the routers, venues' setups closed by their first guest, payments whose report
  never came, and hourly (and at start) routers an older setup left set up again.
- The tunnel service relays the routers' RADIUS to the API; the API answers from the database.
- Live session and provisioning updates reach the admin over a WebSocket.

## Deployment shape

GitHub CI verifies, builds and pushes immutable images to GHCR; Dokploy deploys them in
Docker Swarm stack mode. The server never builds application images. PostgreSQL is a
database on the shared platform instance, allocated by the infra repository.

## Invariants

- The API owns business logic and workflows; the web presents
  ([ADR-0003](docs/engineering-decisions/0003-api-owns-logic-web-presents.md)).
- Access is reported only after the router confirms it.
- A voucher code is never returned to a client that has not proved it holds it.
- Every venue has its onboarding from the moment it exists, and a router is added only to a venue
  whose setup is scheduled; no venue serves a guest until its business's owner has protected their
  sign-in.
- HashiNet's team sees a business's guests only as counts; a platform operator reaches only what
  is handed to them.
