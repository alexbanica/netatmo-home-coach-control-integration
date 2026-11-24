import test from "node:test";
import assert from "node:assert/strict";
import { TemperatureSynchronizationService } from "../../../src/application/services/TemperatureSynchronizationService.js";
import type { SynchronizationGatewayInterface, CalibrationRequest } from "../../../src/application/ports/SynchronizationGatewayInterface.js";
import type { LoggerInterface } from "../../../src/shared/logging/interfaces/LoggerInterface.js";
import type { ClockInterface } from "../../../src/shared/clock/interfaces/ClockInterface.js";

const now = 1_800_000_000_000;
const mapping = { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room A" };
const source = (temp = 21.26, time = now / 1000, name = "Coach A") => ({ module_name: name, dashboard_data: { Temperature: temp, time_utc: time } });
const home = (rooms: unknown[] = [{ id: "room-id", name: "Room A" }]) => ({ id: "home-id", name: "Home", rooms });
const status = (temp: unknown = 20.04, id = "room-id") => ({ body: { home: { rooms: [{ id, therm_measured_temperature: temp }] } } });

function setup(options: { mappings?: typeof mapping[]; devices?: unknown[]; homes?: unknown[]; statuses?: unknown[]; writes?: unknown[]; writeErrors?: unknown[]; dryRun?: boolean; retryUnchangedCycles?: number; maxCorrectionC?: number; records?: readonly { homeId: string; roomId: string; preWriteTemperature: number }[]; store?: { save(records: readonly { homeId: string; roomId: string; preWriteTemperature: number }[]): Promise<void> } } = {}) {
  const calls: string[] = [];
  const logs: Readonly<Record<string, unknown>>[] = [];
  const requests: CalibrationRequest[] = [];
  let time = now;
  let statusIndex = 0;
  let writeIndex = 0;
  const gateway: SynchronizationGatewayInterface = {
    async getHomeCoachData() { calls.push("coach"); return { body: { devices: options.devices ?? [source()] } }; },
    async getHomesData() { calls.push("homes"); return { body: { homes: options.homes ?? [home()] } }; },
    async getHomeStatus() { calls.push("status"); return (options.statuses ?? [status()])[statusIndex++]; },
    async calibrateRoom(request: CalibrationRequest) {
      requests.push(request);
      calls.push("write"); const i = writeIndex++;
      if (options.writeErrors?.[i]) throw options.writeErrors[i];
      return options.writes?.[i] ?? { outcome: "updated" };
    }
  };
  const logger: LoggerInterface = { log(entry) { logs.push(entry); } };
  const clock: ClockInterface = { now: () => time };
  const service = new TemperatureSynchronizationService({ mappings: options.mappings ?? [mapping], maxReadingAgeMinutes: 15, dryRun: options.dryRun ?? false, retryUnchangedCycles: options.retryUnchangedCycles, maxCorrectionC: options.maxCorrectionC, calibrationStateRecords: options.records }, gateway, logger, clock, options.store);
  return { calls, logs, requests, service, gateway, setTime(value: number) { time = value; } };
}

test("maps exact names, rounds values, and sends fresh target data in the expected request", async () => {
  const controller = new AbortController();
  const s = setup(); const result = await s.service.execute({ cycleId: 9, signal: controller.signal });
  assert.deepEqual(s.calls, ["coach", "homes", "status", "write"]);
  assert.equal(result.outcomes[0]?.outcome, "updated");
  assert.equal(s.logs[0]?.cycleId, 9);
  const request = s.requests[0];
  assert.equal(request?.homeId, "home-id");
  assert.equal(request?.roomId, "room-id");
  assert.equal(request?.currentTemperature, 20);
  assert.equal(request?.correctedTemperature, 21.3);
  assert.equal(request?.signal, controller.signal);
  const beforeWrite = request?.beforeWrite;
  assert.equal(typeof beforeWrite, "function");
  assert.equal(beforeWrite?.(), undefined);
});

test("rejects ambiguous or missing source, home, and room mappings", async () => {
  const cases = [
    { devices: [source(), source()], reason: "source_ambiguous" },
    { devices: [], reason: "source_not_found" },
    { homes: [home(), home()], reason: "home_ambiguous" },
    { homes: [], reason: "home_not_found" },
    { homes: [home([{ id: "1", name: "Room A" }, { id: "2", name: "Room A" }])], reason: "room_ambiguous" }
  ];
  for (const item of cases) { const s = setup(item); assert.equal((await s.service.execute()).outcomes[0]?.reason, item.reason); assert.equal(s.calls.includes("write"), false); }
});

test("supports exact station name fallback without case folding", async () => {
  const valid = setup({ devices: [{ station_name: "Coach A", dashboard_data: source().dashboard_data }] });
  assert.equal((await valid.service.execute()).outcomes[0]?.outcome, "updated");
  const invalid = setup({ devices: [{ station_name: "coach a", dashboard_data: source().dashboard_data }] });
  assert.equal((await invalid.service.execute()).outcomes[0]?.reason, "source_not_found");
});

test("rejects absent, nonnumeric and nonfinite source temperatures and timestamps", async () => {
  const values = [{}, { Temperature: "21", time_utc: now / 1000 }, { Temperature: Infinity, time_utc: now / 1000 }, { Temperature: 21 }, { Temperature: 21, time_utc: NaN }];
  for (const dashboard_data of values) { const s = setup({ devices: [{ module_name: "Coach A", dashboard_data }] }); const o = (await s.service.execute()).outcomes[0]; assert.ok(o?.reason === "source_temperature_invalid" || o?.reason === "source_timestamp_invalid"); assert.equal(s.calls.includes("status"), false); }
  const invalidTimestamp = setup({ devices: [source(21.26, NaN)] });
  const invalidOutcome = (await invalidTimestamp.service.execute()).outcomes[0];
  assert.equal(invalidOutcome?.reason, "source_timestamp_invalid");
  assert.equal(invalidOutcome?.sourceTemperature, 21.3);
  assert.equal(invalidTimestamp.logs[0]?.sourceTemperature, 21.3);
});

test("rejects stale and excessive future readings, while allowing the one minute boundary", async () => {
  for (const [time, reason] of [[now / 1000 - 901, "source_stale"], [now / 1000 + 61, "source_timestamp_future"]] as const) {
    const s = setup({ devices: [source(21, time)] }); assert.equal((await s.service.execute()).outcomes[0]?.reason, reason);
  }
  assert.equal((await setup({ devices: [source(21, now / 1000 + 60)] }).service.execute()).outcomes[0]?.outcome, "updated");
});

test("freshness validation precedes target discovery and preserves the rounded source diagnostic", async () => {
  const s = setup({ devices: [source(21.26, now / 1000 - 901)], homes: [] });
  const outcome = (await s.service.execute()).outcomes[0];
  assert.equal(outcome?.reason, "source_stale");
  assert.equal(outcome?.sourceTemperature, 21.3);
  assert.equal(s.logs[0]?.sourceTemperature, 21.3);
  assert.equal(s.calls.includes("status"), false);

  const freshSourceMissingHome = setup({ devices: [source(21.26)], homes: [] });
  const missingHomeOutcome = (await freshSourceMissingHome.service.execute()).outcomes[0];
  assert.equal(missingHomeOutcome?.reason, "home_not_found");
  assert.equal(missingHomeOutcome?.sourceTemperature, 21.3);
  assert.equal(freshSourceMissingHome.logs[0]?.sourceTemperature, 21.3);
});

test("skips absent, unavailable, unreachable and invalid target room data", async () => {
  const cases = [
    { statuses: [{ body: { home: { rooms: [] } } }], reason: "target_status_missing" },
    { statuses: [undefined], reason: "target_status_missing" },
    { statuses: [status("20")], reason: "target_temperature_invalid" },
    { homes: [home([{ id: "room-id", name: "Room A", reachable: false }])], reason: "target_unreachable" },
    { homes: [home([{ name: "Room A" }])], reason: "room_unavailable" }
  ];
  for (const item of cases) assert.equal((await setup(item).service.execute()).outcomes[0]?.reason, item.reason);
});

test("rounding creates no-op and corrections over five degrees skip, exact bound writes", async () => {
  assert.equal((await setup({ devices: [source(20.04)], statuses: [status(20.03)] }).service.execute()).outcomes[0]?.outcome, "no-op");
  assert.equal((await setup({ devices: [source(25.1)] }).service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal((await setup({ devices: [source(18.1)], statuses: [status(13.1)] }).service.execute()).outcomes[0]?.outcome, "updated");
});

test("dry-run performs reads and never writes", async () => {
  const s = setup({ dryRun: true }); assert.equal((await s.service.execute()).outcomes[0]?.reason, "dry_run"); assert.deepEqual(s.calls, ["coach", "homes", "status"]);
});

test("takes a new target reading on every mapping and every cycle while holding unchanged rooms", async () => {
  const calls: string[] = []; let statusIndex = 0;
  const gateway: SynchronizationGatewayInterface = {
    async getHomeCoachData() { return { body: { devices: [source()] } }; }, async getHomesData() { return { body: { homes: [home([{ id: "a", name: "Room A" }, { id: "b", name: "Room B" }])] } }; },
    async getHomeStatus() { calls.push("status"); const readings = [{ id: "a", temp: 20 }, { id: "b", temp: 20 }, { id: "a", temp: 21.3 }, { id: "b", temp: 20 }]; const reading = readings[statusIndex++]!; return status(reading.temp, reading.id); }, async calibrateRoom() { calls.push("write"); return { outcome: "updated" }; }
  };
  const service = new TemperatureSynchronizationService({ mappings: [mapping, { ...mapping, targetRoomName: "Room B" }], maxReadingAgeMinutes: 15, dryRun: false }, gateway, { log() {} }, { now: () => now });
  const first = await service.execute(); const second = await service.execute();
  assert.deepEqual(first.outcomes.map(({ outcome }) => outcome), ["updated", "updated"]);
  assert.deepEqual(second.outcomes.map(({ outcome }) => outcome), ["no-op", "skipped"]);
  assert.equal(second.outcomes[1]?.reason, "awaiting_room_temperature_change");
  assert.equal(calls.filter((x) => x === "status").length, 4);
  assert.equal(calls.filter((x) => x === "write").length, 2);
});

test("checks source freshness again at the injected pre-write guard", async () => {
  const s = setup(); const gateway = s.gateway;
  gateway.calibrateRoom = async ({ beforeWrite }) => { s.setTime(now + 901_000); const reason = await beforeWrite?.(); if (reason) throw Object.assign(new Error(), { code: "SOURCE_STALE" }); return { outcome: "updated" }; };
  const out = await s.service.execute(); assert.equal(out.outcomes[0]?.reason, "source_stale");
});

test("preserves per-mapping failed and indeterminate writes without leaking errors", async () => {
  const s = setup({ mappings: [mapping, { ...mapping, targetRoomName: "Room B" }], homes: [home([{ id: "room-id", name: "Room A" }, { id: "room-b", name: "Room B" }])], statuses: [status(20), status(20, "room-b")], writeErrors: [Object.assign(new Error("secret error"), { outcome: "indeterminate", code: "WRITE_TRANSPORT_ERROR" })] });
  const out = await s.service.execute();
  assert.deepEqual(out.outcomes.map(({ outcome }) => outcome), ["indeterminate", "updated"]);
  assert.equal(s.calls.filter((call) => call === "write").length, 2);
  assert.equal(JSON.stringify(s.logs).includes("secret error"), false);
});

test("discovery failure fails each mapping and a rate limit stops later mappings", async () => {
  const discoveryFailure = setup();
  discoveryFailure.gateway.getHomeCoachData = async () => { throw new Error("private detail"); };
  assert.equal((await discoveryFailure.service.execute()).outcomes[0]?.reason, "discovery_failed");

  let writeCount = 0;
  const gateway: SynchronizationGatewayInterface = {
    async getHomeCoachData() { return { body: { devices: [source()] } }; },
    async getHomesData() { return { body: { homes: [home([{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])] } }; },
    async getHomeStatus(_homeId, _options) { return status(20, writeCount === 0 ? "room-id" : "room-2"); },
    async calibrateRoom() { writeCount++; throw Object.assign(new Error("limited"), { status: 429, retryAfterMs: 1250 }); }
  };
  const service = new TemperatureSynchronizationService({ mappings: [mapping, { ...mapping, targetRoomName: "Room B" }], maxReadingAgeMinutes: 15, dryRun: false }, gateway, { log() {} }, { now: () => now });
  const result = await service.execute();
  assert.equal(result.retryAfterMs, 1250);
  assert.deepEqual(result.outcomes.map(({ outcome, reason }) => [outcome, reason]), [["skipped", "rate_limited"], ["skipped", "rate_limited"]]);
  assert.equal(writeCount, 1);
});

test("abort after status prevents a write", async () => {
  const controller = new AbortController(); const s = setup(); const gateway = s.gateway;
  const statusMethod = gateway.getHomeStatus.bind(gateway); gateway.getHomeStatus = async (...args) => { const value = await statusMethod(...args); controller.abort(); return value; };
  assert.equal((await s.service.execute({ signal: controller.signal })).outcomes[0]?.reason, "aborted"); assert.equal(s.calls.includes("write"), false);
});

test("holds a successful correction for the configured unchanged cycles, then retries from fresh readings", async () => {
  const s = setup({ devices: [source(25)], statuses: [status(20), status(20), status(20), status(20)], retryUnchangedCycles: 2 });
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[1]?.correctedTemperature, 25);
});

test("only valid unchanged readings count toward a custom threshold", async () => {
  const s = setup({
    statuses: [status(20), status("bad"), undefined, status(20), status(20), status(20)],
    retryUnchangedCycles: 3
  });
  await s.service.execute();
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "target_temperature_invalid");
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "target_status_missing");
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal(s.requests.length, 2);
});

test("changed room reading releases the guard immediately", async () => {
  const s = setup({ statuses: [status(20), status(20.5)], retryUnchangedCycles: 3 });
  await s.service.execute();
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal(s.requests[1]?.currentTemperature, 20.5);
});

test("timeout permits reevaluation next cycle with the unchanged room reading", async () => {
  const timeout = () => Object.assign(new Error(), { code: "ETIMEDOUT", postTimeout: true, outcome: "indeterminate" });
  const s = setup({ writeErrors: [timeout(), timeout()], statuses: [status(20), status(20), status(20)] });
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "indeterminate");
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "indeterminate");
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal(s.requests.length, 3);
});

test("restored state begins with zero unchanged cycles", async () => {
  const s = setup({ records: [{ homeId: "home-id", roomId: "room-id", preWriteTemperature: 20 }], statuses: [status(20), status(20)] });
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
});

test("successful save preserves other records and failed save blocks later writes", async () => {
  const saved: unknown[] = [];
  const s = setup({ records: [{ homeId: "other-home", roomId: "other-room", preWriteTemperature: 18 }], statuses: [status(20), status(20.5)], store: { async save(records) { saved.push(records); } } });
  await s.service.execute();
  assert.deepEqual(saved[0], [
    { homeId: "other-home", roomId: "other-room", preWriteTemperature: 18 },
    { homeId: "home-id", roomId: "room-id", preWriteTemperature: 20 }
  ]);
  await s.service.execute();
  assert.equal((saved.at(-1) as { homeId: string }[])[0]?.homeId, "other-home");

  let saveCalls = 0;
  const failed = setup({ store: { async save() { saveCalls++; throw new Error("private path"); } }, mappings: [mapping, { ...mapping, targetRoomName: "Room B" }], homes: [home([{ id: "room-id", name: "Room A" }, { id: "room-b", name: "Room B" }])], statuses: [status(20), status(20, "room-b")] });
  const result = await failed.service.execute();
  assert.equal(result.outcomes[0]?.reason, "calibration_state_save_failed");
  assert.equal(result.outcomes[1]?.reason, "calibration_state_save_failed");
  assert.equal(failed.requests.length, 1);
  assert.equal(saveCalls, 1);
});

test("multiple mappings to the same resolved room count unchanged readings once per cycle", async () => {
  const sameRoomMappings = [mapping, { ...mapping, sourceDeviceName: "Coach B" }];
  const s = setup({ mappings: sameRoomMappings, devices: [source(25), source(25, now / 1000, "Coach B")], statuses: [status(20), status(20), status(20), status(20)], retryUnchangedCycles: 2 });
  assert.deepEqual((await s.service.execute()).outcomes.map(({ outcome }) => outcome), ["updated", "skipped"]);
  assert.equal((await s.service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal(s.requests.length, 1);
});

test("timeout blocks an aliased mapping for the rest of its cycle, then uses the next changed reading", async () => {
  const aliases = [mapping, { ...mapping, sourceDeviceName: "Coach B" }];
  const s = setup({ mappings: aliases, devices: [source(25), source(25, now / 1000, "Coach B")], statuses: [status(20), status(21), status(21)], writeErrors: [Object.assign(new Error(), { postTimeout: true, outcome: "indeterminate" })] });
  const first = await s.service.execute();
  assert.equal(first.outcomes[0]?.outcome, "indeterminate");
  assert.equal(first.outcomes[1]?.reason, "awaiting_room_temperature_change");
  assert.equal(s.requests.length, 1);
  assert.equal((await s.service.execute()).outcomes[0]?.outcome, "updated");
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[1]?.currentTemperature, 21);
});

test("a second timeout on an aliased mapping also blocks the remaining same-cycle POST", async () => {
  const aliases = [mapping, { ...mapping, sourceDeviceName: "Coach B" }];
  const timeout = () => Object.assign(new Error(), { postTimeout: true, outcome: "indeterminate" });
  const s = setup({ mappings: aliases, devices: [source(25), source(25, now / 1000, "Coach B")], statuses: [status(20), status(20), status(20), status(20)], writeErrors: [timeout(), timeout()] });
  assert.deepEqual((await s.service.execute()).outcomes.map(({ outcome }) => outcome), ["indeterminate", "skipped"]);
  assert.deepEqual((await s.service.execute()).outcomes.map(({ outcome }) => outcome), ["indeterminate", "skipped"]);
  assert.equal(s.requests.length, 2);
});

test("changed Home Coach reference is recalculated after a hold and a threshold no-op stays eligible", async () => {
  let coachTemperature = 25;
  const candidates: number[] = [];
  const gateway: SynchronizationGatewayInterface = {
    async getHomeCoachData() { return { body: { devices: [source(coachTemperature)] } }; },
    async getHomesData() { return { body: { homes: [home()] } }; },
    async getHomeStatus() { return status(20); },
    async calibrateRoom(request) {
      candidates.push(request.correctedTemperature);
      return { outcome: candidates.length === 2 ? "no-op" : "updated" };
    }
  };
  const service = new TemperatureSynchronizationService({ mappings: [mapping], maxReadingAgeMinutes: 15, dryRun: false, retryUnchangedCycles: 2 }, gateway, { log() {} }, { now: () => now });
  assert.equal((await service.execute()).outcomes[0]?.outcome, "updated");
  coachTemperature = 24;
  assert.equal((await service.execute()).outcomes[0]?.reason, "awaiting_room_temperature_change");
  assert.equal((await service.execute()).outcomes[0]?.outcome, "no-op");
  assert.equal((await service.execute()).outcomes[0]?.outcome, "updated");
  assert.deepEqual(candidates, [25, 24, 24]);
});

test("non-successful writes and dry-run do not persist state", async () => {
  let saves = 0;
  const store = { async save() { saves++; } };
  await setup({ store, writeErrors: [Object.assign(new Error(), { outcome: "failed" })] }).service.execute();
  await setup({ store, writes: [{ outcome: "no-op" }] }).service.execute();
  await setup({ store, devices: [source(20)], statuses: [status(20)] }).service.execute();
  await setup({ store, dryRun: true }).service.execute();
  const stale = setup({ store });
  stale.gateway.calibrateRoom = async ({ beforeWrite }) => { stale.setTime(now + 901_000); await beforeWrite?.(); throw Object.assign(new Error(), { code: "SOURCE_STALE" }); };
  await stale.service.execute();
  assert.equal(saves, 0);
});

test("failed state save is flushed next cycle before another room can write", async () => {
  let saves = 0;
  const store = { async save() { saves++; if (saves === 1) throw new Error("private path"); } };
  const s = setup({ mappings: [mapping, { ...mapping, targetRoomName: "Room B" }], homes: [home([{ id: "room-id", name: "Room A" }, { id: "room-b", name: "Room B" }])], statuses: [status(20), status(20, "room-b"), status(20), status(20, "room-b")], store });
  const first = await s.service.execute();
  assert.equal(first.outcomes[0]?.reason, "calibration_state_save_failed");
  assert.equal(first.outcomes[1]?.reason, "calibration_state_save_failed");
  assert.equal(s.requests.length, 1);
  await s.service.execute();
  assert.equal(saves, 3);
  assert.equal(s.requests.length, 2);
});
