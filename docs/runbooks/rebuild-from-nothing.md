# Rebuild from nothing

Use it when HashiNet must come back on a new server, or on an empty database, with nothing kept but
the code, `hashikome/secrets` and the backups. Every step points at the source that owns it; nothing
that matters may exist only because someone ran a command by hand
([infra's rebuildable server](https://github.com/hashikome/infra/blob/main/docs/rebuildable-server.md)).

Prerequisites: the operator's access to `hashikome/secrets`, the server (`hs`), Dokploy, GitHub,
Cloudflare and Google Cloud, as infra's documents describe.

## Steps

| # | What | Source | Codified |
| --- | --- | --- | --- |
| 1 | The server: Dokploy, the deploy user, network, volumes, shared Docker secrets, PostgreSQL, Redis and backups | infra's rebuildable server, steps 1–4 | yes |
| 2 | The host firewall for the management tunnel: `51820/udp`, and `wg0` to `10.88.0.1:8080/tcp` ([deploy.md](deploy.md), the management tunnel) | infra's server bootstrap | **no**: run by hand with `sudo` today |
| 3 | The database `hashinet`, its roles `hashinet_migrator` and `hashinet_runtime`, their grants and default privileges | `infra/deploy/data-services/allocate-hashinet.sql`, over the administrator's stdin with the two passwords from `hashikome/secrets` | yes |
| 4 | HashiNet's Docker secrets, by the versioned names in `deploy/release.json` and `.env.example` | `hashikome/secrets`; the release creates the missing ones | yes |
| 5 | The Dokploy stacks `hashinet-xxxxxx` and `hashinet-release-xxxxxx`, with the inputs in `.env.example` ([deploy.md](deploy.md)) | infra's rebuildable server, milestone 2 | **no**: made in Dokploy; their IDs are in `deploy/release.json` |
| 6 | GitHub's `production` environment: `DOKPLOY_REGISTRY_ID`, `DEPLOY_ENABLED` and the organisation's shared secrets | infra's OpenTofu plan, M1 | **no**: set by hand |
| 7 | DNS: `hashinet.hashikome.com` proxied, `wg.hashikome.com` DNS-only | infra's OpenTofu plan, M3 | **no**: Cloudflare dashboard |
| 8 | The R2 bucket for venue logos and backgrounds, and its scoped key (its two Docker secrets) | infra's OpenTofu plan, M3 | **no**: Cloudflare dashboard |
| 9 | A release: push `main` (or re-run its last release). The migration stack applies every migration, including the one that keeps the runtime role off `_prisma_migrations`; the application stack follows | `.github/workflows`, `deploy/` | yes |
| 10 | Data: restore the latest `hashinet-postgres` snapshot, then re-apply step 3; or, on an empty start, `bun run platform:bootstrap --email <email> --name <name>` in the API container | infra's restore workflow (milestone 3); `apps/api/src/platform/bootstrap.cli.ts` | restore: **no** (milestone 3); bootstrap: yes |
| 11 | Monitors: Uptime Kuma on `/api/health` and `/join` | workspace's Kuma task | **no**: made by hand |
| 12 | Routers: restored data keeps their tunnel keys and they reconnect by themselves; on an empty start, set each one up again from its venue's router page ([router-onboarding.md](router-onboarding.md)) | HashiNet | yes |

## Confirm

- `https://hashinet.hashikome.com/api/health/ready` answers 200, and `/join` loads.
- The runtime role has no rights on `_prisma_migrations`:
  `SELECT privilege_type FROM information_schema.table_privileges WHERE table_name = '_prisma_migrations' AND grantee = 'hashinet_runtime'` returns no rows.
- An admin signs in; each router page shows its router serving after its setup.

## Order

Steps 1 to 8 in any order the sources allow, then 9, 10, 11 and 12. The rows marked **no** are the
gaps: each names the plan that closes it, and the table is updated as they close.
