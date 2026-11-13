import test from "node:test";
import assert from "node:assert/strict";
import { runScheduler, sleep } from "../src/scheduler.js";

test("scheduler starts immediately, waits after completion, and honors the longer retry delay", async () => {
  const controller = new AbortController();
  const sequence = [];
  await runScheduler({
    intervalMs: 300,
    signal: controller.signal,
    runCycle: async ({ cycleId }) => {
      sequence.push(`start-${cycleId}`);
      await Promise.resolve();
      sequence.push(`end-${cycleId}`);
      return { retryAfterMs: cycleId === 1 ? 900 : 20 };
    },
    wait: async (ms) => {
      sequence.push(`wait-${ms}`);
      if (sequence.filter((item) => item.startsWith("start-")).length === 2) controller.abort();
    }
  });
  assert.deepEqual(sequence, ["start-1", "end-1", "wait-900", "start-2", "end-2", "wait-300"]);
});

test("a cycle is never overlapped, and abort during a cycle prevents another cycle", async () => {
  const controller = new AbortController();
  const calls = [];
  setImmediate(() => controller.abort());
  await runScheduler({
    intervalMs: 10,
    signal: controller.signal,
    runCycle: async ({ signal }) => {
      calls.push("cycle");
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    },
    wait: async () => { calls.push("wait"); }
  });
  assert.deepEqual(calls, ["cycle"]);
});

test("abort cancels a pending long-delay timer safely", async () => {
  const controller = new AbortController();
  const pending = sleep(2 ** 40, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("abort during the post-cycle wait prevents the next cycle", async () => {
  const controller = new AbortController();
  let cycles = 0;
  let enteredWait;
  const waiting = new Promise((resolve) => { enteredWait = resolve; });
  const run = runScheduler({
    intervalMs: 1000,
    signal: controller.signal,
    runCycle: async () => { cycles += 1; },
    wait: async (_delay, { signal }) => new Promise((resolve) => {
      enteredWait();
      signal.addEventListener("abort", resolve, { once: true });
    })
  });
  await waiting;
  controller.abort();
  await run;
  assert.equal(cycles, 1);
});
