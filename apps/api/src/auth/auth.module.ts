import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessGuard } from "../core/access/access.guard.js";
import type { AppConfig } from "../core/config/config.js";
import { APP_CONFIG } from "../core/config/config.module.js";
import { PrismaService } from "../core/database/prisma.service.js";
import { EMAIL_SENDER, type EmailSender } from "../core/email/email-sender.js";
import { BETTER_AUTH, createAuth } from "./create-auth.js";
import { MeController } from "./me.controller.js";

@Global()
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: BETTER_AUTH,
      inject: [APP_CONFIG, PrismaService, EMAIL_SENDER],
      useFactory: (config: AppConfig, db: PrismaService, email: EmailSender) =>
        createAuth({ config, db, email }),
    },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [BETTER_AUTH],
})
export class AuthModule {}
