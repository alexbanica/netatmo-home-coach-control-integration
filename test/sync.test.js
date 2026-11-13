import test from "node:test";
import assert from "node:assert/strict";
import { runCycle } from "../src/sync.js";
import { NetatmoClient } from "../src/netatmo.js";
import { HttpClient } from "../src/http.js";

const now = 1_800_000_000_000;
const mappings = [
  { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room A" }
];
const config = (overrides = {}) => ({ mappings, maxReadingAgeMinutes: 15, dryRun: false, ...overrides });
const source = (name = "Coach A", value = 21.26, time = now / 1000) => ({ module_name: name, dashboard_data: { Temperature: value, time_utc: time } });
const home = (name = "Home", id = "home-id", rooms = [{ id: "room-id", name: "Room A" }]) => ({ id, name, rooms });
const status = (id = "room-id", temperature = 20.04, extra = {}) => ({ body: { home: { rooms: [{ id, therm_measured_temperature: temperature, ...extra }] } } });

function setup({ devices = [source()], homes = [home()], statuses = [status()], statusError, onStatus, writeResults = [{ outcome: "updated" }], writeErrors = [], dryRun = false } = {}) {
  const calls = [];
  const logs = [];
  let statusIndex = 0;
  let writeIndex = 0;
  const client = {
    beginCycle() { calls.push(["begin"]); },
    async getHomeCoachData(options) { calls.push(["coach", options]); return { body: { devices } }; },
    async getHomesData(options) { calls.push(["homes", options]); return { body: { homes } }; },
    async getHomeStatus(id, options) {
      calls.push(["status", id, options]);
      onStatus?.();
      if (statusError) throw statusError;
      return statuses[Math.min(statusIndex++, statuses.length - 1)];
    },
    async calibrateRoom(args) {
      calls.push(["write", args]);
      const index = writeIndex++;
      if (writeErrors[index]) throw writeErrors[index];
      return writeResults[index] ?? { outcome: "updated" };
    }
  };
  return {
    client, calls, logs,
    run(overrides = {}) {
      const { config: configOverrides = {}, ...options } = overrides;
      return runCycle({ config: config({ dryRun, ...configOverrides }), client, log: (entry) => logs.push(entry), now: () => now, ...options });
    }
  };
}

test("successful round trip resolves exact names and sends rounded fresh temperatures", async () => {
  const s = setup();
  const result = await s.run();
  assert.equal(s.calls.filter(([name]) => name === "begin").length, 1);
  assert.deepEqual(s.calls.filter(([name]) => ["coach", "homes", "status"].includes(name)).map(([name]) => name), ["coach", "homes", "status"]);
  const writeArgs = s.calls.find(([name]) => name === "write")[1];
  const { beforeWrite, ...writePayload } = writeArgs;
  assert.deepEqual(writePayload, {
    homeId: "home-id", roomId: "room-id", currentTemperature: 20, correctedTemperature: 21.3, signal: undefined
  });
  assert.equal(typeof beforeWrite, "function");
  assert.equal(beforeWrite(), undefined);
  assert.equal(result.outcomes[0].outcome, "updated");
  assert.equal(s.logs[0].sourceTemperature, 21.3);
  assert.equal(s.logs[0].currentTemperature, 20);
});

test("rechecks source age after app token verification immediately before the real HTTP write", async () => {
  async function integratedRun({ ageSeconds, abortDuringLogin = false } = {}) {
    let currentTime = now;
    const controller = new AbortController();
    const requests = [];
    const httpClient = new HttpClient({ fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push({ path, options });
      if (path.endsWith("/homesdata")) {
        currentTime += 2_000;
        return new Response(JSON.stringify({ body: { homes: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    } });
    const oauthClient = {
      async request(url) {
        if (url.endsWith("gethomecoachsdata")) return { status: 200, text: JSON.stringify({ body: { devices: [source("Coach A", 21, now / 1000 - ageSeconds)] } }) };
        if (url.endsWith("homesdata")) return { status: 200, text: JSON.stringify({ body: { homes: [home()] } }) };
        return { status: 200, text: JSON.stringify(status()) };
      }
    };
    const webSession = {
      async getAccessToken() {
        if (abortDuringLogin) controller.abort();
        return "web-token";
      }
    };
    const client = new NetatmoClient({ oauthClient, webSession, httpClient });
    const result = await runCycle({
      config: config({ maxReadingAgeMinutes: 1 }), client, now: () => currentTime,
      signal: controller.signal
    });
    return { result, requests };
  }

  const stale = await integratedRun({ ageSeconds: 59 });
  assert.equal(stale.result.outcomes[0].outcome, "skipped");
  assert.equal(stale.result.outcomes[0].reason, "source_stale");
  assert.deepEqual(stale.requests.map(({ path }) => path), ["/api/homesdata"]);

  const fresh = await integratedRun({ ageSeconds: 50 });
  assert.equal(fresh.result.outcomes[0].outcome, "updated");
  assert.deepEqual(fresh.requests.map(({ path }) => path), ["/api/homesdata", "/api/truetemperature"]);

  const aborted = await integratedRun({ ageSeconds: 50, abortDuringLogin: true });
  assert.equal(aborted.requests.some(({ path }) => path.endsWith("/truetemperature")), false);
});

test("uses exact names, rejects ambiguous sources/homes/rooms, and never picks by array position", async () => {
  for (const [devices, homes, reason] of [
    [[source("Coach A"), source("Coach A", 19)], [home()], "source_ambiguous"],
    [[source()], [home(), home("Home", "other")], "home_ambiguous"],
    [[source()], [home("Home", "home-id", [{ id: "a", name: "Room A" }, { id: "b", name: "Room A" }])], "room_ambiguous"]
  ]) {
    const s = setup({ devices, homes });
    const result = await s.run();
    assert.equal(result.outcomes[0].reason, reason);
    assert.equal(s.calls.some(([name]) => name === "write"), false);
    assert.equal(s.calls.some(([name]) => name === "status"), false);
  }
  const mismatch = setup({ devices: [source("coach a")], homes: [home()] });
  assert.equal((await mismatch.run()).outcomes[0].reason, "source_not_found");
});

test("station_name is used only as the source-name fallback", async () => {
  const s = setup({ devices: [{ station_name: "Coach A", dashboard_data: source().dashboard_data }] });
  assert.equal((await s.run()).outcomes[0].outcome, "updated");
});

test("rejects missing, nonnumeric, nonfinite, stale and over-one-minute-future source readings", async () => {
  const bad = [
    [{ Temperature: null, time_utc: now / 1000 }, "source_temperature_invalid"],
    [{ Temperature: "21", time_utc: now / 1000 }, "source_temperature_invalid"],
    [{ Temperature: Infinity, time_utc: now / 1000 }, "source_temperature_invalid"],
    [{ Temperature: 21, time_utc: "1800000000" }, "source_timestamp_invalid"],
    [{ Temperature: 21, time_utc: NaN }, "source_timestamp_invalid"],
    [{ Temperature: 21, time_utc: now / 1000 - 901 }, "source_stale"],
    [{ Temperature: 21, time_utc: now / 1000 + 61 }, "source_timestamp_future"]
  ];
  for (const [dashboard_data, reason] of bad) {
    const s = setup({ devices: [{ module_name: "Coach A", dashboard_data }] });
    const result = await s.run();
    assert.equal(result.outcomes[0].reason, reason);
    assert.equal(s.calls.some(([name]) => ["status", "write"].includes(name)), false);
  }
  const boundary = setup({ devices: [source("Coach A", 21, now / 1000 + 60)] });
  assert.equal((await boundary.run()).outcomes[0].outcome, "updated");
});

test("skips unavailable and explicitly unreachable target rooms and invalid measured values", async () => {
  const cases = [
    { statuses: [{ body: { home: { rooms: [] } } }], reason: "target_status_missing" },
    { statuses: [status("room-id", 20, { reachable: false })], reason: "target_unreachable" },
    { statuses: [status("room-id", "20")], reason: "target_temperature_invalid" },
    { homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A", reachable: false }])], reason: "target_unreachable" }
  ];
  for (const item of cases) {
    const s = setup(item);
    const result = await s.run();
    assert.equal(result.outcomes[0].reason, item.reason);
    assert.equal(s.calls.some(([name]) => name === "write"), false);
  }
});

test("rounding equality is a no-op and correction above 5C is skipped without a write", async () => {
  const equal = setup({ devices: [source("Coach A", 20.04)], statuses: [status("room-id", 20.03)] });
  assert.equal((await equal.run()).outcomes[0].outcome, "no-op");
  assert.equal(equal.calls.some(([name]) => name === "write"), false);
  const large = setup({ devices: [source("Coach A", 25.1)], statuses: [status("room-id", 20)] });
  const result = await large.run();
  assert.equal(result.outcomes[0].reason, "correction_exceeds_limit");
  assert.equal(large.calls.some(([name]) => name === "write"), false);
});

test("dry-run performs reads but never calls calibration", async () => {
  const s = setup({ dryRun: true });
  const result = await s.run();
  assert.equal(result.outcomes[0].reason, "dry_run");
  assert.equal(s.calls.some(([name]) => name === "write"), false);
});

test("keeps independent mapping failures local and fetches a fresh status for each target", async () => {
  const two = [mappings[0], { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room B" }];
  const s = setup({ homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])], statuses: [status(), status("room-2", 21.26)] });
  const result = await s.run({ config: { mappings: two } });
  assert.deepEqual(result.outcomes.map((item) => item.outcome), ["updated", "no-op"]);
  assert.equal(s.calls.filter(([name]) => name === "status").length, 2);
  assert.equal(s.calls.filter(([name]) => name === "write").length, 1);
});

test("continues after per-target failures but treats unexpected write responses as indeterminate", async () => {
  const two = [mappings[0], { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room B" }];
  const s = setup({ homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])], statuses: [status(), status("room-2", 20)], writeErrors: [Object.assign(new Error("private body"), { outcome: "indeterminate", code: "WRITE_TRANSPORT_ERROR" })] });
  const result = await s.run({ config: { mappings: two } });
  assert.equal(result.outcomes[0].outcome, "indeterminate");
  assert.equal(result.outcomes[1].outcome, "updated");
  assert.equal(s.calls.filter(([name]) => name === "write").length, 2);
  assert.equal(JSON.stringify(s.logs).includes("private body"), false);
});

test("429 stops all remaining API calls and propagates Retry-After even for transport error codes", async () => {
  const two = [mappings[0], { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room B" }];
  const limited = Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 12000, code: "WRITE_TRANSPORT_ERROR" });
  const s = setup({ homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])], writeErrors: [limited] });
  const result = await s.run({ config: { mappings: two } });
  assert.equal(result.retryAfterMs, 12000);
  assert.deepEqual(result.outcomes.map((item) => item.outcome), ["skipped", "skipped"]);
  assert.equal(result.outcomes[0].reason, "rate_limited");
  assert.equal(result.outcomes[1].reason, "rate_limited");
  assert.equal(s.calls.filter(([name]) => name === "status").length, 1);
  assert.equal(s.calls.filter(([name]) => name === "write").length, 1);
});

test("discovery rate limit halts before the next discovery or mapping call", async () => {
  const calls = [];
  const limited = Object.assign(new Error("limited"), { status: 429, retryAfterMs: 5000 });
  const client = { beginCycle() {}, async getHomeCoachData() { calls.push("coach"); throw limited; }, async getHomesData() { calls.push("homes"); } };
  const result = await runCycle({ config: config(), client, now: () => now });
  assert.deepEqual(calls, ["coach"]);
  assert.equal(result.retryAfterMs, 5000);
  assert.equal(result.outcomes[0].reason, "rate_limited");
});

test("abort halts remaining work and still returns an outcome for every mapping", async () => {
  const controller = new AbortController();
  const two = [mappings[0], { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room B" }];
  const s = setup({ homes: [home("Home", "home-id", [{ id: "room-id", name: "Room A" }, { id: "room-2", name: "Room B" }])], statusError: Object.assign(new Error("aborted"), { name: "AbortError" }) });
  const result = await s.run({ config: { mappings: two }, signal: controller.signal });
  assert.deepEqual(result.outcomes.map((item) => item.reason), ["aborted", "aborted"]);
  assert.equal(s.calls.filter(([name]) => name === "status").length, 1);
  assert.equal(s.calls.some(([name]) => name === "write"), false);
});

test("abort after target status resolves cannot start a calibration write", async () => {
  const controller = new AbortController();
  const s = setup({ onStatus: () => controller.abort() });
  const result = await s.run({ signal: controller.signal });
  assert.equal(result.outcomes[0].reason, "aborted");
  assert.equal(s.calls.some(([name]) => name === "write"), false);
});

test("rechecks source freshness after slow target reads and accepts an exact 5C boundary", async () => {
  const s = setup();
  let times = 0;
  const stale = await runCycle({ config: config(), client: s.client, log: () => {}, now: () => (times++ === 0 ? now : now + 901_000) });
  assert.equal(stale.outcomes[0].reason, "source_stale");
  assert.equal(s.calls.some(([name]) => name === "write"), false);

  const boundary = setup({ devices: [source("Coach A", 18.1)], statuses: [status("room-id", 13.1)] });
  assert.equal((await boundary.run()).outcomes[0].outcome, "updated");
});

test("concurrent runCycle calls against one client are serialized", async () => {
  let active = 0;
  let maxActive = 0;
  const client = {
    async getHomeCoachData() { active += 1; maxActive = Math.max(active, maxActive); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return { body: { devices: [source()] } }; },
    async getHomesData() { return { body: { homes: [home()] } }; },
    async getHomeStatus() { return status(); },
    async calibrateRoom() { return { outcome: "updated" }; }
  };
  const [first, second] = await Promise.all([
    runCycle({ config: config(), client, now: () => now }),
    runCycle({ config: config(), client, now: () => now })
  ]);
  assert.equal(maxActive, 1);
  assert.equal(first.outcomes[0].outcome, "updated");
  assert.equal(second.outcomes[0].outcome, "updated");
});
