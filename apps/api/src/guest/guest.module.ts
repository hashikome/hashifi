import { Module } from "@nestjs/common";
import { PackagesModule } from "../packages/packages.module.js";
import { PortalModule } from "../portal/portal.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { GuestController, HotspotFilesController } from "./guest.controller.js";
import { GuestService } from "./guest.service.js";

@Module({
  imports: [RoutersModule, PackagesModule, PortalModule],
  controllers: [GuestController, HotspotFilesController],
  providers: [GuestService],
})
export class GuestModule {}
