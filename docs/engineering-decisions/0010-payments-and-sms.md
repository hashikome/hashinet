# ADR-0010: Payments, vouchers and SMS

Status: accepted, 31 October 2026, as proved against test doubles and the router sim. Held: HashiFi
launches with sales at the counter (ADR-0017), and this turns on with the providers' credentials. Real mobile money
and SMS have not run yet. ADR-0013 makes SMS something a business buys, so point 7 applies only to a
business with credits. Narrowed 14 November 2026: ADR-0017 replaces point 6 (a voucher exists only by
its sale; there is no printed stock). Widened 28 November 2026: point 8, a provider is one
file, chosen by name, and a switch strands nothing in flight; point 9 follows.

## Context

Self-service purchase is the default way in. Money is the one place a bug costs a guest something,
and three things can finish a payment at the same moment: the provider's webhook, a guest's waiting
screen and the reconcile job. The earlier code checked and then inserted, kept the voucher code in
a payment's metadata, deduplicated events in that same metadata, and returned the code to anyone
holding a payment id.

## Decision

1. **One transition.** `PaymentsService.complete` moves a payment from pending to paid and makes
   its voucher in one transaction, under a row lock, so one payment is one voucher. A provider's
   event is written to `webhook_events` in that transaction, so a repeat does nothing. A late
   failure never walks back a paid payment; money that arrives after a failure still counts. An
   amount or currency that does not match grants nothing, and leaves the payment for a person.
2. **Paid is not online.** `settle` runs after the commit and is safe to repeat: the code goes out,
   the router confirms the voucher (`router_provisioned_at`), and the paying device is signed in
   by the same `GuestService.admit` a typed code uses. What fails waits for the reconcile job,
   shown as access owed. Router work never delays the provider's 2xx.
3. **The code goes to the session that paid.** Starting a payment returns a random secret once,
   and only its hash is stored. Status needs that secret, so a payment id shows nothing, and no
   metadata holds the code. The browser keeps the secret in its tab, so a reload finds the receipt.
4. **Nothing prompts a phone until everything is checked:** a registered router, a package on sale
   there, a payable price, a device not blocked, a device the router can see, and limits per
   number, device and address. The address limit is high because a venue shares one public
   address, and it relies on `TRUSTED_PROXIES`, which production requires: without it every guest
   would look like the web proxy. A router that cannot be asked does not stop a purchase: the
   payment waits, as access owed.
5. **Webhooks are proved over the exact bytes.** Payment reports are signed over the timestamp and
   body, and refused 300 seconds out. SMS reports have no timestamp, so the event id alone stops a
   replay. Bodies never reach a log, because they hold a customer's number.
6. **Assisted sales prompt nobody.** A counter sale is made by a seller with the money in hand, for
   cash or mobile money to the venue's own number, and makes its voucher (ADR-0017). Nothing prompts
   the guest's phone.
7. **SMS cannot strand a guest.** A message is sent once per payment, and its text is not kept.
   One nobody reports on becomes `unconfirmed` at 10 minutes. The screen always has the code.
8. **Providers sit behind interfaces** (`MobileMoneyGateway`, `SmsSender`), and each is one file
   under its area's `providers/` (`sales/payments/providers/`, `sales/sms/providers/`) that owns
   everything about it: its API calls, its statuses, its webhook format, signature and replay
   window, the amounts it takes, and its own settings, read through a reader that honours
   `<NAME>_FILE`. Core keeps the rules: one transition to paid, TZS only, each event once (keyed by
   area and provider, `payments:snippe`, since event ids are unique per provider only), delivered is
   final, access only after the router confirms. Every provider whose settings are set is built;
   `PAYMENTS_PROVIDER` and `SMS_PROVIDER` choose the one that takes new charges and texts. A
   payment and a text record the provider that took them (`gateway`), and checks and webhooks
   (`/webhooks/payments/:provider`, `/webhooks/sms/:provider`) go to that provider, so switching
   strands nothing in flight: money that arrives late still counts. Adding a provider touches
   nothing outside its file, its line in the area's `providers/index.ts` and its settings. The
   provider's name never leaves the API (guests and staff read "mobile money"). Rejected: one
   provider at a time, which would leave payments pending at a switch until they expired. No
   background queue: PostgreSQL holds the state, so `IntervalJob` is enough.
9. **Held until set up.** Mobile money is on when a provider is chosen, and SMS likewise; half a
   provider's settings, or a chosen one without them, stops startup. While off, guests see the voucher form and a price list, staff
   see no Payments, and `POST /api/guest/payments` and `/api/sales` answer 503. Nothing here was
   built as a fake door: a button that does nothing is the wrong thing to show someone trying to
   get online. The stand-ins are providers too (`PAYMENTS_PROVIDER=fake`, `SMS_PROVIDER=outbox`),
   and production refuses them, so no real guest can ever reach the fake gateway.

## Evidence

`payments.integration.test.ts` (21 tests): checks before a prompt, limits, forged, unsigned, stale
and replayed reports, odd whitespace in a signed body, concurrent completion, wrong amounts, late
failures, lost webhooks, a router that was down, failing SMS, another session, an address that moved
during approval, a voucher that ended, stuck payments, manager scope and revenue. The real adapters
run against stand-in servers (`mobile-money.test.ts`, `sms-sender.test.ts`), which pins what they
send and read. `router-sim guest-test`: a purchase through the walled garden brings the paying device
online. Walked in a browser on the fake gateway: buy, approve, receipt, reload, a second session, a
missed prompt, a decline, buying again after a voucher ended, a staff sale.

## What remains open

- **Neither provider has been called for real.** Contracts come from their documents of 31 October.
- **Snippe:** whether a test mode exists; whether the fixed `customer.email` is accepted; whether
  `webhook_url` must be HTTPS. The earlier code recorded a live account ending approval at about 10 minutes,
  where the documents say 4 hours, so a guest may wait on a prompt that has gone.
- **BRIQ:** the send returns `job_id` and delivery reports name `message_id`, and the documents do
  not say how they link. Messages match on either; the rest end `unconfirmed`. A sender ID needs
  TCRA approval, which takes weeks.
