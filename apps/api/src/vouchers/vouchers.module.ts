import { Module } from "@nestjs/common";
import { RoutersModule } from "../network/routers/routers.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { VouchersController } from "./vouchers.controller.js";
import { VouchersService } from "./vouchers.service.js";

@Module({
  imports: [RoutersModule, SessionsModule],
  controllers: [VouchersController],
  providers: [VouchersService],
})
export class VouchersModule {}
