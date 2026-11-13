import type { ClockInterface } from "../../shared/clock/interfaces/ClockInterface.js";
import type { LoggerInterface } from "../../shared/logging/interfaces/LoggerInterface.js";
import type { ServiceHealthInterface } from "../../shared/health/interfaces/ServiceHealthInterface.js";
const MAX_TIMER_DELAY_MS = 2_147_483_647;
function abortError(): Error { const error = new Error("Operation aborted"); error.name = "AbortError"; return error; }
export async function sleep(delayMs: number, options: { signal?: AbortSignal; now?: () => number } = {}): Promise<void> {
  const { signal, now = Date.now } = options;
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError("delayMs must be a nonnegative finite number");
  const deadline = now() + delayMs;
  while (true) {
    if (signal?.aborted) throw abortError();
    const remaining = deadline - now(); if (remaining <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, Math.min(remaining, MAX_TIMER_DELAY_MS));
      function cleanup(): void { signal?.removeEventListener("abort", aborted); }
      function done(): void { cleanup(); resolve(); }
      function aborted(): void { clearTimeout(timer); cleanup(); reject(abortError()); }
      signal?.addEventListener("abort", aborted, { once: true }); if (signal?.aborted) aborted();
    });
  }
}
export interface SchedulerCycleResult { readonly retryAfterMs?: number; }
export class SerialScheduler {
  constructor(private readonly options: { runCycle: (input: { cycleId: number; signal?: AbortSignal }) => Promise<SchedulerCycleResult | void>; intervalMs: number; clock: ClockInterface; logger: LoggerInterface; wait?: typeof sleep; health?: ServiceHealthInterface }) {}
  async run({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    const { runCycle, intervalMs, clock, logger, wait = sleep } = this.options;
    if (typeof runCycle !== "function") throw new TypeError("runCycle must be a function");
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError("intervalMs must be positive");
    const { health } = this.options;
    health?.start();
    let cycleId = 1;
    try {
      while (!signal?.aborted) {
        let result: SchedulerCycleResult | void = undefined;
        health?.beginCycle();
        try { result = await runCycle({ cycleId, signal }); }
        catch { if (!signal?.aborted) logger.log({ event: "cycle_failed", level: "error", cycleId, errorCode: "ERR_NETWORK" }); }
        finally { health?.finishCycle(); }
        if (signal?.aborted) break;
        const retry = result?.retryAfterMs;
        const delay = Math.max(intervalMs, typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? retry : 0);
        try { await wait(delay, { signal, now: () => clock.now() }); }
        catch (error) { if (!signal?.aborted && !(error instanceof Error && error.name === "AbortError")) logger.log({ event: "scheduler_wait_failed", level: "error", cycleId, errorCode: "ERR_NETWORK" }); break; }
        cycleId += 1;
      }
    } finally {
      health?.stop();
    }
  }
}
