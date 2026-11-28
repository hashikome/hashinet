# Deployment

Every push to `main` is verified, built into images and deployed, for as long as HashiNet is in
development. To make it manual, replace `push` with `workflow_dispatch` in
`.github/workflows/release.yml`.

Production is `hashinet.hashikome.com`: one host, on the shared Dokploy platform
([infra](https://github.com/hashikome/infra/blob/main/docs/dokploy-release.md)). Traefik sends
`/api/`, `/ws/`, `/webhooks/` and `/portal/hotspot-files/` to `hashinet-api`, and the rest to `web`.

## What a release does

1. `verify.yml`: formatting, lint, types, tests, builds, integration tests.
2. Images to GHCR, named by commit and digest.
3. The shared [`dokploy-release`](https://github.com/hashikome/actions/tree/main/dokploy-release)
   action, only when the repository variable `DEPLOY_ENABLED` is `true`, configured by
   `deploy/release.json`: runs the migration stack, waits for it to exit 0, then updates the
   application stack and waits until every service is healthy on exactly these images. A failed migration leaves the application as
   it was. A revision that has been superseded is refused.

## Preparing production

Once, before setting `DEPLOY_ENABLED`:

- Two Dokploy Stacks, raw source with auto-deploy off: `hashinet-xxxxxx` (`deploy/docker-stack.yml`)
  and `hashinet-release-xxxxxx` (`deploy/docker-stack.migrate.yml`), named in `deploy/release.json`,
  each with the inputs in
  the stack section of `.env.example`.
- A database and roles on the shared PostgreSQL, and the Docker secrets it names.
- DNS: `hashinet.hashikome.com` proxied, and `wg.hashikome.com` DNS-only, since Cloudflare's proxy
  does not carry WireGuard.
- Email sends from `no-reply@notify.hashikome.com` with the shared Hashikome Resend key, as Soko
  does; HashiNet holds it as its own Docker secret.
- In GitHub: an environment `production` with the secret `DOKPLOY_API_KEY`, and the variables
  `DOKPLOY_REGISTRY_ID` and `DEPLOY_ENABLED`.
- Uptime Kuma monitors on `/api/health` and `/join`.

Two things the rename to HashiNet taught (11 November 2026): Dokploy never changes a stack's
`appName`, so renaming means new stacks named in `deploy/release.json` and the old ones removed; and a
GitHub environment's own secret overrides the organisation's, so shared keys (`SERVER_SSH_KEY`,
`DOKPLOY_API_KEY`) live only at the organisation, shared with this repository.

The platform's first admin and the default packages are created with
`bun run platform:bootstrap --email <email> --name <name>` in the API image; it changes nothing on a
second run.

Mobile money and SMS need nothing here until their providers exist: add a provider's settings
(`SNIPPE_*`, `BRIQ_*`) and choose it with `PAYMENTS_PROVIDER` or `SMS_PROVIDER`
([ADR-0010](../engineering-decisions/0010-payments-and-sms.md)). BRIQ's dashboard takes the
delivery-report URL, `https://<host>/webhooks/sms/briq`; Snippe gets
`/webhooks/payments/snippe` with each charge.

## The management tunnel

The `hashinet-tunnel` service in the stack (`apps/tunnel`) is the platform's end of the routers' tunnels
([ADR-0006](../engineering-decisions/0006-router-management-tunnel.md)). It runs on the host's
network with `NET_ADMIN`, creates `wg0` at `10.88.0.1` and listens on `wg.hashikome.com:51820`, so the API needs
no capability: its traffic to a router leaves through the host and is masqueraded on `wg0`, and the
router sees the one address it accepts. Every 20 seconds it reads the peer list from
`/api/internal/tunnel-peers`, so adding or deleting a router needs no shell. Routers fetch their
portal pages from `10.88.0.1:8080`, which relays those paths and nothing else, and send every hotspot
login and session report by RADIUS to `10.88.0.1:1812-1813`, which it relays to
`/api/internal/radius` ([ADR-0015](../engineering-decisions/0015-voucher-online-limit-through-radius.md)).
All three calls (peers, portal pages, RADIUS) go to Traefik on the same host, `API_ADDRESS`
(`127.0.0.1:443`), never out through Cloudflare: TLS and the route still name `hashinet.hashikome.com`,
so the certificate is checked and Traefik routes them as any request, and a router's login is answered
without leaving the server, inside the 3 seconds it waits.

The host firewall is infra's (`infra/scripts/prepare-host.py`, an nftables table of its own): it
accepts everything that doesn't arrive on `eth0`, so `wg0` reaches the relay and RADIUS, and on an
`--open` server it accepts UDP 51820 from the internet. Nothing is set by hand. When a port is
blocked, the symptoms are:

- 51820: WireGuard receives nothing, and `wg show` on the service reports no handshake and 0 bytes
  received.
- 8080 on `wg0`: the tunnel connects and the API reaches routers, but routers time out fetching their
  pages from the relay.
- 1812-1813 on `wg0`: every new sign-in fails after the router's 3-second RADIUS timeout (6 seconds
  with its retry), and `/radius monitor` on a router counts timeouts and no accepts.
