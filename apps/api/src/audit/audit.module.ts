import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { AuditController } from "./audit.controller.js";
import { AuditLog } from "./audit-log.js";

/** The audit log (ADR-0012): one writer for every module, and the page that reads it. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    {
      provide: AuditLog,
      inject: [PrismaService],
      useFactory: (db: PrismaService) => new AuditLog(db),
    },
  ],
  exports: [AuditLog],
})
export class AuditModule {}
