import { type DynamicModule, Global, Module } from "@nestjs/common";
import {
  BRAND_STORE,
  type BrandStore,
  DiskBrandStore,
  R2BrandStore,
} from "../brand/brand-store.js";
import {
  EMAIL_SENDER,
  type EmailSender,
  OutboxEmailSender,
  ResendEmailSender,
} from "../email/email-sender.js";
import {
  BriqSmsSender,
  NoSmsSender,
  OutboxSmsSender,
  SMS_SENDER,
  type SmsSender,
} from "../messaging/sms-sender.js";
import {
  FakeGateway,
  MOBILE_MONEY,
  type MobileMoneyGateway,
  NoGateway,
  SnippeGateway,
} from "../payments/mobile-money.js";
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
      { provide: BRAND_STORE, useValue: brandStoreFor(config) },
      { provide: MOBILE_MONEY, useValue: gatewayFor(config) },
      { provide: SMS_SENDER, useValue: smsSenderFor(config) },
    ],
    exports: [APP_CONFIG, EMAIL_SENDER, BRAND_STORE, MOBILE_MONEY, SMS_SENDER],
  };
}

function gatewayFor(config: AppConfig): MobileMoneyGateway {
  const { snippeApiKey } = config.payments;
  if (snippeApiKey !== null) {
    return new SnippeGateway(snippeApiKey, `${config.appUrl}/webhooks/snippe`);
  }
  return config.fakeProviders ? new FakeGateway() : new NoGateway();
}

function smsSenderFor(config: AppConfig): SmsSender {
  const { briq, outboxDir } = config.sms;
  if (briq !== null) return new BriqSmsSender(briq.apiKey, briq.appId, briq.senderId);
  return config.fakeProviders ? new OutboxSmsSender(outboxDir) : new NoSmsSender();
}

function brandStoreFor(config: AppConfig): BrandStore {
  const { r2, storeDir } = config.brand;
  return r2 === null ? new DiskBrandStore(storeDir) : new R2BrandStore(r2);
}

function emailSenderFor(config: AppConfig): EmailSender {
  const { resendApiKey, from, outboxDir } = config.email;
  return resendApiKey === null
    ? new OutboxEmailSender(outboxDir)
    : new ResendEmailSender(resendApiKey, from);
}
