# Mobile-money payments

Status: `in progress`: built on test doubles, and waiting on provider accounts. M6 of the
[build plan](../exec-plans/active/build-hashinet.md#m6-mobile-money-payments-snippe-and-customers),
which holds the work; this item is removed when M6 completes.

## Problem

Guests can only get online with a voucher someone sold them in person. Selling packages
directly on the captive portal, paid by mobile money, removes the need for a seller at the
venue.

## What exists

Self-service purchase is built in `apps/api/src/sales/payments`, with SMS in `apps/api/src/sales/sms`:
a payment request from the portal, signed webhooks, reconciliation of pending payments, the voucher
made once paid, and the code texted. Each provider is one file under the area's `providers/`
(Snippe and BRIQ, and the development stand-ins), behind `MobileMoneyGateway` and `SmsSender`
([ADR-0010](../engineering-decisions/0010-payments-and-sms.md)). It is held until the providers'
credentials exist.

## Gate

The portal works (build plan M5) and a Snippe merchant account exists. Its webhook is
verified against the published contract, and the portal flow reviewed under ADR-0003 (the API
decides payment state; the web presents it). No physical router is needed: the router sim and
Snippe's test environment prove it before the release.
