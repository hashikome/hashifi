import { Module } from "@nestjs/common";
import { RoutersModule } from "../routers/routers.module.js";
import { VenuesModule } from "../venues/venues.module.js";
import { PackagesController, VenuePackagesController } from "./packages.controller.js";
import { PackagesService } from "./packages.service.js";

@Module({
  imports: [RoutersModule, VenuesModule],
  controllers: [PackagesController, VenuePackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
