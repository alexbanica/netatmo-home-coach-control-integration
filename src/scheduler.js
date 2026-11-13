const MAX_TIMER_DELAY_MS = 2_147_483_647;

function abortError() {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

/** Abort-aware timer that safely chunks delays beyond Node's timer limit. */
export async function sleep(delayMs, { signal, now = Date.now } = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError("delayMs must be a nonnegative finite number");
  const deadline = now() + delayMs;
  while (true) {
    if (signal?.aborted) throw abortError();
    const remaining = deadline - now();
    if (remaining <= 0) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, Math.min(remaining, MAX_TIMER_DELAY_MS));
      function cleanup() { signal?.removeEventListener("abort", aborted); }
      function done() { cleanup(); resolve(); }
      function aborted() {
        clearTimeout(timer);
        cleanup();
        reject(abortError());
      }
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  }
}

function retryDelay(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Run cycles serially, starting immediately and delaying only after completion. */
export async function runScheduler({ runCycle, intervalMs, signal, wait = sleep, now = Date.now, log } = {}) {
  if (typeof runCycle !== "function") throw new TypeError("runCycle must be a function");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError("intervalMs must be positive");
  if (typeof wait !== "function") throw new TypeError("wait must be a function");

  let cycleId = 1;
  while (!signal?.aborted) {
    let result;
    try {
      result = await runCycle({ cycleId, signal });
    } catch (error) {
      if (signal?.aborted) break;
      // Runtime failures are deliberately reduced to a fixed diagnostic.
      log?.({ event: "cycle_failed", level: "error", cycleId, errorCode: "ERR_NETWORK" });
    }
    if (signal?.aborted) break;
    const delay = Math.max(intervalMs, retryDelay(result?.retryAfterMs));
    try {
      await wait(delay, { signal, now });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") break;
      log?.({ event: "scheduler_wait_failed", level: "error", cycleId, errorCode: "ERR_NETWORK" });
      break;
    }
    cycleId += 1;
  }
}
