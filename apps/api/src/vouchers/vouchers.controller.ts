import type { VoucherList } from "@hashinet/types";
import { Controller, Get, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { parseInput } from "../http/validation.js";
import { listQuery } from "./voucher-input.js";
import { VouchersService } from "./vouchers.service.js";

/** Vouchers are read here; each is made by its sale (`POST /api/sales`, ADR-0017). */
@Controller("api/vouchers")
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @Can("voucher.read")
  list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<VoucherList> {
    return this.vouchers.list(staff, parseInput(listQuery, query));
  }
}
