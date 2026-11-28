import { randomBytes } from "node:crypto";
import type { SecretBox } from "../../core/crypto/secret-box.js";
import { toJsonValue } from "../../core/database/json.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { openHosts } from "../../venues/sites/open-sites.js";
import type { RouterAccess } from "../mikrotik/router-credentials.js";
import type { BackendSettings } from "./context.js";
import type { RouterStore } from "./store.js";

export class PrismaRouterStore implements RouterStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: RouterAccess,
    private readonly box: SecretBox,
    readonly backend: BackendSettings,
  ) {}

  /** The router, and the sites its venue opens before paying: only open ones, never those waiting. */
  async load(routerId: string) {
    const router = await this.db.router.findUnique({ where: { id: routerId } });
    if (!router) return null;
    return { ...router, venue: { allowedSites: await openHosts(this.db, router.venueId) } };
  }

  credentials(router: Parameters<RouterStore["credentials"]>[0]) {
    return this.access.credentials(router);
  }

  async markProvisioning(routerId: string): Promise<void> {
    await this.db.router.update({ where: { id: routerId }, data: { status: "provisioning" } });
  }

  async recordProvisionOutcome(
    router: Parameters<RouterStore["recordProvisionOutcome"]>[0],
    { ok, profile, report }: Parameters<RouterStore["recordProvisionOutcome"]>[1],
  ): Promise<void> {
    await this.db.router.update({
      where: { id: router.id },
      data: {
        status: ok ? "online" : "error",
        ...(ok ? { provisionedAt: new Date() } : {}),
        model: profile.boardName ?? router.model,
        identity: profile.identity ?? router.identity,
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        capabilities: toJsonValue(profile.capabilities),
        lastProvisionReport: toJsonValue(report),
      },
    });
  }

  /**
   * The router's RADIUS secret, made on its first setup. Written only while none is set, then read
   * back, so two setups at once agree on one.
   */
  async radiusSecret(router: Parameters<RouterStore["radiusSecret"]>[0]): Promise<string> {
    if (router.radiusSecretEncrypted === null) {
      await this.db.router.updateMany({
        where: { id: router.id, radiusSecretEncrypted: null },
        data: { radiusSecretEncrypted: this.box.seal(randomBytes(24).toString("base64url")) },
      });
    }
    const { radiusSecretEncrypted } = await this.db.router.findUniqueOrThrow({
      where: { id: router.id },
      select: { radiusSecretEncrypted: true },
    });
    if (radiusSecretEncrypted === null) throw new Error("The router's RADIUS secret was not kept");
    return this.box.open(radiusSecretEncrypted);
  }
}
