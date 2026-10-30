import { type DynamicModule, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import type { AppConfig } from "./config/config.js";
import { configModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import type { EmailSender } from "./email/email-sender.js";
import { HealthController } from "./health/health.controller.js";
import { PackagesModule } from "./packages/packages.module.js";
import { RoutersModule } from "./routers/routers.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { VenuesModule } from "./venues/venues.module.js";
import { VouchersModule } from "./vouchers/vouchers.module.js";

@Module({})
export class AppModule {}

export function appModule(config: AppConfig, email: EmailSender | null): DynamicModule {
  return {
    module: AppModule,
    imports: [
      configModule(config, email),
      DatabaseModule,
      AuthModule,
      RoutersModule,
      VenuesModule,
      PackagesModule,
      VouchersModule,
      SessionsModule,
    ],
    controllers: [HealthController],
  };
}
