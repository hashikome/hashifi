import type { SessionList, SessionResponse } from "@hashifi/types";
import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentStaff, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { SessionsService, sessionQuery } from "./sessions.service.js";

@Controller("api/sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@CurrentStaff() staff: StaffPrincipal, @Query() query: unknown): Promise<SessionList> {
    return this.sessions.list(staff, parseInput(sessionQuery, query));
  }

  @Get(":id")
  async get(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<SessionResponse> {
    return { session: await this.sessions.get(staff, id) };
  }

  /** Managers end sessions at their venues; admins anywhere. */
  @Post(":id/terminate")
  @HttpCode(200)
  async terminate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Origin() origin: RequestOrigin,
  ): Promise<SessionResponse> {
    return { session: await this.sessions.terminate(staff, id, origin) };
  }
}
