import test from "node:test";
import assert from "node:assert/strict";
import { MappingResolver } from "../../../src/domain/services/MappingResolver.js";

const mapping = { sourceDeviceName: "Coach", targetHomeName: "Home", targetRoomName: "Room" };
const homes = { body: { homes: [{ id: "home-id", name: "Home", rooms: [{ id: "room-id", name: "Room" }] }] } };

function resolveSource(moduleName: unknown) {
  const device = {
    station_name: "Coach",
    dashboard_data: { Temperature: 21.26, time_utc: 1_800_000_000 },
    ...(moduleName === undefined ? {} : { module_name: moduleName })
  };
  return new MappingResolver().resolve({ body: { devices: [device] } }, homes, mapping);
}

test("mapping resolver falls back to station_name when module_name is not a string", () => {
  for (const moduleName of [undefined, null, 42]) {
    assert.deepEqual(resolveSource(moduleName), {
      mapping,
      sourceTemperature: 21.26,
      timestamp: 1_800_000_000,
      homeId: "home-id",
      roomId: "room-id"
    }, `module_name=${String(moduleName)}`);
  }
});

test("mapping resolver preserves empty and case-mismatched string module names without fallback", () => {
  for (const moduleName of ["", "coach"]) {
    assert.deepEqual(resolveSource(moduleName), { mapping, reason: "source_not_found" }, `module_name=${JSON.stringify(moduleName)}`);
  }
});
