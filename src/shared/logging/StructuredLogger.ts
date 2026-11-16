import type { LoggerInterface } from "./interfaces/LoggerInterface.js";
const ALLOWED_FIELDS = new Set(["timestamp", "level", "event", "cycleId", "mapping", "outcome", "sourceDeviceName", "targetHomeName", "targetRoomName", "sourceTemperature", "currentTemperature", "correctedTemperature", "errorCode", "durationMs", "redirectReason", "redirectHost"]);
const SAFE_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ERR_NETWORK", "ERR_INVALID_SESSION", "ERR_RATE_LIMIT",
  "ENETWORK", "EABORTED", "EHOST", "EURL", "EHEADERS", "EOPTIONS", "EMETHOD",
  "EREDIRECTLIMIT", "EREDIRECTHOST", "EREDIRECTCREDENTIALS",
  "WEB_TRANSPORT_ERROR", "WEB_RATE_LIMITED", "REDIRECT_REJECTED", "REDIRECT_INVALID", "REDIRECT_LIMIT",
  "AUTH_CHALLENGE", "LOGIN_LIMIT", "WEB_SESSION_INVALID", "WRITE_TRANSPORT_ERROR",
  "INVALID_JSON", "UNEXPECTED_SUCCESS_BODY", "CALIBRATION_REJECTED", "TOKEN_NOT_FOUND", "CSRF_INVALID", "HTTP_STATUS"
]);
const LEVELS = new Set(["debug", "info", "warn", "error"]);
const LEVEL_PRIORITY: Readonly<Record<string, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDIRECT_REASONS = new Set(["invalid_url", "scheme", "host", "credentials", "port", "post_origin", "body_forwarding", "missing_location"]);
const SAFE_REDIRECT_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
export class StructuredLogger implements LoggerInterface {
  private readonly minimumLevel: string;

  constructor(
    private readonly sink: (line: string) => void = (line) => console.log(line),
    minimumLevel: string | undefined = "info"
  ) {
    this.minimumLevel = typeof minimumLevel === "string" && LEVELS.has(minimumLevel) ? minimumLevel : "info";
  }

  log(event: Readonly<Record<string, unknown>>): void {
    const eventLevel = typeof event.level === "string" && LEVELS.has(event.level) ? event.level : "info";
    if (LEVEL_PRIORITY[eventLevel]! < LEVEL_PRIORITY[this.minimumLevel]!) return;

    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null) continue;
      if (key === "level") { if (typeof value === "string" && LEVELS.has(value)) record.level = value; continue; }
      if (key === "errorCode") { if ((typeof value === "number" && Number.isInteger(value)) || (typeof value === "string" && (/^HTTP_[1-5]\d{2}$/.test(value) || /^API_\d{1,6}$/.test(value) || SAFE_CODES.has(value)))) record.errorCode = value; continue; }
      if (key === "redirectReason") { if (typeof value === "string" && REDIRECT_REASONS.has(value)) record.redirectReason = value; continue; }
      if (key === "redirectHost") { if (typeof value === "string" && SAFE_REDIRECT_HOST.test(value)) record.redirectHost = value; continue; }
      if (key.endsWith("Temperature") || key === "durationMs" || key === "cycleId") { if (typeof value === "number" && Number.isFinite(value)) record[key] = value; continue; }
      if (typeof value === "string" && value.length <= 200) record[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
    }
    if (!record.timestamp) record.timestamp = new Date().toISOString();
    if (!record.level) record.level = "info";
    this.sink(JSON.stringify(record));
  }
}
