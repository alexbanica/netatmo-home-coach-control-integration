import { EnvironmentConfigLoader } from "./infrastructure/config/EnvironmentConfigLoader.js";
import { HttpClient } from "./infrastructure/http/HttpClient.js";
import { OAuthClient } from "./infrastructure/netatmo/OAuthClient.js";
import { WebSession } from "./infrastructure/netatmo/WebSession.js";
import { NetatmoClient } from "./infrastructure/netatmo/NetatmoClient.js";
import { TemperatureSynchronizationService } from "./application/services/TemperatureSynchronizationService.js";
import { SerialScheduler } from "./infrastructure/scheduling/SerialScheduler.js";
import type { ServiceConfigurationInterface } from "./shared/config/ServiceConfigurationInterface.js";
import type { LoggerInterface } from "./shared/logging/interfaces/LoggerInterface.js";
import type { ClockInterface } from "./shared/clock/interfaces/ClockInterface.js";

export class AppFactory {
  static async buildService(options: { env?: NodeJS.ProcessEnv; cwd?: string; fetchImpl?: typeof fetch; logger: LoggerInterface; clock: ClockInterface }) {
    const config: ServiceConfigurationInterface = await new EnvironmentConfigLoader().load({ env: options.env, cwd: options.cwd });
    const httpClient = new HttpClient({ fetchImpl: options.fetchImpl });
    const oauthClient = new OAuthClient({ httpClient, ...config.credentials });
    const webSession = new WebSession({ httpClient, username: config.credentials.username, password: config.credentials.password });
    const gateway = new NetatmoClient({ oauthClient, webSession, httpClient });
    const service = new TemperatureSynchronizationService({ maxReadingAgeMinutes: config.maxReadingAgeMinutes, dryRun: config.dryRun, mappings: config.mappings }, gateway, options.logger, options.clock);
    const scheduler = new SerialScheduler({ runCycle: (input) => service.execute(input), intervalMs: config.syncIntervalMinutes * 60_000, clock: options.clock, logger: options.logger });
    return { config, service, scheduler, gateway, httpClient, oauthClient, webSession };
  }
}
