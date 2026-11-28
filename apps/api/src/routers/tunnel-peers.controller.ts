import { Controller, Get, Headers, Inject } from "@nestjs/common";
import { Public } from "../core/access/access.guard.js";
import type { AppConfig } from "../core/config/config.js";
import { APP_CONFIG } from "../core/config/config.module.js";
import { PrismaService } from "../core/database/prisma.service.js";
import { requireTunnelSecret } from "./tunnel-secret.js";

/**
 * The routers allowed on the management tunnel, for the tunnel service: public keys and addresses,
 * behind a secret of its own. Deleting a router removes its peer here (ADR-0006, decision 5).
 */
@Public()
@Controller("api/internal/tunnel-peers")
export class TunnelPeersController {
  constructor(
    private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async peers(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<{ peers: { publicKey: string; address: string }[] }> {
    requireTunnelSecret(this.config.tunnelSyncSecret, authorization);
    const routers = await this.db.router.findMany({
      where: { tunnelPublicKey: { not: null }, tunnelAddress: { not: null } },
      select: { tunnelPublicKey: true, tunnelAddress: true },
    });
    return {
      peers: routers.map((r) => ({
        publicKey: r.tunnelPublicKey ?? "",
        address: r.tunnelAddress ?? "",
      })),
    };
  }
}
