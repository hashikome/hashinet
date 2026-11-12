import type {
  PrintableVouchersResponse,
  RevokeResult,
  VoucherBatchDetail,
  VoucherBatchList,
  VoucherList,
} from "@hashinet/types";
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { batchInput, listQuery, revokeInput } from "./voucher-input.js";
import { VouchersService } from "./vouchers.service.js";

@Controller("api/vouchers")
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @Can("voucher.read")
  list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<VoucherList> {
    return this.vouchers.list(staff, parseInput(listQuery, query));
  }

  @Get("batches")
  @Can("voucher.read")
  async batches(@CurrentPrincipal() staff: Principal): Promise<VoucherBatchList> {
    return { batches: await this.vouchers.batches(staff) };
  }

  /** A batch with its cards, for printing: by id, so no code travels in a URL. */
  @Get("batches/:id")
  @Can("voucher.read")
  batch(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VoucherBatchDetail> {
    return this.vouchers.batch(staff, id);
  }

  /** Chosen vouchers for reprinting, by id: ids are not credentials, codes are. */
  @Post("print")
  @Can("voucher.print")
  @HttpCode(200)
  async print(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<PrintableVouchersResponse> {
    return { vouchers: await this.vouchers.printable(staff, parseInput(revokeInput, body).ids) };
  }

  /** Managers make batches for their own venues; admins for any. */
  @Post("batches")
  @Can("voucher.print")
  createBatch(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<VoucherBatchDetail> {
    return this.vouchers.createBatch(staff, parseInput(batchInput, body));
  }

  @Post("revoke")
  @Can("voucher.revoke")
  @HttpCode(200)
  revoke(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<RevokeResult> {
    return this.vouchers.revoke(staff, parseInput(revokeInput, body).ids);
  }
}
