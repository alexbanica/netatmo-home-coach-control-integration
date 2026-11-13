import type { LoggerInterface } from "./interfaces/LoggerInterface.js";
const ALLOWED_FIELDS = new Set(["timestamp", "level", "event", "cycleId", "mapping", "outcome", "sourceDeviceName", "targetHomeName", "targetRoomName", "sourceTemperature", "currentTemperature", "correctedTemperature", "errorCode", "durationMs"]);
const SAFE_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ERR_NETWORK", "ERR_INVALID_SESSION", "ERR_RATE_LIMIT"]);
const LEVELS = new Set(["debug", "info", "warn", "error"]);
export class StructuredLogger implements LoggerInterface {
  constructor(private readonly sink: (line: string) => void = (line) => console.log(line)) {}
  log(event: Readonly<Record<string, unknown>>): void {
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null) continue;
      if (key === "level") { if (typeof value === "string" && LEVELS.has(value)) record.level = value; continue; }
      if (key === "errorCode") { if ((typeof value === "number" && Number.isInteger(value)) || (typeof value === "string" && (/^HTTP_[1-5]\d{2}$/.test(value) || /^API_\d{1,6}$/.test(value) || SAFE_CODES.has(value)))) record.errorCode = value; continue; }
      if (key.endsWith("Temperature") || key === "durationMs" || key === "cycleId") { if (typeof value === "number" && Number.isFinite(value)) record[key] = value; continue; }
      if (typeof value === "string" && value.length <= 200) record[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
    }
    if (!record.timestamp) record.timestamp = new Date().toISOString();
    if (!record.level) record.level = "info";
    this.sink(JSON.stringify(record));
  }
}
