import { Module } from "@nestjs/common";
import { BrandModule } from "../brand/brand.module.js";
import { PackagesModule } from "../packages/packages.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import {
  GuestBrandController,
  GuestController,
  HotspotFilesController,
} from "./guest.controller.js";
import { GuestService } from "./guest.service.js";

@Module({
  imports: [RoutersModule, PackagesModule, BrandModule],
  controllers: [GuestController, GuestBrandController, HotspotFilesController],
  providers: [GuestService],
})
export class GuestModule {}
