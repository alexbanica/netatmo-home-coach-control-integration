import test from "node:test";
import assert from "node:assert/strict";
import { CalibrationPolicy } from "../../../src/domain/services/CalibrationPolicy.js";
import { MappingResolver } from "../../../src/domain/services/MappingResolver.js";

const mapping = { sourceDeviceName: "Coach", targetHomeName: "Home", targetRoomName: "Room" };
const discovery = (sourceName = "Coach", homeName = "Home", roomName = "Room") => ({
  coach: { body: { devices: [{ module_name: sourceName, dashboard_data: { Temperature: 21.26, time_utc: 1_800_000_000 } }] } },
  homes: { body: { homes: [{ id: "home-id", name: homeName, rooms: [{ id: "room-id", name: roomName }] }] } }
});

test("calibration policy rounds, recognizes no-op and enforces the five degree bound", () => {
  const policy = new CalibrationPolicy();
  assert.deepEqual(policy.decide(20.04, 20.03, false), { outcome: "no-op", reason: "temperatures_equal", currentTemperature: 20, correctedTemperature: 20 });
  assert.equal(policy.decide(25.1, 20, false).reason, "correction_exceeds_limit");
  assert.deepEqual(policy.decide(18.1, 13.1, false), { outcome: "write", currentTemperature: 13.1, correctedTemperature: 18.1 });
  assert.equal(policy.decide(21, 20, true).reason, "dry_run");
});

test("source freshness policy rejects stale and far-future readings with inclusive limits", () => {
  const policy = new CalibrationPolicy();
  assert.equal(policy.sourceAgeReason(1_800_000_000 - 900, 15, 1_800_000_000_000), undefined);
  assert.equal(policy.sourceAgeReason(1_800_000_000 + 60, 15, 1_800_000_000_000), undefined);
  assert.equal(policy.sourceAgeReason(1_800_000_000 - 901, 15, 1_800_000_000_000), "source_stale");
  assert.equal(policy.sourceAgeReason(1_800_000_000 + 61, 15, 1_800_000_000_000), "source_timestamp_future");
});

test("mapping resolver matches exact names and rejects ambiguous matches", () => {
  const resolver = new MappingResolver();
  const data = discovery();
  assert.deepEqual(resolver.resolve(data.coach, data.homes, mapping), { mapping, sourceTemperature: 21.26, timestamp: 1_800_000_000, homeId: "home-id", roomId: "room-id" });
  const ambiguous = { body: { devices: [...data.coach.body.devices, ...data.coach.body.devices] } };
  assert.deepEqual(resolver.resolve(ambiguous, data.homes, mapping), { mapping, reason: "source_ambiguous" });
  assert.equal("reason" in resolver.resolve(data.coach, data.homes, { ...mapping, targetRoomName: "room" }), true);
});
