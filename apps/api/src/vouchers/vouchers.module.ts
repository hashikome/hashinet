import { Module } from "@nestjs/common";
import { VouchersController } from "./vouchers.controller.js";
import { VouchersService } from "./vouchers.service.js";

@Module({
  controllers: [VouchersController],
  providers: [VouchersService],
})
export class VouchersModule {}
