import { EnvironmentConfigLoader } from "./infrastructure/config/EnvironmentConfigLoader.js";
import { CalibrationStateFileStore } from "./infrastructure/config/CalibrationStateFileStore.js";
import { HttpClient } from "./infrastructure/http/HttpClient.js";
import { OAuthClient } from "./infrastructure/netatmo/OAuthClient.js";
import { WebSession } from "./infrastructure/netatmo/WebSession.js";
import { NetatmoClient } from "./infrastructure/netatmo/NetatmoClient.js";
import { TemperatureSynchronizationService } from "./application/services/TemperatureSynchronizationService.js";
import { SerialScheduler } from "./infrastructure/scheduling/SerialScheduler.js";
import type { ServiceConfigurationInterface } from "./shared/config/ServiceConfigurationInterface.js";
import type { LoggerInterface } from "./shared/logging/interfaces/LoggerInterface.js";
import type { ClockInterface } from "./shared/clock/interfaces/ClockInterface.js";
import { ServiceHealthState } from "./shared/health/ServiceHealthState.js";
import { HealthEndpoint } from "./infrastructure/http/HealthEndpoint.js";

export class AppFactory {
  static async buildService(options: { env?: NodeJS.ProcessEnv; cwd?: string; fetchImpl?: typeof fetch; logger: LoggerInterface; clock: ClockInterface; onListenerError?: () => void }) {
    const config: ServiceConfigurationInterface = await new EnvironmentConfigLoader().load({ env: options.env, cwd: options.cwd });
    const httpClient = new HttpClient({ fetchImpl: options.fetchImpl });
    const oauthClient = new OAuthClient({ httpClient, ...config.credentials });
    const webSession = new WebSession({ httpClient, username: config.credentials.username, password: config.credentials.password, logger: options.logger });
    const gateway = new NetatmoClient({ oauthClient, webSession, httpClient, logger: options.logger });
    const calibrationState = await CalibrationStateFileStore.open(config.calibrationStateFile, config.configFile);
    const service = new TemperatureSynchronizationService({
      maxReadingAgeMinutes: config.maxReadingAgeMinutes,
      dryRun: config.dryRun,
      maxCorrectionC: config.maxCorrectionC,
      retryUnchangedCycles: config.retryUnchangedCycles,
      calibrationStateRecords: calibrationState.records,
      mappings: config.mappings
    }, gateway, options.logger, options.clock, calibrationState.store);
    const health = new ServiceHealthState(config.healthcheckMaxCycleMs, () => performance.now());
    const scheduler = new SerialScheduler({ runCycle: (input) => service.execute(input), intervalMs: config.syncIntervalMinutes * 60_000, clock: options.clock, logger: options.logger, health });
    return {
      config, service, scheduler, health, gateway, httpClient, oauthClient, webSession,
      healthEndpoint: new HealthEndpoint({ port: config.healthcheckPort, health, onError: () => { health.stop(); options.onListenerError?.(); } })
    };
  }
}
