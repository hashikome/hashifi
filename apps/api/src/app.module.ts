import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { RoutersModule } from "./routers/routers.module.js";

@Module({
  imports: [ConfigModule, DatabaseModule, RoutersModule],
  controllers: [HealthController],
})
export class AppModule {}
