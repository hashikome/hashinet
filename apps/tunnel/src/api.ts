/** A request to a path on the API, as this service makes them. */
export type ApiInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };
export type ApiFetch = (path: string, init?: ApiInit) => Promise<Response>;

/** The API at an origin, as its URL says: the router sim's API, on plain HTTP. */
export function apiAt(origin: string): ApiFetch {
  return (path, init = {}) => fetch(`${origin}${path}`, init);
}

/**
 * The API through the server's own Traefik at `address` (host:port), not out over the internet and
 * back through Cloudflare: a router's login is answered without leaving the server, inside the 3
 * seconds it waits. TLS and the route still name the public host, so the certificate is checked as
 * for anyone, and Traefik routes the request as it routes theirs.
 */
export function apiThrough(address: string, origin: string): ApiFetch {
  const host = new URL(origin).host;
  return (path, init = {}) =>
    fetch(`https://${address}${path}`, {
      ...init,
      headers: { ...init.headers, Host: host },
      tls: { serverName: host },
    });
}
