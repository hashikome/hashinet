# Router sim

Use the router sim to run router onboarding, provisioning and verification against real
RouterOS without hardware. It is a MikroTik Cloud Hosted Router (CHR) in QEMU, driven by the
same provisioning code the API runs. It proves everything except a phone joining real WiFi,
which needs a physical board (build plan M8).

## Prerequisites

- Linux with KVM (`/dev/kvm` readable and writable by you) and `qemu-system-x86_64`,
  `qemu-img`.
- The CHR image, verified against MikroTik's published checksum, in the git-ignored
  `data/router-sim/`:

  ```bash
  V=7.25   # the current stable: curl -s https://download.mikrotik.com/routeros/NEWESTa7.stable
  mkdir -p data/router-sim && cd data/router-sim
  curl -fLO https://download.mikrotik.com/routeros/$V/chr-$V.img.zip
  curl -fs https://download.mikrotik.com/routeros/$V/chr-$V.img.zip.sha256   # compare:
  sha256sum chr-$V.img.zip
  unzip chr-$V.img.zip
  ```

  Changing the version means updating `ROS_VERSION` in `tooling/router-sim/sim.ts`.

The free CHR licence caps throughput at 1 Mbps, which is irrelevant to the sim.

## Topology

```text
host 127.0.0.1:18728 ──forward──► ether1 ─┐
host 10.0.2.2 ("ISP router")  ◄─────────── ├─ bridgeLocal 10.0.2.15/24 (venue LAN)
                                           │
guest VM ── UDP link 127.0.0.1:18100-18101 ── ether2  hotspot 10.5.50.0/24
```

QEMU's user network is the venue LAN, with the host as the ISP router at `10.0.2.2`. The
API, forwarded to `127.0.0.1:18728`, is how the sim reaches the router (its *management
target*). CHR has no radio, so the hotspot runs on `ether2`, a point-to-point UDP link to the guest VM
(not multicast, which a host VPN such as Cloudflare WARP can swallow). During `setup`, the sim serves the portal pages the router fetches on
`127.0.0.1:4006`, which the router reaches as `http://10.0.2.2:4006`.

A venue can have more routers. `--router <n>` on any command picks one (router 1 without it). Each
router has its own overlay, sockets, user network, guest VM and tunnel address:

| | Router 1 | Router 2 (each further one: +10 ports) |
| --- | --- | --- |
| Name | `hashinet-sim` | `hashinet-sim-2` |
| RouterOS API, SSH, WinBox | `127.0.0.1:18728`, `18022`, `18291` | `18738`, `18032`, `18301` |
| Guest link | `127.0.0.1:18100-18101` | `18110-18111` |
| Guest MAC | `52:54:00:4A:00:10` | `52:54:00:4A:01:10` |
| Tunnel address | `10.88.0.2` | `10.88.0.3` |

All of them serve one venue, so one voucher spans them, and share the sim database and its
encryption key. Their state is in `data/router-sim/state.json`.

## Commands

```bash
bun run router-sim up          # boot (a copy-on-write overlay over the pristine image)
bun run router-sim bootstrap   # onboarding steps 1-2: reset with no defaults, paste the bootstrap script
bun run router-sim import <file>   # as `bootstrap`, from a script downloaded from a real HashiNet; prints none of it
bun run router-sim setup       # step 4: the real setupRouter pipeline (probe, readiness, apply, verify, self-test)
bun run router-sim verify      # the readiness checks alone
bun run router-sim console '<RouterOS statement>'
bun run router-sim reset       # discard the overlay and boot a factory-fresh router
bun run router-sim down
bun run router-sim setup --router 2   # any command, on router 2
```

`reset` on router 1 starts the whole sim again, its database included; on any other router it
replaces that router alone, which keeps its database row (found by name) and the venue.

Set `PORTAL_ORIGIN` (for example `PORTAL_ORIGIN=https://handbook.hashikome.com`) to provision
with a host-name portal behind Cloudflare, as production will; without it guests are sent to
the management URL, the earlier LAN design.

`reset`, then `bootstrap` and `setup`, is the full onboarding of a new router. It takes about
a minute and must end with `Setup succeeded.`; a second `setup` must report 0 changes.
`verify` then passes, with one warning until a guest has been online: no client activity. Its
RADIUS check reads the `/radius` entry Set up made and `/radius monitor`'s counters, which count
Accounting-Responses among the accepts.

## Using it in a browser

```bash
bun run router-sim reset && bun run router-sim bootstrap && bun run router-sim setup   # once
bun run router-sim demo          # starts everything and prints the links
bun run router-sim code          # the latest emailed sign-in code
```

`demo` runs router 1, its guest VM, the API on the sim database and the web on port 3006, in LAN
mode (router 1 bootstrapped without `--tunnel`). The guest link puts your browser in the guest's place, naming the VM's MAC and IP. Sign-ins
go through RADIUS (ADR-0015), which only reaches HashiNet over the tunnel, so in LAN mode a
redeem is refused with "the WiFi router has not let you online yet": the demo shows the portal,
the counter and the admin, not a device getting online. `guest-test` proves that, over the tunnel.
A browser cannot prove what a phone does: real captive sheets are for M8.

`demo` shows what launches: selling at the counter, with self-service mobile money held. `demo payments` adds the
stand-ins (`PAYMENTS_PROVIDER=fake`, `SMS_PROVIDER=outbox`). A fake gateway then approves a purchase after about 6 seconds, a number
ending 0000 declines, and one ending 1111 never answers. Texts land in `data/sms/`.

## Guest

A guest VM stands in for a phone on the hotspot: Alpine Linux's `virt` ISO booted live, with
nothing installed, on the other end of the router's `ether2` link. Each router has its own.

```bash
cd data/router-sim
curl -fLO https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-virt-3.24.3-x86_64.iso
curl -fs https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/latest-releases.yaml \
  | grep -A8 'flavor: alpine-virt'      # compare its sha256 with:
sha256sum alpine-virt-3.24.3-x86_64.iso
cd ../..
bun run router-sim guest              # boot router 1's guest (about 25 s); `guest down` stops it
bun run router-sim guest --router 2   # and router 2's
```

### The guest test: one voucher across two routers

Every hotspot login is answered by HashiNet over RADIUS through the management tunnel (ADR-0015),
and the relay tells routers apart by their tunnel addresses, so the guest test needs two routers
on the tunnel, both set up, and both guests running:

```bash
bun run router-sim reset && bun run router-sim bootstrap --tunnel
bun run router-sim reset --router 2 && bun run router-sim bootstrap --tunnel --router 2
bun run router-sim hub up
bun run router-sim setup && bun run router-sim setup --router 2      # twice: 0 changes the second time
bun run router-sim verify && bun run router-sim verify --router 2
bun run router-sim guest && bun run router-sim guest --router 2
bun run router-sim guest-test        # about 3 minutes
```

`guest-test` runs without `PORTAL_ORIGIN`, in the hub, where the real API (on the sim database, with no target override)
reaches both routers through the tunnel and the relay answers their RADIUS. It first ends every
voucher in use at the sim venue and signs everyone off both routers, then must pass every step:

1. Guest 1 gets an address from router 1, a page request gets the portal, and the redirect names
   router 1 and the device. HTTPS elsewhere is blocked; a direct POST of the code to the router
   is refused; a device the router can't see is refused (`DEVICE_NOT_ON_NETWORK`), with the
   voucher's clock not started.
2. Guest 1 redeems through the walled garden: router 1 asks RADIUS, HashiNet accepts, the reply
   carries a 4-digit `switchPin`, router 1 shows the code as the user, and no voucher is a local
   user on the router. Router 1's accounting Start opens the session in `wifi_sessions`.
3. Guest 2, on router 2, is sent to the portal naming router 2. The same code without the PIN is
   refused (409 `PIN_REQUIRED`), and with a wrong one (400 `PIN_WRONG`, one wrong try counted).
   The right PIN moves it: guest 2 is online through RADIUS, router 2's accounting opens its
   session, and router 1's session ends (`moved_to_another_device`, its bytes from the Stop) while
   guest 1 keeps asking. Guest 1 leaving and coming back by its MAC is refused by RADIUS.
4. A release at the counter (`VouchersService.release` as the sim business's owner, as the route
   calls it: the sim has no staff sign-in) ends guest 2's session (`voucher_released`) and clears
   the devices and the PIN; guest 1 then signs in with the code alone and gets a new PIN.
5. Guest 1, gone from router 1 (session, cookie and host) and back, is signed in by the router by
   its MAC through RADIUS, with no portal (`login-by` mac, the MAC as the user).
6. A 1-minute voucher on router 2 is cut off by its Session-Timeout, and its session ends
   `expired` (`session_timeout`).

The guest posts to the API with BusyBox `nc` (BusyBox `wget` prints no body on an error), holding
its input open until the reply is in. The page itself is not driven, since the guest has no
browser. RouterOS doesn't ask RADIUS again for a host it still knows: a device moved off a router
stays on the portal there until its host entry goes.

The guest's checks look at what really answered, not at whether a connection opened: the
hotspot redirects unauthenticated port 80 and 443 connections to the router itself, so a bare
TCP connect "succeeds" to any host. `bun run router-sim voucher [minutes]` creates a voucher on
its own.

## Management tunnel

```bash
bun run router-sim reset && bun run router-sim bootstrap --tunnel   # the bootstrap brings up WireGuard
bun run router-sim hub up                                    # the platform side, in a container
bun run router-sim tunnel-status                             # expect a recent handshake per router
bun run router-sim setup && bun run router-sim verify               # over the tunnel alone
bun run router-sim hub restart                               # the routers must reconnect unaided
bun run router-sim hub down
```

The hub (`tooling/router-sim-hub/Dockerfile`, built once with
`docker build -t hashinet-router-sim-hub:1 tooling/router-sim-hub`) runs WireGuard in its own network
namespace with `NET_ADMIN`, published on `127.0.0.1:51820/udp`, which each router reaches as
`10.0.2.2:51820`. `hub up` adds a peer for every router bootstrapped with `--tunnel`, so run it
again after bootstrapping another. With a tunnel, `setup`, `verify`, `voucher` and `guest-test` run
inside the hub, as your user, because only the hub is on the platform side; a router's API accepts
only `10.88.0.1`. Creating the interface loads the host kernel's `wireguard` module if it is not
already loaded.

The hub also runs the tunnel service's RADIUS relay (`serveRadius` from `apps/tunnel`) on
`10.88.0.1:1812-1813`, relaying each packet with the router's tunnel address to the sim API at
`127.0.0.1:4006` in the hub, which runs while `guest-test` does. Its bearer secret is the sim's
`TUNNEL_SYNC_SECRET`, generated into `state.json` by `hub up` and read from there by the relay and
the API, never printed. The relay logs to `data/router-sim/relay.log`; connection refused there
means no API was running when a router asked. When a router's RADIUS times out, check in order:
`/radius monitor`'s timeouts, that its database row's `tunnel_address` is the address it sends
from, and that its RADIUS secret opens with the sim's encryption key: the API drops those
requests without a word.

## Notes

- Sim credentials are generated per router and kept, with what the routers share (the encryption
  key, the hub's WireGuard keys, the sync secret, the venue), in `data/router-sim/state.json`
  (mode 600, git-ignored).
- The machine running the sim may be shared and heavily loaded: the sim's RouterOS connections
  wait 30 s, not the API's default 10.
- The tool types into the serial console as an operator would, so it answers RouterOS's
  first-login prompts (licence, forced password change) and pages long output with space.
  RouterOS's pager `D` writes the rest to a `console-dump.txt` file on the router.
- `setup` and `verify` bypass the database through an in-memory `RouterStore`; the API uses
  `dbRouterStore`.
