import type { CalibrationDecision } from "../models/CalibrationTypes.js";

const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_CORRECTION_C = 5;

export class CalibrationPolicy {
  roundCelsius(value: number): number { return Math.round(value * 10) / 10; }

  sourceAgeReason(timestamp: number, maxReadingAgeMinutes: number, nowMilliseconds: number): string | undefined {
    const ageSeconds = nowMilliseconds / 1000 - timestamp;
    if (ageSeconds < -MAX_CLOCK_SKEW_SECONDS) return "source_timestamp_future";
    if (ageSeconds > maxReadingAgeMinutes * 60) return "source_stale";
    return undefined;
  }

  decide(sourceTemperature: number, targetTemperature: number, dryRun: boolean): CalibrationDecision {
    const correctedTemperature = this.roundCelsius(sourceTemperature);
    const currentTemperature = this.roundCelsius(targetTemperature);
    if (currentTemperature === correctedTemperature) return { outcome: "no-op", reason: "temperatures_equal", currentTemperature, correctedTemperature };
    if (Math.abs(Math.round(correctedTemperature * 10) - Math.round(currentTemperature * 10)) > MAX_CORRECTION_C * 10) {
      return { outcome: "skipped", reason: "correction_exceeds_limit", currentTemperature, correctedTemperature };
    }
    if (dryRun) return { outcome: "skipped", reason: "dry_run", currentTemperature, correctedTemperature };
    return { outcome: "write", currentTemperature, correctedTemperature };
  }
}
