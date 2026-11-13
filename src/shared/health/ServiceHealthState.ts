import type { ServiceHealthInterface } from "./interfaces/ServiceHealthInterface.js";

type Phase = "not_started" | "waiting" | "active" | "stopped";

/** In-memory scheduler liveness state. The injected clock must be monotonic. */
export class ServiceHealthState implements ServiceHealthInterface {
  private phase: Phase = "not_started";
  private cycleStartedAt: number | undefined;
  private stopping = false;

  constructor(private readonly maxCycleMs: number, private readonly now: () => number) {
    if (!Number.isSafeInteger(maxCycleMs) || maxCycleMs <= 0) {
      throw new TypeError("maxCycleMs must be a safe positive integer");
    }
  }

  start(): void {
    if (this.stopping || this.phase === "stopped") return;
    this.phase = "waiting";
  }

  beginCycle(): void {
    if (this.stopping || this.phase === "stopped") return;
    this.cycleStartedAt = this.now();
    this.phase = "active";
  }

  finishCycle(): void {
    this.cycleStartedAt = undefined;
    if (!this.stopping && this.phase !== "stopped") this.phase = "waiting";
  }

  stop(): void {
    this.stopping = true;
    this.phase = "stopped";
    this.cycleStartedAt = undefined;
  }

  isHealthy(): boolean {
    if (this.stopping || this.phase === "not_started" || this.phase === "stopped") return false;
    if (this.phase === "waiting") return true;
    return this.cycleStartedAt !== undefined && this.now() - this.cycleStartedAt <= this.maxCycleMs;
  }
}
