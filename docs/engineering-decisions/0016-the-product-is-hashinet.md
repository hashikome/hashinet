# ADR-0016: The product is HashiNet

Status: accepted, 11 November 2026.

## Context

The product began as HashiFi, Paul's answer to letting guests onto his home WiFi and remembering to
take them off again. It has grown into software and setup for businesses that sell WiFi across their
venues, with platform, business and venue roles (ADR-0011). The owner chose a name for that product:
**HashiNet**, with the tagline "The platform for running WiFi businesses."

## Decision

1. **The product is HashiNet** in everything a person reads, and `hashinet` in everything a system
   reads: the repository `hashikome/hashinet`, the host `hashinet.hashikome.com`, packages
   `@hashinet/*`, services `hashinet-*`, the database and role `hashinet`, secrets `hashinet_*`, the
   R2 bucket `hashinet`, and the routers' management interface `hashinet-mgmt`.
2. **Guests still see the venue.** HashiNet is not the guest-facing brand; the captive portal and
   printed vouchers carry the venue's identity (ADR-0009), with "Runs on hashinet" as the signature.
3. **No compatibility.** The old host is dropped, not redirected; nothing reads the old names once the
   cutover is done (AGENTS.md, pre-deployment compatibility).
4. **Data moves by copy, not rename.** Production's database is restored into a new `hashinet`
   database, and the old one stays read-only until the owner checks the new one and retires it.
5. **History keeps its name.** Past CHANGELOG entries, the dated text of earlier ADRs and applied
   migrations say HashiFi, as they did when written.

## Consequences

- A router set up under the old name keeps working, and running its setup script again renames its
  `hashifi-mgmt` interface instead of adding a second tunnel.
- The rename crosses GitHub, DNS, Dokploy, Docker secrets, PostgreSQL, R2, Resend, the SMS sender ID,
  Sentry and the infra backups; the steps and their order are in
  [rename-to-hashinet](../exec-plans/active/rename-to-hashinet.md).
