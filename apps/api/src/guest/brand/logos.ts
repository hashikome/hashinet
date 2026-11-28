import { createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { NotAnImageError, processLogo } from "./brand-images.js";
import { BRAND_STORE, type BrandStore } from "./brand-store.js";

const FILE = /^logo-[0-9a-f]{16}\.webp$/;
/**
 * The keys this store has made: an owner's id, then a logo, or a background picture from before
 * portals kept only logos. The sweep touches nothing else, whatever else the bucket holds.
 */
const MADE_HERE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(logo|background)-[0-9a-f]{16}\.webp$/;
/** How old an unreferenced file must be before the sweep removes it. */
const SWEEP_AFTER_MS = 60 * 60_000;

/** Where a phone loads a logo: the portal's own origin, the one host it can reach (ADR-0009, 4). */
export function logoUrl(key: string | null): string | null {
  return key === null ? null : `/api/guest/brand/${key}`;
}

/**
 * Logos, a venue's or a business's (ADR-0009): re-encoded, stored under their owner's id and their
 * content's hash, served by the public route, and swept when nothing references them.
 */
@Injectable()
export class Logos {
  constructor(
    private readonly db: PrismaService,
    @Inject(BRAND_STORE) private readonly store: BrandStore,
  ) {}

  /** Stores an upload as a logo of `ownerId` (a venue's or a business's id) and returns its key. */
  async save(ownerId: string, upload: Uint8Array): Promise<string> {
    const bytes = await processLogo(upload).catch((err: unknown) => {
      if (!(err instanceof NotAnImageError)) throw err;
      throw new BadRequestException(apiError("INVALID_IMAGE", "Upload a JPEG, PNG or WebP image."));
    });
    // Named by its content, so a phone can cache it for good and a new file gets a new address.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const key = `${ownerId}/logo-${hash}.webp`;
    await this.store.put(key, bytes);
    return key;
  }

  /** A logo, for the public route. Only a name this service makes is ever looked up. */
  async read(ownerId: string, file: string): Promise<Uint8Array | null> {
    return FILE.test(file) ? this.store.get(`${ownerId}/${file}`) : null;
  }

  /** An orphaned file costs a few kilobytes; a failed delete never fails the request. */
  discard(key: string | null): void {
    if (key !== null) void this.store.remove(key).catch(captureFailure);
  }

  /**
   * Removes stored files nothing references: a logo whose delete failed, files of a venue or
   * business that is gone, and kinds of image no longer kept. A file written in the last hour is
   * left, as its row may not be saved yet. Returns how many went.
   */
  async sweep(now = new Date()): Promise<number> {
    const [venues, businesses] = await Promise.all([
      this.db.venuePortal.findMany({
        where: { logoKey: { not: null } },
        select: { logoKey: true },
      }),
      this.db.business.findMany({ where: { logoKey: { not: null } }, select: { logoKey: true } }),
    ]);
    const kept = new Set([...venues, ...businesses].map((r) => r.logoKey));
    const settled = now.getTime() - SWEEP_AFTER_MS;
    const stale = (await this.store.list()).filter(
      (file) => MADE_HERE.test(file.key) && !kept.has(file.key) && file.at.getTime() < settled,
    );
    for (const file of stale) await this.store.remove(file.key);
    return stale.length;
  }
}
