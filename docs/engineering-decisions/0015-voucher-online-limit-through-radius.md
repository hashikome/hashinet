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
   Each router keeps its own WiFi name, and a voucher does not print one.
2. **The limit is devices online at once,** counted by Hashifi across the venue's routers.
3. **Hashifi answers every login through RADIUS,** over the management tunnel. No voucher sits on a
   router. Routers ask with `login-by=mac,mac-cookie`, so a device coming back is answered the same way
   and cannot pass the limit. A code is still redeemed only through the API (ADR-0008, decision 4).
4. **After the first device, a voucher needs its switch PIN.** A printed code is thrown away with time
   left, so the code alone must never reach a voucher in use, whether or not its payer is online.
   - **Made at the first sign-in,** not at printing, so no sheet, export or batch holds it. It is 4
     random digits from a secure generator, unrelated to the code, and never an obvious PIN (0000, 1234).
   - **Shown once,** on the HTTPS response to the sign-in, and never on a router's page or by a MAC
     address (ADR-0008, decision 7). Only an HMAC of it, with a Docker secret and the voucher's id, is
     stored, and it goes when the voucher expires.
   - **Limited:** five wrong tries wait 15 minutes, and ten lock it until staff release the voucher.
   - **The right PIN moves the voucher at once:** the device joins `voucher_devices`, and at the limit the
     API removes the oldest session and reads the new one back.
5. **A device that has used the voucher comes back alone,** on any router where its address is known, as
   a phone has one address per WiFi name. So a PIN is asked once per WiFi per device. The router first
   arp-pings the session holding the place: an old device still answering keeps it, so two linked phones
   never knock each other off in a loop. Only a PIN takes a place from a device that is still there.
6. **Staff release a voucher** for a guest who shows it at the counter: its sessions, devices and PIN are
   cleared, its time keeps running, and the release is audited.
7. **The time left comes from Hashifi** (`Session-Timeout`), and the router ends the session itself.
8. **Nothing reports success before the router confirms it.** The API still reads the session back.
9. **A block is on the voucher** as well as at the router, since a MAC address can change.

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
With `login-by=mac`, a known address on the other router was online about 2 seconds after joining, with
no portal and its old session removed in 0.08 seconds. An arp-ping answered in 0.05 seconds, or timed out
in 0.54 once the device had gone; a plain ping is not a usable check, as it timed out with the device there.

## What remains open

- **Real phones and WiFi.** Whether a sleeping phone answers an arp-ping, and iOS and Android captive
  sheets. Physical boards, the hAP lite class above all.
- **Accounting lost in an outage** must be reconciled against each router's active sessions.
