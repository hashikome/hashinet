import type { VoucherList, VoucherListItem } from "@hashinet/types";
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../core/access/access.guard.js";
import type { Principal } from "../core/access/principal.js";
import { idParam } from "../core/http/id-param.js";
import { parseInput } from "../core/http/validation.js";
import { listQuery, refundInput } from "./voucher-input.js";
import { VouchersService } from "./vouchers.service.js";

/** Vouchers are read here; each is made by its sale (`POST /api/sales`, ADR-0017). */
@Controller("api/vouchers")
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  // Voucher codes are credentials: no browser keeps them.
  @Header("Cache-Control", "no-store")
  @Can("voucher.read")
  list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<VoucherList> {
    return this.vouchers.list(staff, parseInput(listQuery, query));
  }

  /** Frees a voucher in use for a guest whose phone changed (ADR-0015, 6). */
  @Post(":id/release")
  @HttpCode(200)
  @Can("voucher.release")
  async release(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<{ voucher: VoucherListItem }> {
    return { voucher: await this.vouchers.release(staff, id) };
  }

  /** An owner or manager gives a voucher's price back while it is not used yet (ADR-0017, 7). */
  @Post(":id/refund")
  @HttpCode(200)
  @Can("voucher.refund")
  async refund(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<{ voucher: VoucherListItem }> {
    return { voucher: await this.vouchers.refund(staff, id, parseInput(refundInput, body)) };
  }
}
