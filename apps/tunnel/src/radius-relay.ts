/**
 * RADIUS from the routers, relayed to the API (ADR-0015). This service alone sees a router's tunnel
 * address, which is how the API knows which router asks; it decides nothing, and answers only with
 * what the API returns. A request the API drops, or can't answer in time, gets no reply, as a router
 * expects of a server that ignores it.
 */
export const RADIUS_PORTS = [1812, 1813] as const;
/** Under the 3 seconds a router waits, so its retry finds the API's answer to the first try. */
const API_TIMEOUT_MS = 2500;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function relayPacket(
  fetcher: Fetch,
  origin: string,
  secret: string,
  peer: string,
  packet: Uint8Array,
): Promise<Uint8Array | null> {
  const response = await fetcher(`${origin}/api/internal/radius`, {
    method: "POST",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "User-Agent": "hashinet-tunnel",
    },
    body: JSON.stringify({ peer, packet: Buffer.from(packet).toString("base64") }),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("reply" in body)) return null;
  return typeof body.reply === "string" ? Buffer.from(body.reply, "base64") : null;
}

/**
 * Relays in flight at once. A router asks a few times a second at most, so more than this is a flood:
 * what arrives beyond it is dropped, as a router's retry covers a lost request.
 */
export const MAX_IN_FLIGHT = 64;

/** Runs each job while fewer than `max` are in flight; drops the rest, returning false. */
export function limitInFlight(max: number): (job: () => Promise<void>) => boolean {
  let inFlight = 0;
  return (job) => {
    if (inFlight >= max) return false;
    inFlight += 1;
    job().finally(() => {
      inFlight -= 1;
    });
    return true;
  };
}

/** Listens on the tunnel address for both RADIUS ports and relays each packet. */
export async function serveRadius(hostname: string, origin: string, secret: string): Promise<void> {
  const run = limitInFlight(MAX_IN_FLIGHT);
  for (const port of RADIUS_PORTS) {
    await Bun.udpSocket({
      hostname,
      port,
      socket: {
        data(socket, data, fromPort, fromAddress) {
          run(() =>
            relayPacket(fetch, origin, secret, fromAddress, data)
              .then((reply) => {
                if (reply) socket.send(reply, fromPort, fromAddress);
              })
              .catch((err: unknown) =>
                console.error(
                  err instanceof Error ? `RADIUS relay: ${err.message}` : "RADIUS relay failed",
                ),
              ),
          );
        },
      },
    });
  }
}
