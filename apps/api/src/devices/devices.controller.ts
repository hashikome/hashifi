import type { DeviceList, DeviceResponse } from "@hashifi/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { DevicesService, deviceQuery, deviceStatusInput } from "./devices.service.js";

@Controller("api/devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(@CurrentStaff() staff: StaffPrincipal, @Query() query: unknown): Promise<DeviceList> {
    return this.devices.list(staff, parseInput(deviceQuery, query));
  }

  @Get(":id")
  async get(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<DeviceResponse> {
    return { device: await this.devices.get(staff, id) };
  }

  @Put(":id/status")
  @Roles("admin")
  async setStatus(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<DeviceResponse> {
    const { status } = parseInput(deviceStatusInput, body);
    return { device: await this.devices.setStatus(staff, id, status, origin) };
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Origin() origin: RequestOrigin,
  ): Promise<void> {
    await this.devices.remove(staff, id, origin);
  }
}
