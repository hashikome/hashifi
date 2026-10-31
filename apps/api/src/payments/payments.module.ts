import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { BrandModule } from "../brand/brand.module.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { GuestModule } from "../guest/guest.module.js";
import { IntervalJob } from "../jobs/interval-job.js";
import { SmsReports } from "../messaging/sms-reports.js";
import { PackagesModule } from "../packages/packages.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { GuestPaymentsController, PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";

const MINUTE = 60_000;

@Injectable()
class PaymentJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: IntervalJob;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    payments: PaymentsService,
  ) {
    this.job = new IntervalJob("payment.reconcile", MINUTE, () => payments.reconcile());
  }

  onApplicationBootstrap(): void {
    if (this.config.jobsEnabled) this.job.start(true);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.job.stop();
  }
}

@Module({
  imports: [RoutersModule, PackagesModule, BrandModule, GuestModule],
  controllers: [GuestPaymentsController, PaymentsController, WebhooksController],
  providers: [PaymentsService, SmsReports, PaymentJobs],
})
export class PaymentsModule {}
