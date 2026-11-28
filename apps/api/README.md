# @hashinet/api

The HashiNet API: venues, routers, packages, vouchers, sessions, analytics and the captive
portal, plus the MikroTik provisioning that makes them real on a router.

NestJS on Bun with Prisma and PostgreSQL 18; the
[build plan](../../docs/exec-plans/active/build-hashinet.md) tracks the port.

## Commands

From the repository root (`bun run verify` runs everything CI runs), or here:

| Command | What it does |
| --- | --- |
| `bun run dev` | Watch mode on `src/entrypoint.ts` (port 4006) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | The `*.test.ts` files beside the code |
| `bun run test:integration` | Over HTTP against PostgreSQL (`test/integration/`) |
| `bun run db:migrate` | Creates and applies a migration |
| `bun run db:seed` | Seeds the prototype's people, businesses and venues (example.com) |
| `bun run platform:bootstrap --email … --name …` | Makes HashiNet's first admin and the default packages; everyone else arrives by invitation |

Copy the root `.env.example` to `apps/api/.env` and set `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.
`ENCRYPTION_KEY` seals router credentials at rest: changing it makes them unreadable.

## Layout

```
src/
  entrypoint.ts, main.ts   telemetry, then the Nest application and its middleware
  auth/                    Better Auth, the staff guard, venue scope
  venues/ routers/ packages/ vouchers/ sessions/ devices/
  analytics/ portal/ team/ audit/
  live/                    the /ws/live hub
  http/                    error shape, wide events, origin check, validation
  network/
    mikrotik/              the RouterOS API client
    provisioning/          everything that configures a router
    monitor/               the live monitor, RouterSync and outages
    radius/                every hotspot login and session report
mikrotik-files/            login.html, alogin.html and status.html uploaded to routers
```

Router procedures are in [docs/runbooks](../../docs/runbooks/README.md).

The tests pin the code where expensive bugs have lived: the generated bootstrap script (every
statement at most 512 characters and self-contained), hotspot interface resolution, per-board
command differences and the capability latch. Read the repository's
[AGENTS.md](../../AGENTS.md) before changing `network/`.
