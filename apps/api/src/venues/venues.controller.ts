import type { VenueList, VenueResponse } from "@hashifi/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import { venueInput } from "./venue-input.js";
import { type RequestOrigin, VenuesService } from "./venues.service.js";

@Controller("api/venues")
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  async list(@CurrentStaff() staff: StaffPrincipal): Promise<VenueList> {
    return { venues: await this.venues.list(staff) };
  }

  @Get(":id")
  async get(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<VenueResponse> {
    return { venue: await this.venues.get(staff, id) };
  }

  @Post()
  @Roles("admin")
  async create(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<VenueResponse> {
    return { venue: await this.venues.create(staff, parseInput(venueInput, body), origin) };
  }

  @Patch(":id")
  @Roles("admin")
  async update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<VenueResponse> {
    return { venue: await this.venues.update(staff, id, parseInput(venueInput, body), origin) };
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Origin() origin: RequestOrigin,
  ): Promise<void> {
    await this.venues.remove(staff, id, origin);
  }
}
