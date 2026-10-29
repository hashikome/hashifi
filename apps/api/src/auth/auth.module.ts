import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL_SENDER, type EmailSender } from "../email/email-sender.js";
import { BETTER_AUTH, createAuth } from "./create-auth.js";
import { MeController } from "./me.controller.js";
import { StaffGuard } from "./staff-guard.js";

@Global()
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: BETTER_AUTH,
      inject: [APP_CONFIG, PrismaService, EMAIL_SENDER],
      useFactory: (config: AppConfig, db: PrismaService, email: EmailSender) =>
        createAuth({ config, db, email }),
    },
    { provide: APP_GUARD, useClass: StaffGuard },
  ],
  exports: [BETTER_AUTH],
})
export class AuthModule {}
