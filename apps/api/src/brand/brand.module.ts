import { Module } from "@nestjs/common";
import { PortalModule } from "../portal/portal.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { BrandController } from "./brand.controller.js";
import { BrandService } from "./brand.service.js";

@Module({
  imports: [RoutersModule, PortalModule],
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
