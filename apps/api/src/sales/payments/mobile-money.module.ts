import { Global, Module } from "@nestjs/common";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { chooseProviders } from "../providers.js";
import { MOBILE_MONEY, MobileMoney } from "./gateway.js";
import { MOBILE_MONEY_PROVIDERS } from "./providers/index.js";

/**
 * The mobile money providers set up, built at start so a missing setting stops the API there.
 * Global: the portal and the editor's preview read whether mobile money is on.
 */
@Global()
@Module({
  providers: [
    {
      provide: MOBILE_MONEY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const { active, all } = chooseProviders(
          MOBILE_MONEY_PROVIDERS,
          config.providers.payments,
          "PAYMENTS_PROVIDER",
          config.providers.context,
        );
        return new MobileMoney(active, all);
      },
    },
  ],
  exports: [MOBILE_MONEY],
})
export class MobileMoneyModule {}
