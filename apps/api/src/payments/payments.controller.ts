import type {
  Capabilities,
  CustomerList,
  GuestPaymentStarted,
  GuestPaymentStatus,
  PaymentList,
  SaleResult,
} from "@hashifi/types";
import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { CurrentStaff, Public, type StaffPrincipal } from "../auth/staff-guard.js";
import { Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import {
  paymentListInput,
  paymentStatusInput,
  saleInput,
  startPaymentInput,
} from "./payment-input.js";
import { PaymentsService } from "./payments.service.js";

/** A guest buying on the portal. Public, like the rest of `/api/guest/*`. */
@Public()
@Controller("api/guest/payments")
export class GuestPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  start(@Body() body: unknown, @Req() request: Request): Promise<GuestPaymentStarted> {
    return this.payments.start(parseInput(startPaymentInput, body), request.ip ?? null);
  }

  @Post("status")
  @HttpCode(200)
  status(@Body() body: unknown): Promise<GuestPaymentStatus> {
    return this.payments.status(parseInput(paymentStatusInput, body));
  }
}

@Controller("api")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** What this installation can offer, so the admin shows only what works. */
  @Get("capabilities")
  capabilities(): Capabilities {
    return this.payments.capabilities();
  }

  @Get("payments")
  async list(@CurrentStaff() staff: StaffPrincipal, @Query() query: unknown): Promise<PaymentList> {
    return { payments: await this.payments.list(staff, parseInput(paymentListInput, query)) };
  }

  @Get("customers")
  async customers(@CurrentStaff() staff: StaffPrincipal): Promise<CustomerList> {
    return { customers: await this.payments.customers(staff) };
  }

  /** The code is in this response: it is what staff read out, or print. */
  @Post("sales")
  sale(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<SaleResult> {
    return this.payments.recordSale(staff, parseInput(saleInput, body), origin);
  }
}
