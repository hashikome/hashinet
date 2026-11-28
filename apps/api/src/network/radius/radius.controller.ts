import { Body, Controller, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../core/access/access.guard.js";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { parseInput } from "../../core/http/validation.js";
import { requireTunnelSecret } from "../tunnel/tunnel-secret.js";
import { RadiusService } from "./radius.service.js";

const relayed = z.object({
  /** The router's tunnel address, as the tunnel service received the packet from it. */
  peer: z.ipv4(),
  /** The packet as received, base64. */
  packet: z.base64().max(6000),
});

/**
 * RADIUS from the routers, relayed by the tunnel service, which alone sees a router's tunnel address
 * (ADR-0015): the packet and its sender in, the reply out, or none to drop it.
 */
@Public()
@Controller("api/internal/radius")
export class RadiusController {
  constructor(
    private readonly radius: RadiusService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async relay(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ reply: string | null }> {
    requireTunnelSecret(this.config.tunnelSyncSecret, authorization);
    const { peer, packet } = parseInput(relayed, body);
    const answer = await this.radius.handle(peer, Buffer.from(packet, "base64"));
    return { reply: answer?.toString("base64") ?? null };
  }
}
