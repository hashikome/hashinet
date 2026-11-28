import { Module } from "@nestjs/common";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { SecretBox } from "../../core/crypto/secret-box.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { RadiusController } from "./radius.controller.js";
import { RadiusService } from "./radius.service.js";

@Module({
  controllers: [RadiusController],
  providers: [
    {
      provide: RadiusService,
      inject: [PrismaService, APP_CONFIG],
      useFactory: (db: PrismaService, config: AppConfig) =>
        new RadiusService(db, new SecretBox(config.encryptionKey)),
    },
  ],
})
export class RadiusModule {}
