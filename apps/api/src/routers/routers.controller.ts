import type {
  BootstrapScriptResponse,
  ProvisioningBacklog,
  RouterList,
  RouterResponse,
} from "@hashifi/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { bootstrapInput, routerInput, testConnectionInput } from "./router-input.js";
import { RoutersService } from "./routers.service.js";

const listQuery = z.object({ venueId: z.uuid().nullable().default(null) });
const flag = z
  .enum(["1", "true", "0", "false"])
  .nullable()
  .default(null)
  .transform((v) => v === "1" || v === "true");

@Controller("api/routers")
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  async list(@CurrentStaff() staff: StaffPrincipal, @Query() query: unknown): Promise<RouterList> {
    const { venueId } = parseInput(listQuery, query);
    return { routers: await this.routers.list(staff, venueId) };
  }

  /** Guests waiting on a router in the caller's venues. */
  @Get("provisioning-backlog")
  backlog(@CurrentStaff() staff: StaffPrincipal): Promise<ProvisioningBacklog> {
    return this.routers.backlog(staff);
  }

  @Post("test-connection")
  @Roles("admin")
  @HttpCode(200)
  testConnection(@Body() body: unknown) {
    return this.routers.testConnection(parseInput(testConnectionInput, body));
  }

  @Get(":id")
  async get(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<RouterResponse> {
    return { router: await this.routers.get(staff, id) };
  }

  @Post()
  @Roles("admin")
  async create(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<RouterResponse> {
    return { router: await this.routers.create(staff, parseInput(routerInput, body), origin) };
  }

  @Put(":id")
  @Roles("admin")
  async update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<RouterResponse> {
    return {
      router: await this.routers.update(staff, id, parseInput(routerInput, body), origin),
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
    await this.routers.remove(staff, id, origin);
  }

  @Post(":id/sync")
  @Roles("admin")
  @HttpCode(200)
  async sync(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<RouterResponse> {
    return { router: await this.routers.syncNow(staff, id) };
  }

  /** Carries the router's API password, so no cache may keep it. */
  @Post(":id/bootstrap-script")
  @Roles("admin")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  bootstrapScript(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<BootstrapScriptResponse> {
    return this.routers.bootstrapScript(staff, id, parseInput(bootstrapInput, body), origin);
  }

  @Post(":id/probe")
  @Roles("admin")
  @HttpCode(200)
  probe(@CurrentStaff() staff: StaffPrincipal, @Param("id", idParam()) id: string) {
    return this.routers.probe(staff, id);
  }

  @Post(":id/verify")
  @Roles("admin")
  @HttpCode(200)
  verify(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Query("skipWriteTest") skipWriteTest: unknown,
  ) {
    return this.routers.verify(staff, id, !parseInput(flag, skipWriteTest ?? null));
  }

  @Post(":id/setup")
  @Roles("admin")
  @HttpCode(200)
  setup(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Query("force") force: unknown,
  ) {
    return this.routers.setup(staff, id, parseInput(flag, force ?? null));
  }

  @Post(":id/provision")
  @Roles("admin")
  @HttpCode(200)
  provision(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
    @Query("dryRun") dryRun: unknown,
  ) {
    return this.routers.provision(staff, id, parseInput(flag, dryRun ?? null));
  }

  @Get(":id/provision/latest")
  @Roles("admin")
  latestProvision(@CurrentStaff() staff: StaffPrincipal, @Param("id", idParam()) id: string) {
    return this.routers.latestProvision(staff, id);
  }
}
