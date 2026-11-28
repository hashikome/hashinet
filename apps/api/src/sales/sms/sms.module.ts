import { Global, Module } from "@nestjs/common";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { chooseProviders } from "../providers.js";
import { SMS_PROVIDERS } from "./providers/index.js";
import { SMS_SENDER, Texts } from "./sender.js";
import { SmsReports } from "./sms-reports.js";
import { SmsWebhooksController } from "./sms-webhooks.controller.js";

/** The SMS providers set up, built at start so a missing setting stops the API there. */
@Global()
@Module({
  controllers: [SmsWebhooksController],
  providers: [
    SmsReports,
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const { active, all } = chooseProviders(
          SMS_PROVIDERS,
          config.providers.sms,
          "SMS_PROVIDER",
          config.providers.context,
        );
        return new Texts(active, all);
      },
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
