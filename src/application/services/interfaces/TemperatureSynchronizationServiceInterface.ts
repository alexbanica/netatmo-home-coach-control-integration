import type { CycleOutcome } from "../../../domain/models/CalibrationTypes.js";

export interface SynchronizationExecutionOptions {
  readonly signal?: AbortSignal;
  readonly cycleId?: number | string;
}

export interface SynchronizationCycleResult {
  readonly outcomes: CycleOutcome[];
  readonly retryAfterMs: number;
}

export interface TemperatureSynchronizationServiceInterface {
  execute(options?: SynchronizationExecutionOptions): Promise<SynchronizationCycleResult>;
}
