import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  type RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/staff-guard.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { apiError } from "../http/error-envelope.js";
import { SmsReports } from "../messaging/sms-reports.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import { chargeState } from "./mobile-money.js";
import { PaymentsService } from "./payments.service.js";
import { validPaymentSignature, validSmsSignature } from "./webhook-signatures.js";

const refused = () => new BadRequestException(apiError("INVALID_SIGNATURE", "Refused."));
const notReady = () =>
  // A provider retries a 5xx, so nothing is lost while a secret is missing.
  new ServiceUnavailableException(apiError("NOT_CONFIGURED", "Not ready."));

interface PaymentEvent {
  id?: string;
  type?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: { value?: number; currency?: string };
    failure_reason?: string;
    metadata?: { payment_id?: string };
  };
}

interface SmsEvent {
  id?: string;
  event?: string;
  data?: { job_id?: string; message_id?: string };
}

/**
 * What providers tell us. Public, and proved by signature over the exact bytes received; the
 * body never reaches a log, since it holds a customer's number. The change is written before
 * the 2xx, so a provider's retry covers a crash, and router work happens after it.
 */
@Public()
@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly sms: SmsReports,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("snippe")
  @HttpCode(200)
  async payment(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-webhook-timestamp") timestamp: string | undefined,
    @Headers("x-webhook-signature") signature: string | undefined,
  ): Promise<{ ok: true }> {
    const secret = this.config.payments.snippeWebhookSecret;
    if (secret === null) throw notReady();
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const valid = validPaymentSignature({
      rawBody,
      timestamp: timestamp ?? null,
      signature: signature ?? null,
      secret,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!valid) {
      enrichWideEvent({ "webhook.rejected": "payment" });
      throw refused();
    }
    const event = JSON.parse(rawBody.toString("utf8")) as PaymentEvent;
    // The type comes from the signed body: the event header is only a hint.
    const status = event.type?.startsWith("payment.") ? event.type.slice(8) : null;
    const id = event.id ?? null;
    if (status === null || id === null) return { ok: true };

    const paymentId = await this.payments.findForReport(
      event.data?.metadata?.payment_id ?? null,
      event.data?.reference ?? null,
    );
    if (paymentId === null) {
      enrichWideEvent({ "webhook.unmatched": "payment" });
      return { ok: true };
    }
    const amount = event.data?.amount;
    if (status === "completed" && amount?.currency !== "TZS") {
      enrichWideEvent({ "webhook.rejected": "currency" });
      return { ok: true };
    }
    await this.payments.apply(
      paymentId,
      {
        state: chargeState(status),
        amount: amount?.value ?? null,
        failureReason: event.data?.failure_reason ?? null,
      },
      { provider: "payments", id },
    );
    return { ok: true };
  }

  @Post("briq")
  @HttpCode(200)
  async smsReport(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-briq-signature") signature: string | undefined,
  ): Promise<{ ok: true }> {
    const secret = this.config.sms.webhookSecret;
    if (secret === null) throw notReady();
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    if (!validSmsSignature({ rawBody, signature: signature ?? null, secret })) {
      enrichWideEvent({ "webhook.rejected": "sms" });
      throw refused();
    }
    const event = JSON.parse(rawBody.toString("utf8")) as SmsEvent;
    await this.sms.apply({
      id: event.id ?? null,
      event: event.event ?? null,
      jobId: event.data?.job_id ?? null,
      messageId: event.data?.message_id ?? null,
    });
    return { ok: true };
  }
}
