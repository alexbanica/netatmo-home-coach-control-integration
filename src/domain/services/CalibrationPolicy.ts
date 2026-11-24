import type { CalibrationDecision } from "../models/CalibrationTypes.js";

const MAX_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_MAX_CORRECTION_C = 5;

export class CalibrationPolicy {
  roundCelsius(value: number): number { return Math.round(value * 10) / 10; }

  sourceAgeReason(timestamp: number, maxReadingAgeMinutes: number, nowMilliseconds: number): string | undefined {
    const ageSeconds = nowMilliseconds / 1000 - timestamp;
    if (ageSeconds < -MAX_CLOCK_SKEW_SECONDS) return "source_timestamp_future";
    if (ageSeconds > maxReadingAgeMinutes * 60) return "source_stale";
    return undefined;
  }

  decide(
    sourceTemperature: number,
    targetTemperature: number,
    dryRun: boolean,
    maxCorrectionC = DEFAULT_MAX_CORRECTION_C
  ): CalibrationDecision {
    const currentTemperature = this.roundCelsius(targetTemperature);
    const sourceTenths = Math.round(this.roundCelsius(sourceTemperature) * 10);
    const currentTenths = Math.round(currentTemperature * 10);
    const differenceTenths = sourceTenths - currentTenths;
    if (differenceTenths === 0) return { outcome: "no-op", reason: "temperatures_equal", currentTemperature, correctedTemperature: currentTemperature };

    const capTenths = Math.round(maxCorrectionC * 10);
    const boundedDifferenceTenths = Math.max(-capTenths, Math.min(differenceTenths, capTenths));
    const correctedTemperature = (currentTenths + boundedDifferenceTenths) / 10;
    if (dryRun) return { outcome: "skipped", reason: "dry_run", currentTemperature, correctedTemperature };
    return { outcome: "write", currentTemperature, correctedTemperature };
  }
}
