import { lstat, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { CalibrationStateRecord, CalibrationStateStoreInterface } from "../../application/ports/CalibrationStateStoreInterface.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateState(value: unknown): readonly CalibrationStateRecord[] {
  if (!Array.isArray(value)) throw new Error("Calibration state file must contain an array");
  const seen = new Set<string>();
  const records = value.map((item, index): CalibrationStateRecord => {
    if (!isRecord(item)) throw new Error(`Calibration state record ${index + 1} must be an object`);
    const keys = Object.keys(item);
    const expected = ["homeId", "roomId", "preWriteTemperature"] as const;
    if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
      throw new Error(`Calibration state record ${index + 1} has invalid fields`);
    }
    if (typeof item.homeId !== "string" || item.homeId.trim() === "" ||
        typeof item.roomId !== "string" || item.roomId.trim() === "" ||
        typeof item.preWriteTemperature !== "number" || !Number.isFinite(item.preWriteTemperature) ||
        Math.round(item.preWriteTemperature * 10) / 10 !== item.preWriteTemperature) {
      throw new Error(`Calibration state record ${index + 1} is invalid`);
    }
    const key = JSON.stringify([item.homeId, item.roomId]);
    if (seen.has(key)) throw new Error("Calibration state file contains duplicate rooms");
    seen.add(key);
    return Object.freeze({ homeId: item.homeId, roomId: item.roomId, preWriteTemperature: item.preWriteTemperature });
  });
  return Object.freeze(records);
}

export class CalibrationStateFileStore implements CalibrationStateStoreInterface {
  private constructor(private readonly filePath: string) {}

  static async open(filePath: string, configFile: string): Promise<{ readonly store: CalibrationStateFileStore; readonly records: readonly CalibrationStateRecord[] }> {
    const requestedPath = resolve(filePath);
    const configPath = resolve(configFile);
    if (requestedPath === configPath) throw new Error("Calibration state file must differ from configuration file");

    try {
      const [realDirectory, realConfig] = await Promise.all([realpath(dirname(requestedPath)), realpath(configPath)]);
      let canonicalPath = join(realDirectory, basename(requestedPath));
      if (canonicalPath === realConfig) throw new Error("Calibration state file must differ from configuration file");
      try {
        canonicalPath = await realpath(canonicalPath);
      } catch (error) {
        if (!isRecord(error) || error.code !== "ENOENT") throw new Error("Unable to resolve calibration state file");
      }
      if (canonicalPath === realConfig) throw new Error("Calibration state file must differ from configuration file");
      try {
        const [stateInfo, configInfo] = await Promise.all([stat(canonicalPath), stat(realConfig)]);
        if (stateInfo.dev === configInfo.dev && stateInfo.ino === configInfo.ino) {
          throw new Error("Calibration state file must differ from configuration file");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "Calibration state file must differ from configuration file") throw error;
        if (!isRecord(error) || error.code !== "ENOENT") throw new Error("Unable to inspect calibration state file");
      }

      let contents: string;
      try {
        const fileInfo = await lstat(canonicalPath);
        if (!fileInfo.isFile()) throw new Error("Calibration state path is not a regular file");
        contents = await readFile(canonicalPath, "utf8");
      } catch (error) {
        if (!isRecord(error) || error.code !== "ENOENT") throw new Error("Unable to read calibration state file");
        let created = false;
        try {
          const handle = await open(canonicalPath, "wx");
          created = true;
          try { await handle.writeFile("[]\n", "utf8"); }
          finally { await handle.close(); }
        } catch (createError) {
          if (created) {
            try { await unlink(canonicalPath); } catch { /* Retain the sanitized creation failure. */ }
          }
          throw new Error("Unable to create calibration state file");
        }
        contents = await readFile(canonicalPath, "utf8");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(contents) as unknown;
      } catch {
        throw new Error("Calibration state file is not valid JSON");
      }
      return { store: new CalibrationStateFileStore(canonicalPath), records: validateState(parsed) };
    } catch (error) {
      if (error instanceof Error && error.message === "Calibration state file must differ from configuration file") throw error;
      if (error instanceof Error && (error.message.startsWith("Calibration state") || error.message.startsWith("Unable to "))) throw error;
      throw new Error("Unable to initialize calibration state file");
    }
  }

  async save(records: readonly CalibrationStateRecord[]): Promise<void> {
    const validated = validateState(records);
    const temporaryPath = join(dirname(this.filePath), `.${basename(this.filePath)}.${randomUUID()}.tmp`);
    let temporaryCreated = false;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx");
      temporaryCreated = true;
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
      temporaryCreated = false;
    } catch {
      if (handle) {
        try { await handle.close(); } catch { /* Preserve the sanitized save failure. */ }
      }
      if (temporaryCreated) {
        try { await unlink(temporaryPath); } catch { /* Preserve the original sanitized save failure. */ }
      }
      throw new Error("Unable to save calibration state file");
    }
  }
}
