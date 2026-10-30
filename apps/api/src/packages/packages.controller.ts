import type { PackageList, PackageResponse, VenuePackages } from "@hashifi/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { packageInput } from "./package-input.js";
import { PackagesService } from "./packages.service.js";

@Controller("api/packages")
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  async list(@CurrentStaff() staff: StaffPrincipal): Promise<PackageList> {
    return { packages: await this.packages.list(staff) };
  }

  @Get(":id")
  async get(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<PackageResponse> {
    return { package: await this.packages.get(staff, id) };
  }

  @Post()
  @Roles("admin")
  async create(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<PackageResponse> {
    return { package: await this.packages.create(staff, parseInput(packageInput, body), origin) };
  }

  /** Replaces the package: the form sends all of it. */
  @Put(":id")
  @Roles("admin")
  async update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<PackageResponse> {
    return {
      package: await this.packages.update(staff, id, parseInput(packageInput, body), origin),
    };
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Origin() origin: RequestOrigin,
  ): Promise<void> {
    await this.packages.remove(staff, id, origin);
  }
}

/** What a venue sells, and admins' assignments of packages to it. */
@Controller("api/venues/:venueId/packages")
export class VenuePackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  soldAt(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("venueId", idParam()) venueId: string,
  ): Promise<VenuePackages> {
    return this.packages.soldAt(staff, venueId);
  }

  @Put(":packageId")
  @Roles("admin")
  assign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("venueId", idParam()) venueId: string,
    @Param("packageId", idParam()) packageId: string,
    @Origin() origin: RequestOrigin,
  ): Promise<VenuePackages> {
    return this.packages.assign(staff, venueId, packageId, origin);
  }

  @Delete(":packageId")
  @Roles("admin")
  unassign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("venueId", idParam()) venueId: string,
    @Param("packageId", idParam()) packageId: string,
    @Origin() origin: RequestOrigin,
  ): Promise<VenuePackages> {
    return this.packages.unassign(staff, venueId, packageId, origin);
  }
}
