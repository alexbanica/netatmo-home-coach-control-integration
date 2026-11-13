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

function setup(options: { mappings?: typeof mapping[]; devices?: unknown[]; homes?: unknown[]; statuses?: unknown[]; writes?: unknown[]; writeErrors?: unknown[]; dryRun?: boolean } = {}) {
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
  const service = new TemperatureSynchronizationService({ mappings: options.mappings ?? [mapping], maxReadingAgeMinutes: 15, dryRun: options.dryRun ?? false }, gateway, logger, clock);
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
  assert.equal((await setup({ devices: [source(25.1)] }).service.execute()).outcomes[0]?.reason, "correction_exceeds_limit");
  assert.equal((await setup({ devices: [source(18.1)], statuses: [status(13.1)] }).service.execute()).outcomes[0]?.outcome, "updated");
});

test("dry-run performs reads and never writes", async () => {
  const s = setup({ dryRun: true }); assert.equal((await s.service.execute()).outcomes[0]?.reason, "dry_run"); assert.deepEqual(s.calls, ["coach", "homes", "status"]);
});

test("takes a new target reading on every mapping and every cycle", async () => {
  const calls: string[] = []; let statusIndex = 0;
  const gateway: SynchronizationGatewayInterface = {
    async getHomeCoachData() { return { body: { devices: [source()] } }; }, async getHomesData() { return { body: { homes: [home([{ id: "a", name: "Room A" }, { id: "b", name: "Room B" }])] } }; },
    async getHomeStatus() { calls.push("status"); const readings = [{ id: "a", temp: 20 }, { id: "b", temp: 20 }, { id: "a", temp: 21.3 }, { id: "b", temp: 20 }]; const reading = readings[statusIndex++]!; return status(reading.temp, reading.id); }, async calibrateRoom() { calls.push("write"); return { outcome: "updated" }; }
  };
  const service = new TemperatureSynchronizationService({ mappings: [mapping, { ...mapping, targetRoomName: "Room B" }], maxReadingAgeMinutes: 15, dryRun: false }, gateway, { log() {} }, { now: () => now });
  const first = await service.execute(); const second = await service.execute();
  assert.deepEqual(first.outcomes.map(({ outcome }) => outcome), ["updated", "updated"]);
  assert.deepEqual(second.outcomes.map(({ outcome }) => outcome), ["no-op", "updated"]);
  assert.equal(calls.filter((x) => x === "status").length, 4);
  assert.equal(calls.filter((x) => x === "write").length, 3);
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
