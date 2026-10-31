import { createHash, timingSafeEqual } from "node:crypto";
import { Controller, Get, Headers, Inject, UnauthorizedException } from "@nestjs/common";
import { Public } from "../auth/staff-guard.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";

const digest = (text: string) => createHash("sha256").update(text).digest();

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
    const secret = this.config.tunnelSyncSecret;
    const given = authorization ?? "";
    if (secret === null || !timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
      throw new UnauthorizedException(apiError("UNAUTHORIZED", "Refused."));
    }
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
