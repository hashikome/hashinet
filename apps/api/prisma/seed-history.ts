import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";

/**
 * Invented history for a business, so Analytics and the venue pages are seen at full density:
 * about 90 days of sales at the counter and online, and the sessions that followed, busiest in the
 * evenings and at weekends. A fixed seed makes every run the same; it is written once.
 */
export async function seedHistory(
  db: PrismaClient,
  businessId: string,
  venueIds: string[],
  now = new Date(),
): Promise<void> {
  if ((await db.payment.count({ where: { providerReference: { startsWith: "SEED-" } } })) > 0) {
    return;
  }
  const packages = await db.package.findMany({
    where: { businessId, isActive: true, venueId: null },
    orderBy: { priceTsh: "asc" },
  });
  if (packages.length === 0) return;
  let state = 20261128;
  // mulberry32: small, and the same numbers every run.
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)] as T;
  // Guests come back: each venue has its regulars' phones and a stream of new ones.
  const macOf = (venue: number, n: number) =>
    `02:5E:${String(venue).padStart(2, "0")}:${(n >> 8).toString(16).padStart(2, "0")}:${(n & 255).toString(16).padStart(2, "0")}:00`.toUpperCase();
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const sessions: Prisma.WifiSessionCreateManyInput[] = [];
  const DAY = 86_400_000;
  // Evening-heavy hours, in Dar es Salaam (UTC+3).
  const hours = [
    7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 18, 19, 19, 19, 20, 20, 20, 21, 21, 22,
  ];
  let ref = 0;
  for (let back = 90; back >= 0; back -= 1) {
    const day = new Date(now.getTime() - back * DAY);
    const weekday = day.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.5 : weekday === 5 ? 1.25 : 1;
    // Growing over the quarter, as a new venue's would.
    const growth = 0.6 + 0.4 * ((90 - back) / 90);
    venueIds.forEach((venueId, v) => {
      const size = [14, 9, 6][v] ?? 5;
      const sales = Math.round(size * weekend * growth * (0.7 + random() * 0.6));
      for (let i = 0; i < sales; i += 1) {
        const hour = pick(hours);
        const at = new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            hour - 3,
            Math.floor(random() * 60),
          ),
        );
        if (at > now) continue;
        const r = random();
        const pkg =
          r < 0.55
            ? packages[0]
            : r < 0.9
              ? (packages[1] ?? packages[0])
              : packages[packages.length - 1];
        if (!pkg) continue;
        ref += 1;
        payments.push({
          provider: random() < 0.7 ? "cash" : "mobile_money",
          status: "paid",
          paidAt: at,
          createdAt: at,
          amountTsh: pkg.priceTsh,
          packageId: pkg.id,
          venueId,
          providerReference: `SEED-${ref}`,
        });
        // Each sale's sessions: one or two, a regular's phone half the time.
        const device = random() < 0.5 ? Math.floor(random() * 40) : 100 + ref;
        const count = random() < 0.6 ? 1 : 2;
        let start = at.getTime() + 2 * 60_000;
        for (let s = 0; s < count; s += 1) {
          const minutes = Math.round(20 + random() * (pkg.durationMinutes >= 1440 ? 300 : 55));
          const end = start + minutes * 60_000;
          const live = end > now.getTime();
          sessions.push({
            venueId,
            packageId: pkg.id,
            macAddress: macOf(v, device),
            startedAt: new Date(start),
            endedAt: live ? null : new Date(end),
            status: live ? "connected" : "disconnected",
            downloadBytes: BigInt(Math.round(minutes * (2 + random() * 8) * 1_000_000)),
            uploadBytes: BigInt(Math.round(minutes * (0.3 + random()) * 1_000_000)),
          });
          start = end + Math.round(30 + random() * 240) * 60_000;
          if (start > now.getTime()) break;
        }
      }
    });
  }
  await db.payment.createMany({ data: payments });
  await db.wifiSession.createMany({ data: sessions });
}
