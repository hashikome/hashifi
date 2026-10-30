import { Module } from "@nestjs/common";
import { RoutersModule } from "../routers/routers.module.js";
import { PortalController } from "./portal.controller.js";
import { PortalService } from "./portal.service.js";

@Module({ imports: [RoutersModule], controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}
