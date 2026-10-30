import type { GuestContext, GuestSession, RedeemResult } from "@hashifi/types";
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../auth/staff-guard.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { idParam } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import { backendSettings } from "../routers/backend-settings.js";
import { resolveBackendEndpoints } from "../services/router-provision/context.js";
import {
  PORTAL_FILES,
  type PortalFileName,
  renderPortalFile,
} from "../services/router-provision/portal-files.js";
import { GuestService } from "./guest.service.js";
import { contextInput, redeemInput, sessionInput } from "./guest-input.js";

/** The routes a guest's browser calls before it is online. All public; see `GuestService`. */
@Public()
@Controller("api/guest")
export class GuestController {
  constructor(private readonly guest: GuestService) {}

  @Post("context")
  @HttpCode(200)
  context(@Body() body: unknown): Promise<GuestContext> {
    return this.guest.context(parseInput(contextInput, body));
  }

  @Post("redeem")
  @HttpCode(200)
  redeem(@Body() body: unknown, @Req() request: Request): Promise<RedeemResult> {
    return this.guest.redeem(parseInput(redeemInput, body), request.ip ?? null);
  }

  /** Called by the router's own pages, on the router's origin; it carries no credentials. */
  @Post("session")
  @HttpCode(200)
  @Header("Access-Control-Allow-Origin", "*")
  session(@Body() body: unknown, @Req() request: Request): Promise<GuestSession> {
    return this.guest.session(parseInput(sessionInput, body).code, request.ip ?? null);
  }
}

/** The pages a router pulls while it is provisioned, before any session exists. */
@Public()
@Controller("portal/hotspot-files")
export class HotspotFilesController {
  constructor(
    private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(":routerId/:name")
  async file(
    @Param("routerId", idParam()) routerId: string,
    @Param("name") name: string,
    @Res() response: Response,
  ): Promise<void> {
    const router = await this.db.router.findUnique({ where: { id: routerId } });
    if (!router || !(PORTAL_FILES as readonly string[]).includes(name)) {
      throw new NotFoundException(apiError("NOT_FOUND", "Not found."));
    }
    const { portal } = resolveBackendEndpoints(router.ipAddress, backendSettings(this.config));
    const page = await renderPortalFile(name as PortalFileName, portal.origin, routerId);
    response.type("html").send(page);
  }
}
