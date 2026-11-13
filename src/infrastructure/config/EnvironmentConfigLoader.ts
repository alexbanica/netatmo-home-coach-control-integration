import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ServiceConfigurationInterface, ServiceCredentials, ServiceMapping } from "../../shared/config/ServiceConfigurationInterface.js";

const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_MAX_READING_AGE_MINUTES = 15;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be a safe positive integer`);
  return number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseMappings(document: unknown): readonly ServiceMapping[] {
  if (!isRecord(document)) throw new Error("Configuration must be a JSON object");
  if (Object.keys(document).some((key) => key !== "mappings")) throw new Error("Configuration contains unknown keys");
  const entries = document.mappings;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Configuration mappings must be a nonempty array");
  }
  const targets = new Set<string>();
  const mappings = entries.map((mapping, index): ServiceMapping => {
    if (!isRecord(mapping)) throw new Error(`Mapping ${index + 1} must be an object`);
    const expected = ["sourceDeviceName", "targetHomeName", "targetRoomName"] as const;
    const keys = Object.keys(mapping);
    if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
      throw new Error(`Mapping ${index + 1} must contain only sourceDeviceName, targetHomeName and targetRoomName`);
    }
    for (const key of expected) {
      if (typeof mapping[key] !== "string" || mapping[key].trim() === "") {
        throw new Error(`Mapping ${index + 1} requires a nonempty ${key}`);
      }
    }
    const sourceDeviceName = mapping.sourceDeviceName as string;
    const targetHomeName = mapping.targetHomeName as string;
    const targetRoomName = mapping.targetRoomName as string;
    const target = JSON.stringify([targetHomeName, targetRoomName]);
    if (targets.has(target)) throw new Error(`Duplicate target in mapping ${index + 1}`);
    targets.add(target);
    return Object.freeze({ sourceDeviceName, targetHomeName, targetRoomName });
  });
  return Object.freeze(mappings);
}

export interface EnvironmentConfigLoadOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

/** Load and validate all configuration before callers perform any network work.
 * Returns secrets separately from public runtime settings; never logs this object.
 */
export async function loadConfig({ env = process.env, cwd = process.cwd() }: EnvironmentConfigLoadOptions = {}): Promise<ServiceConfigurationInterface> {
  const configPath = resolve(cwd, env.CONFIG_FILE || "./config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new Error(`Unable to read configuration file: ${configPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Configuration file is not valid JSON: ${configPath}`);
  }
  const mappings = parseMappings(parsed);

  const syncIntervalMinutes = positiveInteger(env.SYNC_INTERVAL_MINUTES, "SYNC_INTERVAL_MINUTES", DEFAULT_SYNC_INTERVAL_MINUTES);
  const maxReadingAgeMinutes = positiveInteger(env.MAX_READING_AGE_MINUTES, "MAX_READING_AGE_MINUTES", DEFAULT_MAX_READING_AGE_MINUTES);
  const dryRunValue = env.DRY_RUN ?? "false";
  if (dryRunValue !== "true" && dryRunValue !== "false") throw new Error("DRY_RUN must be exactly true or false");

  const refreshKeys = ["REFRESH_TOKEN", "CLIENT_ID", "CLIENT_SECRET"] as const;
  const suppliedRefreshKeys = refreshKeys.filter((key) => typeof env[key] === "string" && env[key]?.trim() !== "");
  if (suppliedRefreshKeys.length !== 0 && suppliedRefreshKeys.length !== refreshKeys.length) {
    throw new Error("REFRESH_TOKEN, CLIENT_ID and CLIENT_SECRET must be supplied together");
  }

  const credentials: ServiceCredentials = Object.freeze({
    accessToken: required(env, "ACCESS_TOKEN"),
    refreshToken: suppliedRefreshKeys.length ? env.REFRESH_TOKEN : undefined,
    clientId: suppliedRefreshKeys.length ? env.CLIENT_ID : undefined,
    clientSecret: suppliedRefreshKeys.length ? env.CLIENT_SECRET : undefined,
    username: required(env, "NETATMO_USERNAME"),
    password: required(env, "NETATMO_PASSWORD")
  });

  return Object.freeze({
    configFile: configPath,
    syncIntervalMinutes,
    maxReadingAgeMinutes,
    dryRun: dryRunValue === "true",
    credentials,
    mappings
  });
}

export class EnvironmentConfigLoader {
  load(options: EnvironmentConfigLoadOptions = {}): Promise<ServiceConfigurationInterface> {
    return loadConfig(options);
  }
}
