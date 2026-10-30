import { Module } from "@nestjs/common";
import { PackagesModule } from "../packages/packages.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { VouchersController } from "./vouchers.controller.js";
import { VouchersService } from "./vouchers.service.js";

@Module({
  imports: [RoutersModule, PackagesModule],
  controllers: [VouchersController],
  providers: [VouchersService],
})
export class VouchersModule {}
