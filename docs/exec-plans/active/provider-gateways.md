# Payment and SMS providers behind gateways

This ExecPlan is a living document. Maintain it according to `PLANS.md`.

## Purpose / Big Picture

The owner wants to move from one mobile money or SMS provider to another without changing the core
of the code (28 November 2026). Today the payments and SMS code already call two interfaces, but
Snippe and BRIQ leak around them: their webhook formats and signatures are read in the controller at
`/webhooks/snippe` and `/webhooks/briq`, their settings are parsed in `core/config`, which also
builds the adapters, Snippe's minimum amount sits in the guest context, and a payment doesn't
record which provider took it. After this plan, a provider is one file under
`sales/payments/providers/` or `sales/sms/providers/` that owns everything about it, and adding one
touches nothing else apart from its settings in `.env.example` and the deploy files.

## Progress

- [x] (2026-11-28) Design reviewed (advisor); ADR-0010 to widen in place.
- [x] (2026-11-28) Gateways, providers, the registry, the webhook routes, the migration
  (`20261128930000_provider_gateways`, backfilling development rows), the router sim.
- [x] (2026-11-28) Proof: verify (knip caught two needless exports); 235 integration tests (one
  new: only a provider set up here has a webhook); provider and choice unit tests; the route map
  differing only in the two webhook routes, with the payment, SMS and brand-store providers moved
  from the config module to their areas; the API booting with `fake` and `outbox`, and refusing
  `snippe` without its keys; `guest-test` 22/22 (it does not walk the paid path).
- [ ] Live: a real provider's charge and webhook, when its credentials exist (slice 6).

## Decision Log

- (2026-11-28) Every provider whose settings are present is built; `PAYMENTS_PROVIDER` and
  `SMS_PROVIDER` name the one that takes new charges and texts. A payment and a text record the
  provider that took them, and checks and webhooks go to that provider, so a switch strands
  nothing in flight (money that arrives late still counts, ADR-0010).
- (2026-11-28) Core keeps the rules: one transition to paid, TZS only, each event once (keyed by area
  and provider, since event ids are unique per provider only), delivered is final, access only
  after the router confirms. A provider owns its HTTP calls, status mapping, signature and replay
  window, number and amount formats, which amounts it takes, and its own settings, read through a
  generic reader that honours `<NAME>_FILE`.
- (2026-11-28) `FAKE_PROVIDERS` goes: the stand-ins are providers too (`PAYMENTS_PROVIDER=fake`,
  `SMS_PROVIDER=outbox`), refused in production. The provider's name never leaves the API (the copy
  rule): not in `@hashinet/types`, the records or the web.
- (2026-11-28) No interfaces for payouts or SMS credits until they are built.

## Validation And Acceptance

`bun run verify`; `bun run test:integration` at the same count or more, the payments tests posting
to the new routes and patching the active provider; the route map differs from before only in
`/webhooks/snippe` and `/webhooks/briq` becoming `/webhooks/payments/:provider` and
`/webhooks/sms/:provider`; the router sim's `guest-test` 22/22 with `PAYMENTS_PROVIDER=fake`.
