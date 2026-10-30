import type { TeamList, TeamMemberResponse } from "@hashifi/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { createInput, roleInput, statusInput, TeamService, updateInput } from "./team.service.js";

/** The people who sign in. Admins only. */
@Controller("api/team")
@Roles("admin")
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  async list(): Promise<TeamList> {
    return { members: await this.team.list() };
  }

  @Get(":id")
  async get(@Param("id", idParam()) id: string): Promise<TeamMemberResponse> {
    return { member: await this.team.get(id) };
  }

  @Post()
  async create(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<TeamMemberResponse> {
    return { member: await this.team.create(staff, parseInput(createInput, body), origin) };
  }

  @Put(":id")
  async update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<TeamMemberResponse> {
    return { member: await this.team.update(staff, id, parseInput(updateInput, body), origin) };
  }

  @Put(":id/role")
  async setRole(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<TeamMemberResponse> {
    return { member: await this.team.setRole(staff, id, parseInput(roleInput, body), origin) };
  }

  @Put(":id/status")
  async setStatus(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<TeamMemberResponse> {
    const { status } = parseInput(statusInput, body);
    return { member: await this.team.setStatus(staff, id, status, origin) };
  }

  @Post(":id/reset-authenticator")
  @HttpCode(200)
  async resetAuthenticator(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Origin() origin: RequestOrigin,
  ): Promise<TeamMemberResponse> {
    return { member: await this.team.resetAuthenticator(staff, id, origin) };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Origin() origin: RequestOrigin,
  ): Promise<void> {
    await this.team.remove(staff, id, origin);
  }
}
