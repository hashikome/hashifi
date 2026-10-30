import type { PortalSettingsResponse } from "@hashifi/types";
import { Body, Controller, Get, Put } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { PortalService } from "./portal.service.js";
import { portalInput } from "./portal-input.js";

@Controller("api/portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  async get(): Promise<PortalSettingsResponse> {
    return { settings: await this.portal.get() };
  }

  /** Replaces the settings: the portal page's form sends all of them. */
  @Put()
  @Roles("admin")
  async save(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<PortalSettingsResponse> {
    return { settings: await this.portal.save(staff, parseInput(portalInput, body), origin) };
  }
}
