# Rename HashiFi to HashiNet, everywhere

This ExecPlan follows [PLANS.md](../../../PLANS.md). It is a living document: keep Progress, Surprises
& Discoveries, Decision Log and Outcomes current as work proceeds.

## Purpose / Big Picture

The product is now **HashiNet**, "The platform for running WiFi businesses." (ADR-0016). The owner asked on 11 November 2026 for the name to change everywhere: the product
and its copy, the repository, the deployment, its secrets and volumes, and every identifier that says
`hashifi`. When this plan is done, nothing a person, an operator or a machine reads says HashiFi
except the written history (past CHANGELOG entries, the dated text of accepted ADRs, applied
migrations), and HashiNet serves at `hashinet.hashikome.com`.

## Progress

- [x] (2026-11-11) Owner's answers: `hashinet.hashikome.com`, the old host dropped with no redirect; a
  new database and role with the data copied over, the old kept read-only until checked; current
  docs only, history keeps its name; routers' management interface renamed, adopting the old name
  when a router's setup script runs again.
- [x] (2026-11-11) Stage 1, in this repository: copy, code, packages, docs, file names, local
  development, and the git-ignored prototype. `bun run verify` passes (245 API tests), and
  `bun run test:integration` passes against `hashinet_test` (123). The router simulator was not run.
- [x] (2026-11-11) Stage 2, in this repository: the deployment manifest (`deploy/`, the release
  workflow), with the database secrets at version `hashinet_*_20261111_v1`. Its own commit, which
  **must not reach `main` on GitHub before stage 3 is done**: every push to `main` releases. If the
  owner creates the secrets on another day, change the date in `deploy/release.json` and
  `deploy/docker-secrets.json` to match.
- [ ] Stage 3, by the owner, outside the repository (see Concrete Steps).
- [x] (2026-11-11) Stage 4, in other repositories, current docs only: handbook `55d0f88` (the
  chapter moves to `docs/hashinet/`; source and site checks pass), workspace `0640684`, ntumie
  `280d0d8`, pigfarm `34c2892`. Left: workspace `backlog/README.md` and `brand/README.md`, which
  hold another session's uncommitted edits; infra, whose backup job changes at the cutover (stage 3,
  step 8); completed workspace plans, which are history.
- [ ] Stage 5: push, release, check, then retire the old database, volume, secrets and bucket with the
  owner's go.
- [ ] Stage 6, by the owner: rename the local folder and move Claude's memory directory with it.

## Surprises & Discoveries

- Routers carry one name of ours: the WireGuard management interface `hashifi-mgmt`
  (`apps/api/src/services/router-provision/tunnel.ts`). Provisioning tags its other objects
  `wbs:<step>`, which do not change. The router API user is per router (`routers.api_username`); only
  the default offered for a new router changes.
- The portal's default brand name is stored (`portal_settings.brand_name`), so a migration moves an
  unchanged `HashiFi` to `HashiNet`, as `20261104090000_hearth_portal_defaults` did for colours.
- The R2 bucket cannot be renamed: a new `hashinet` bucket, a copy of the objects, and a new key
  limited to it.
- `infra/backup/jobs.production.json` backs up the database `hashifi` as `hashifi-postgres`; it changes
  at the cutover, not before, or backups stop.
- Image paths: the release workflow derives them from `github.repository`, but
  `deploy/release.json` names `ghcr.io/hashikome/hashifi/*`; both must agree after the repository
  rename.

## Decision Log

- Casing: `HashiNet` in prose and copy; `hashinet` for identifiers, packages (`@hashinet/*`), hosts,
  services (`hashinet-api`), databases and secrets; `HASHINET` where upper case was used.
- History is not rewritten: past CHANGELOG entries and accepted ADRs' dated wording stay; applied
  migrations are never edited (AGENTS.md). Active plans and current docs are renamed.
- No compatibility kept (pre-deployment policy): the old host is dropped, browser storage keys and the
  log category change, sessions may need signing in again.
- The database is copied, not renamed in place: nothing is lost if a step fails, and the old one stays
  read-only until the owner checks the new one.
- `compose.yml` names its project `hashinet`, so local resources no longer depend on the folder name.

## Outcomes & Retrospective

To fill in at the end.

## Context And Orientation

`hashifi` appears in about 170 tracked files: product copy in `apps/web` and `apps/api`, the
`@hashifi/*` workspace packages (`package.json` files and every `@hashifi/types` import), the log
category, development defaults (`compose.yml`, `.env.example`, `apps/api/prisma.config.ts`,
`tooling/router-sim.ts`, integration tests), the deployment (`deploy/docker-stack*.yml`,
`deploy/release.json`, `deploy/docker-secrets.json`, `.github/workflows/`), and the docs. Two files are
named after it: `apps/web/components/hashifi-mark.tsx` and `docs/exec-plans/active/build-hashifi.md`.

## Plan Of Work

Stage 1 replaces names with explicit case maps, never one case-insensitive pass, and skips
`apps/api/prisma/migrations/**`, `bun.lock` (regenerated by `bun install`), `ref/`, past CHANGELOG
entries and the dated history inside accepted ADRs. It renames the two files and fixes their links,
adds the brand-name migration, and teaches the router setup script to rename a `hashifi-mgmt` interface
to `hashinet-mgmt` when it finds one (the interface name appears nowhere else on a router). It adds ADR-0016 and a CHANGELOG entry.

Stage 2 renames the services, Traefik labels, stack patterns, image paths, secret names (new date
versions) and `PUBLIC_HOST` in `deploy/` and the workflows.

## Concrete Steps

Stage 3, by the owner, in this order:

1. Rename the GitHub repository `hashikome/hashifi` to `hashikome/hashinet`, then
   `git remote set-url origin git@github.com:hashikome/hashinet.git`.
2. DNS: `hashinet.hashikome.com` to the server; Traefik issues its certificate on first request.
   Remove `hashifi.hashikome.com` after the cutover.
3. Database, on `infra-postgres`: create role `hashinet` and database `hashinet` (and the migration
   role the current setup uses); restore a fresh backup of `hashifi` into it; make `hashifi`
   read-only (`ALTER DATABASE hashifi SET default_transaction_read_only = on`).
4. Docker secrets with today's date version, values never in the repository:
   `hashinet_database_url_YYYYMMDD_v1`, `hashinet_migration_database_url_YYYYMMDD_v1`, and the
   `hashinet_*` names in `.env.example` for the encryption key, auth, Resend, R2, tunnel and Sentry.
   Values other than the database URLs and R2 key may be copied from the current secrets.
5. R2: create bucket `hashinet`, copy every object from `hashifi`, create a key limited to `hashinet`.
6. Dokploy: rename (or recreate) the application and release composes so their stacks match
   `hashinet-*`, and set the env file's `PUBLIC_HOST`, `R2_BUCKET`, `EMAIL_FROM` and `*_SECRET` names.
7. Resend sender name, the SMS sender ID (registered with the SMS provider before it changes), and the
   Sentry project name.
8. Infra: rename the backup job to `hashinet-postgres` on database `hashinet`, with its Kuma monitor.

Stage 6, by the owner, when no session is open in the folder:

    mv ~/Person/stack/hashikome/hashifi ~/Person/stack/hashikome/hashinet
    mv ~/.claude/projects/-home-ns-Person-stack-hashikome-hashifi ~/.claude/projects/-home-ns-Person-stack-hashikome-hashinet

`mv` keeps the git-ignored `prototypes/` and `ref/`; a fresh clone would lose them. Then change
`hashikome/hashifi` to `hashikome/hashinet` in `~/Person/stack/docs/local-port-registry.md`, and
remove the old local volume with `docker volume rm hashifi_postgres-data`.

## Validation And Acceptance

- `git grep -i hashifi` lists only the CHANGELOG's past entries, accepted ADRs' history, applied
  migrations and this plan.
- `bun run verify` passes; `bun run test:integration` passes against `hashinet_test`.
- `bun run router-sim` provisions a simulated router with a `hashinet-mgmt` interface, and running
  a router's setup script again renames a `hashifi-mgmt` interface instead of adding a second tunnel.
- After release: `https://hashinet.hashikome.com/api/health` answers, the admin signs in, a voucher
  redeems on the simulator, brand images load from the new bucket, and the backup job reports.

## Idempotence And Recovery

Stages 1 and 2 are commits and can be reverted until pushed. The cutover keeps the old database,
secrets and bucket untouched until the owner retires them, so a failed release fixes forward on the
new names (the network memory: never restore old names in `deploy/release.json`), and the data is
still in `hashifi` if the copy needs repeating.

## Artifacts And Notes

The local development volume `hashifi_postgres-data` is left alone; the new `hashinet_postgres-data`
starts empty and is prepared with `bun run db:deploy` and `bun run db:seed` (invented data only). The
old one can be removed with `docker volume rm hashifi_postgres-data` once nothing needs it.

## Interfaces And Dependencies

Packages `@hashinet/api`, `@hashinet/web`, `@hashinet/types`, `@hashinet/tunnel`. Services
`hashinet-api`, `hashinet-web`, `hashinet-tunnel`, `hashinet-migration`. Host `hashinet.hashikome.com`.
Database and role `hashinet`; test database `hashinet_test`; router management interface
`hashinet-mgmt`.
