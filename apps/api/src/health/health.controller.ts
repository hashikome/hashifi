import { Controller, Get, HttpCode, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

/** Liveness and readiness for the platform's health checks and Uptime Kuma. */
@Controller("api/health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** The process is up. */
  @Get()
  @HttpCode(200)
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** The API can serve: PostgreSQL answers. */
  @Get("ready")
  async ready(): Promise<{ status: "ok" }> {
    try {
      await this.prisma.ping();
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable", reason: "database" });
    }
    return { status: "ok" };
  }
}
