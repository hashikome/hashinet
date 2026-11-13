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
| `apps/api` | NestJS API on Bun: business rules, authorization, router provisioning and sync, background jobs, persistence (Prisma, `prisma/schema.prisma`) |
| `apps/api/src/services`, `routers`, `vouchers` | Router provisioning and dialects, `RouterSync`, `LiveMonitor`, tunnel allocation, voucher expiry and reconciliation |
| `apps/api/src/access`, `team`, `invitations` | The access policy (one table of actions per role), rank, sign-in protection, and the people of each workspace by invitation |
| `apps/api/src/issues`, `onboarding`, `businesses` | Issues per workspace (claimed, handed, taken over by rank, every step logged; router issues kept in step with the routers), a venue's way to serving (its package, then its setup), and the businesses as HashiNet's team sees them, guests as counts only |
| `apps/api/src/observability`, `jobs`, `config` | Telemetry and wide events, interval jobs, validated configuration and secrets |
| `apps/api/src/serializers` | Database rows to `@hashinet/types` records: the only place Prisma types become API shapes |
| `apps/web` | Next.js: sign-in and invitations, the dashboard (a business's and HashiNet's team's), Account and security, Help, and the captive portal; screens built from `prototypes/hearth-design/prototype/` on its stylesheet (`app/hearth.css`) and building blocks (`components/hearth/`) |
| `packages/types` | The API's JSON contract, shared by the API and the web |
| `tooling/router-sim.ts` | A virtual MikroTik, guest and tunnel hub for testing against real RouterOS |
| `docs/` | Design documents, decisions, plans and runbooks |

## Dependency rules

- The web reaches data only through the API; it never imports Prisma or API internals.
- Prisma rows leave the API only through `src/serializers`, as `@hashinet/types` records.
- Only the API talks to routers.
- Router-specific behaviour lives in the provisioning dialect, nowhere else.

## Runtime

- One API service with background jobs, every minute unless noted: voucher expiry and
  reconciliation of anything the router has not confirmed, router issues kept in step with the
  routers, venues' setups closed by their first guest, and payments whose report never came.
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
