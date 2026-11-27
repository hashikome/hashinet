import { Module } from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { SecretBox } from "../crypto/secret-box.js";
import { PrismaService } from "../database/prisma.service.js";
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
