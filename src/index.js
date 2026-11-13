import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { HttpClient } from "./http.js";
import { OAuthClient } from "./oauth.js";
import { WebSession } from "./web-session.js";
import { NetatmoClient } from "./netatmo.js";
import { logEvent } from "./logging.js";
import { runCycle } from "./sync.js";
import { runScheduler } from "./scheduler.js";

function startupOutcome(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const missing = message.match(/^Missing required environment variable: (ACCESS_TOKEN|NETATMO_USERNAME|NETATMO_PASSWORD)$/);
  if (missing) return `missing_${missing[1].toLowerCase()}`;
  if (message.startsWith("Unable to read configuration file:")) return "config_file_unavailable";
  if (message.startsWith("Configuration file is not valid JSON:")) return "config_invalid_json";
  if (message.startsWith("SYNC_INTERVAL_MINUTES must be")) return "config_invalid_interval";
  if (message.startsWith("MAX_READING_AGE_MINUTES must be")) return "config_invalid_max_age";
  if (message.includes("Duplicate target")) return "config_duplicate_target";
  if (message.includes("must be supplied together")) return "config_incomplete_refresh_credentials";
  return "invalid_configuration";
}

/** Build the runtime only after all configuration has been validated. */
export async function createService({ env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch, log = logEvent } = {}) {
  const config = await loadConfig({ env, cwd });
  const httpClient = new HttpClient({ fetchImpl });
  const oauthClient = new OAuthClient({ httpClient, ...config.credentials });
  const webSession = new WebSession({
    httpClient,
    username: config.credentials.username,
    password: config.credentials.password
  });
  const client = new NetatmoClient({ oauthClient, webSession, httpClient });
  return { config, client, httpClient, oauthClient, webSession, log };
}

/** Testable executable wrapper. Signal handlers abort both waits and HTTP work. */
export async function main({
  env = process.env,
  cwd = process.cwd(),
  processLike = process,
  fetchImpl = globalThis.fetch,
  log = logEvent,
  now = Date.now,
  wait
} = {}) {
  let service;
  try {
    service = await createService({ env, cwd, fetchImpl, log });
  } catch (error) {
    log({ event: "startup_failed", level: "error", outcome: startupOutcome(error) });
    return 1;
  }

  if (!service.config.credentials.refreshToken) {
    log({ event: "oauth_refresh_unavailable", level: "warn", outcome: "access_token_only" });
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  processLike.on("SIGINT", stop);
  processLike.on("SIGTERM", stop);
  try {
    await runScheduler({
      intervalMs: service.config.syncIntervalMinutes * 60_000,
      signal: controller.signal,
      wait,
      now,
      log,
      runCycle: ({ cycleId, signal }) => runCycle({
        config: service.config,
        client: service.client,
        log,
        now,
        signal,
        cycleId
      })
    });
    return 0;
  } finally {
    processLike.removeListener("SIGINT", stop);
    processLike.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
