import { type DynamicModule, Global, Module } from "@nestjs/common";
import {
  EMAIL_SENDER,
  type EmailSender,
  OutboxEmailSender,
  ResendEmailSender,
} from "../email/email-sender.js";
import type { AppConfig } from "./config.js";

export const APP_CONFIG = Symbol("APP_CONFIG");

/** The configuration and the outside services chosen from it; tests pass their own. */
@Global()
@Module({})
export class ConfigModule {}

export function configModule(config: AppConfig, email: EmailSender | null): DynamicModule {
  return {
    module: ConfigModule,
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: EMAIL_SENDER, useValue: email ?? emailSenderFor(config) },
    ],
    exports: [APP_CONFIG, EMAIL_SENDER],
  };
}

function emailSenderFor(config: AppConfig): EmailSender {
  const { resendApiKey, from, outboxDir } = config.email;
  return resendApiKey === null
    ? new OutboxEmailSender(outboxDir)
    : new ResendEmailSender(resendApiKey, from);
}
