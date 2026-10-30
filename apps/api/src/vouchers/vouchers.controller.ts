import type {
  PrintableVouchersResponse,
  RevokeResult,
  VoucherBatchDetail,
  VoucherBatchList,
  VoucherList,
} from "@hashifi/types";
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { idParam, Origin } from "../http/request-origin.js";
import { parseInput } from "../http/validation.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { batchInput, listQuery, revokeInput } from "./voucher-input.js";
import { VouchersService } from "./vouchers.service.js";

@Controller("api/vouchers")
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  list(@CurrentStaff() staff: StaffPrincipal, @Query() query: unknown): Promise<VoucherList> {
    return this.vouchers.list(staff, parseInput(listQuery, query));
  }

  @Get("batches")
  async batches(@CurrentStaff() staff: StaffPrincipal): Promise<VoucherBatchList> {
    return { batches: await this.vouchers.batches(staff) };
  }

  /** A batch with its cards, for printing: by id, so no code travels in a URL. */
  @Get("batches/:id")
  batch(
    @CurrentStaff() staff: StaffPrincipal,
    @Param("id", idParam()) id: string,
  ): Promise<VoucherBatchDetail> {
    return this.vouchers.batch(staff, id);
  }

  /** Chosen vouchers for reprinting, by id: ids are not credentials, codes are. */
  @Post("print")
  @HttpCode(200)
  async print(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
  ): Promise<PrintableVouchersResponse> {
    return { vouchers: await this.vouchers.printable(staff, parseInput(revokeInput, body).ids) };
  }

  /** Managers make batches for their own venues; admins for any. */
  @Post("batches")
  createBatch(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<VoucherBatchDetail> {
    return this.vouchers.createBatch(staff, parseInput(batchInput, body), origin);
  }

  @Post("revoke")
  @Roles("admin")
  @HttpCode(200)
  revoke(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
    @Origin() origin: RequestOrigin,
  ): Promise<RevokeResult> {
    return this.vouchers.revoke(staff, parseInput(revokeInput, body).ids, origin);
  }
}
