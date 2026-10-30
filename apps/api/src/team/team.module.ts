import { Module } from "@nestjs/common";
import { AuditController } from "../audit/audit.controller.js";
import { RoutersModule } from "../routers/routers.module.js";
import { TeamController } from "./team.controller.js";
import { TeamService } from "./team.service.js";

/** Admin oversight: the team, and the audit trail of what everyone did. */
@Module({
  imports: [RoutersModule],
  controllers: [TeamController, AuditController],
  providers: [TeamService],
})
export class TeamModule {}
