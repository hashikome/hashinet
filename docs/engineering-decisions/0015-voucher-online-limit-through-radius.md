# ADR-0015: A voucher is limited by the devices online at once, through RADIUS

Status: accepted, 6 November 2026, as proved on two simulated routers. Needs a real phone test before
launch. Amends ADR-0008 (decisions 6, 8, 9 and 10).

## Context

A voucher belongs to its venue and works on every router there (ADR-0008, decision 10), but each
router only knows its own guests. Today the limit counts every device a voucher has seen, by MAC
address. Phones randomise that address, so one guest can use up a voucher's places, and a limit of one
on each router still let one code online on two routers at once.

## Decision

1. **The voucher is the identity.** It belongs to the venue and a guest joins any of its WiFi networks.
   A router's name no longer matters to a voucher, so a voucher does not print one.
2. **The limit is devices online at once,** counted by Hashifi across the venue's routers. A device's
   MAC address names a session; it does not hold a place.
3. **Hashifi answers every login through RADIUS,** over the management tunnel. No voucher sits on a
   router. Only the API starts a sign-in (ADR-0008, decision 4), and a device coming back by its MAC
   cookie is answered the same way, so a return cannot pass the limit.
4. **At the limit a voucher refuses the new device.** Printed vouchers are thrown away with time left,
   so a code alone must never remove someone who is online. A place frees when a device goes: the
   hotspot's keepalive is 30 seconds. Staff can end a session for a guest who needs their place back.
5. **The time left comes from Hashifi** (`Session-Timeout`), and the router ends the session itself.
6. **Nothing reports success before the router confirms it.** The API still reads the session back.
7. **A block is on the voucher** as well as at the router, since a MAC address can change.

## Evidence

RouterOS 7.25 CHR, two routers, two guest VMs and a small test RADIUS server: a limit of one per
router allowed the same code on both; with RADIUS, a second device on the other router was refused; no
local user was needed; time left carried across and a 20-second session ended after 21 seconds with
the server silent; a refused MAC-cookie return stayed off and lost its cookie; a new MAC was accepted;
a device that left held its place for 118 seconds by default and 29 at a 30-second keepalive, and came
back at once. With the server silent, a new sign-in failed in 6 seconds and a device online stayed on
for the 100 seconds tested. The API's `/ip/hotspot/active/remove` took 0.09 seconds and removed the
cookie. The router refused a RADIUS Disconnect-Request (Error-Cause 406), so ending a session is an API
call.

## What remains open

- **Real phones and WiFi.** Whether a 30-second keepalive drops a sleeping phone, how fast it returns,
  and iOS and Android captive sheets. Physical boards, the hAP lite class above all.
- **A found voucher with time left** can still be used once its payer is offline. That is the nature of
  a printed code; the card says to keep it, and staff can end the session.
- **Accounting lost in an outage** must be reconciled against each router's active sessions.
