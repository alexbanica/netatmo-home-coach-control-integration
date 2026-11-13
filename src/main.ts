import { pathToFileURL } from "node:url";
import { AppFactory } from "./AppFactory.js";
import { StructuredLogger } from "./shared/logging/StructuredLogger.js";
import { SystemClock } from "./shared/clock/SystemClock.js";

function startupOutcome(error: unknown): string {
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : "";
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

export async function main(options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<number> {
  const logger = new StructuredLogger();
  const clock = new SystemClock();
  let runtime;
  try { runtime = await AppFactory.buildService({ ...options, logger, clock }); }
  catch (error) { logger.log({ event: "startup_failed", level: "error", outcome: startupOutcome(error) }); return 1; }
  if (!runtime.config.credentials.refreshToken) {
    logger.log({ event: "oauth_refresh_unavailable", level: "warn", outcome: "access_token_only" });
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    await runtime.scheduler.run({ signal: controller.signal });
    return 0;
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
