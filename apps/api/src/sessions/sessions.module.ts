import { Module } from "@nestjs/common";
import { DevicesController } from "../devices/devices.controller.js";
import { DevicesService } from "../devices/devices.service.js";
import { RoutersModule } from "../network/routers/routers.module.js";
import { SessionsController } from "./sessions.controller.js";
import { SessionsService } from "./sessions.service.js";

/** Guests on the network: their devices, and each stay under a voucher. */
@Module({
  imports: [RoutersModule],
  controllers: [SessionsController, DevicesController],
  providers: [SessionsService, DevicesService],
  exports: [SessionsService],
})
export class SessionsModule {}
