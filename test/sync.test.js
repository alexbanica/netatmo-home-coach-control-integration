import test from "node:test";
import assert from "node:assert/strict";
import { runCycle } from "../src/sync.js";

const initialNow = 1_800_000_000_000;
const mappings = [
  { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room A" }
];
const config = (overrides = {}) => ({ mappings, maxReadingAgeMinutes: 15, dryRun: false, ...overrides });
const source = (name = "Coach A", value = 21.26, time = initialNow / 1000) => ({ module_name: name, dashboard_data: { Temperature: value, time_utc: time } });
const home = (name = "Home", id = "home-id", rooms = [{ id: "room-id", name: "Room A" }]) => ({ id, name, rooms });
const status = (id = "room-id", temperature = 20.04, extra = {}) => ({ body: { home: { rooms: [{ id, therm_measured_temperature: temperature, ...extra }] } } });

function setup({ devices = [source()], homes = [home()], statuses = [status()], writeResults = [], writeErrors = [], onWrite, dryRun = false } = {}) {
  const calls = [];
  const logs = [];
  let statusIndex = 0;
  let writeIndex = 0;
  let currentTime = initialNow;
  const client = {
    async getHomeCoachData() { calls.push("coach"); return { body: { devices } }; },
    async getHomesData() { calls.push("homes"); return { body: { homes } }; },
    async getHomeStatus(id) { calls.push(["status", id]); return statuses[Math.min(statusIndex++, statuses.length - 1)]; },
    async calibrateRoom(args) {
      calls.push(["write", args]);
      const index = writeIndex++;
      if (writeErrors[index]) throw writeErrors[index];
      if (onWrite) return onWrite(args);
      return writeResults[index] ?? { outcome: "updated" };
    }
  };
  return {
    calls, logs, client,
    setNow(value) { currentTime = value; },
    run(overrides = {}) {
      const { config: configOverrides = {}, ...options } = overrides;
      return runCycle({ config: config({ dryRun, ...configOverrides }), client, log: (entry) => logs.push(entry), now: () => currentTime, ...options });
    }
  };
}

test("maps exact unique source, home, and room names and writes a rounded fresh temperature", async () => {
  const s = setup();
  const result = await s.run();
  assert.deepEqual(s.calls.slice(0, 3), ["coach", "homes", ["status", "home-id"]]);
  const writeArgs = s.calls.find(([name]) => name === "write")[1];
  const { beforeWrite, ...payload } = writeArgs;
  assert.deepEqual(payload, { homeId: "home-id", roomId: "room-id", currentTemperature: 20, correctedTemperature: 21.3, signal: undefined });
  assert.equal(beforeWrite(), undefined);
  assert.equal(result.outcomes[0].outcome, "updated");
});

test("rejects ambiguous or missing exact mappings without choosing an array position", async () => {
  for (const [devices, homes, reason] of [
    [[source(), source("Coach A", 19)], [home()], "source_ambiguous"],
    [[source()], [home(), home("Home", "other")], "home_ambiguous"],
    [[source()], [home("Home", "home-id", [{ id: "a", name: "Room A" }, { id: "b", name: "Room A" }])], "room_ambiguous"]
  ]) {
    const s = setup({ devices, homes });
    assert.equal((await s.run()).outcomes[0].reason, reason);
    assert.equal(s.calls.some(([name]) => name === "write" || name === "status"), false);
  }
  const missing = setup({ devices: [source("coach a")] });
  assert.equal((await missing.run()).outcomes[0].reason, "source_not_found");
});

test("uses station_name only as an exact source-name fallback", async () => {
  const fallback = setup({ devices: [{ station_name: "Coach A", dashboard_data: source().dashboard_data }] });
  assert.equal((await fallback.run()).outcomes[0].outcome, "updated");
  const mismatch = setup({ devices: [{ station_name: "coach a", dashboard_data: source().dashboard_data }] });
  assert.equal((await mismatch.run()).outcomes[0].reason, "source_not_found");
  assert.equal(mismatch.calls.some(([name]) => name === "status" || name === "write"), false);
});

test("skips missing, nonnumeric, and nonfinite source temperatures or timestamps without writes", async () => {
  const badReadings = [
    [{}, "source_temperature_invalid"],
    [{ Temperature: null, time_utc: initialNow / 1000 }, "source_temperature_invalid"],
    [{ Temperature: "21", time_utc: initialNow / 1000 }, "source_temperature_invalid"],
    [{ Temperature: Infinity, time_utc: initialNow / 1000 }, "source_temperature_invalid"],
    [{ Temperature: 21 }, "source_timestamp_invalid"],
    [{ Temperature: 21, time_utc: "1800000000" }, "source_timestamp_invalid"],
    [{ Temperature: 21, time_utc: NaN }, "source_timestamp_invalid"],
    [{ Temperature: 21, time_utc: Infinity }, "source_timestamp_invalid"]
  ];
  for (const [dashboard_data, reason] of badReadings) {
    const s = setup({ devices: [{ module_name: "Coach A", dashboard_data }] });
    assert.equal((await s.run()).outcomes[0].reason, reason);
    assert.equal(s.calls.some(([name]) => name === "status" || name === "write"), false);
  }
});

test("skips missing, unavailable, unreachable, or invalid target room state without writes", async () => {
  const cases = [
    { statuses: [{ body: { home: { rooms: [] } } }], reason: "target_status_missing", reads: 1 },
    { statuses: [status("room-id", 20, { reachable: false })], reason: "target_unreachable", reads: 1 },
    { statuses: [status("room-id", "20")], reason: "target_temperature_invalid", reads: 1 },
    { homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A", reachable: false }])], reason: "target_unreachable", reads: 0 },
    { homes: [home("Home", "home-id", [{ name: "Room A" }])], reason: "room_unavailable", reads: 0 },
    { homes: [home("Home", "home-id", [])], reason: "room_not_found", reads: 0 },
    { homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }])], statuses: [undefined], reason: "target_status_missing", reads: 1 }
  ];
  for (const item of cases) {
    const s = setup(item);
    assert.equal((await s.run()).outcomes[0].reason, item.reason);
    assert.equal(s.calls.filter(([name]) => name === "status").length, item.reads);
    assert.equal(s.calls.some(([name]) => name === "write"), false);
  }
});

test("enforces source freshness and future clock-skew boundaries", async () => {
  for (const [timestamp, reason] of [[initialNow / 1000 - 901, "source_stale"], [initialNow / 1000 + 61, "source_timestamp_future"]]) {
    const s = setup({ devices: [source("Coach A", 21, timestamp)] });
    assert.equal((await s.run()).outcomes[0].reason, reason);
    assert.equal(s.calls.some(([name]) => name === "write" || name === "status"), false);
  }
  const allowedFutureEdge = setup({ devices: [source("Coach A", 21, initialNow / 1000 + 60)] });
  assert.equal((await allowedFutureEdge.run()).outcomes[0].outcome, "updated");
});

test("rounding creates a no-op and corrections over 5C are skipped", async () => {
  const equal = setup({ devices: [source("Coach A", 20.04)], statuses: [status("room-id", 20.03)] });
  assert.equal((await equal.run()).outcomes[0].outcome, "no-op");
  assert.equal(equal.calls.some(([name]) => name === "write"), false);
  const large = setup({ devices: [source("Coach A", 25.1)], statuses: [status("room-id", 20)] });
  assert.equal((await large.run()).outcomes[0].reason, "correction_exceeds_limit");
  assert.equal(large.calls.some(([name]) => name === "write"), false);
  const exactLimit = setup({ devices: [source("Coach A", 18.1)], statuses: [status("room-id", 13.1)] });
  assert.equal((await exactLimit.run()).outcomes[0].outcome, "updated");
});

test("dry-run reads target state but never writes", async () => {
  const s = setup({ dryRun: true });
  assert.equal((await s.run()).outcomes[0].reason, "dry_run");
  assert.deepEqual(s.calls.slice(0, 3), ["coach", "homes", ["status", "home-id"]]);
  assert.equal(s.calls.some(([name]) => name === "write"), false);
});

test("reads a fresh target measurement for every mapped room and every cycle", async () => {
  const two = [mappings[0], { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room B" }];
  const s = setup({
    homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])],
    statuses: [status("room-id", 20), status("room-2", 21), status("room-id", 21.3), status("room-2", 21)]
  });
  const first = await s.run({ config: { mappings: two } });
  const second = await s.run({ config: { mappings: two } });
  assert.deepEqual(first.outcomes.map(({ outcome }) => outcome), ["updated", "updated"]);
  assert.deepEqual(second.outcomes.map(({ outcome }) => outcome), ["no-op", "updated"]);
  assert.equal(s.calls.filter(([name]) => name === "status").length, 4);
  assert.equal(s.calls.filter(([name]) => name === "write").length, 3);
});

test("business before-write guard rejects a source that expires during an injected delay", async () => {
  const s = setup({ onWrite: async ({ beforeWrite }) => {
    s.setNow(initialNow + 901_000);
    const reason = beforeWrite();
    if (reason) throw Object.assign(new Error("source expired"), { code: "SOURCE_STALE", outcome: "skipped" });
    return { outcome: "updated" };
  } });
  const result = await s.run();
  assert.equal(result.outcomes[0].reason, "source_stale");
  assert.equal(s.calls.filter(([name]) => name === "write").length, 1);
});

test("preserves independent per-mapping failure outcomes without replaying a failed write", async () => {
  const two = [mappings[0], { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room B" }];
  const s = setup({
    homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])],
    statuses: [status(), status("room-2", 20)],
    writeErrors: [Object.assign(new Error("write failed"), { outcome: "indeterminate", code: "WRITE_TRANSPORT_ERROR" })]
  });
  const result = await s.run({ config: { mappings: two } });
  assert.deepEqual(result.outcomes.map(({ outcome }) => outcome), ["indeterminate", "updated"]);
  assert.equal(s.calls.filter(([name]) => name === "write").length, 2);
  assert.equal(JSON.stringify(s.logs).includes("write failed"), false);
});

test("aborting after target status resolves prevents a domain write", async () => {
  const controller = new AbortController();
  const s = setup();
  const orig = s.client.getHomeStatus;
  s.client.getHomeStatus = async (...args) => {
    const value = await orig(...args);
    controller.abort();
    return value;
  };
  const result = await s.run({ signal: controller.signal });
  assert.equal(result.outcomes[0].reason, "aborted");
  assert.equal(s.calls.some(([name]) => name === "write"), false);
});
