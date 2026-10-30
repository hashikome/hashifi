import type { PortalImageResponse, PortalSettingsResponse } from "@hashifi/types";
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentStaff, Public, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { apiError } from "../http/error-envelope.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { PortalService } from "./portal.service.js";
import { imageKindQuery, portalInput } from "./portal-input.js";

@Controller("api/portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  async get(): Promise<PortalSettingsResponse> {
    return { settings: await this.portal.get() };
  }

  /** Replaces the branding: the portal page's form sends all of it. */
  @Put()
  @Roles("admin")
  async save(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<PortalSettingsResponse> {
    return { settings: await this.portal.save(staff, parseInput(portalInput, body), origin) };
  }

  /**
   * The image itself is the request body (`Content-Type: image/jpeg`, `image/png`,
   * `image/webp` or `image/gif`, up to 10 MB), read by the raw parser in `main.ts`.
   */
  @Post("images")
  @Roles("admin")
  upload(@Query() query: unknown, @Req() request: Request): Promise<PortalImageResponse> {
    const { kind } = parseInput(imageKindQuery, query);
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new UnsupportedMediaTypeException(
        apiError("UNSUPPORTED_MEDIA_TYPE", "Send the image as the body, with its image type."),
      );
    }
    return this.portal.upload(kind, body);
  }

  /** Public: guests' browsers load these before signing in. Never changes, so cached long. */
  @Get("images/:id")
  @Public()
  async image(@Param("id", idParam()) id: string, @Res() response: Response): Promise<void> {
    const image = await this.portal.image(id);
    response
      .status(HttpStatus.OK)
      .type(image.contentType)
      .setHeader("Cache-Control", "public, max-age=31536000, immutable")
      .setHeader("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(image.bytes));
  }
}
