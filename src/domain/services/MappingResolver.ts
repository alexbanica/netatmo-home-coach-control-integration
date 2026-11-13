import type { CalibrationMapping } from "../models/CalibrationMapping.js";
import type { MappingResolution, SourceResolution, TargetResolution } from "../models/CalibrationTypes.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function listAt(value: unknown, key: string): unknown[] {
  const field = record(value)?.[key];
  return Array.isArray(field) ? field : [];
}
function unique(items: unknown[], predicate: (item: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  const matches = items.filter((item): item is Record<string, unknown> => !!record(item) && predicate(record(item)!));
  return matches.length === 1 ? matches[0] : undefined;
}
function temperature(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function sourceName(device: Record<string, unknown>): unknown {
  return typeof device.module_name === "string" ? device.module_name : device.station_name;
}

export class MappingResolver {
  resolveSource(devicesResponse: unknown, mapping: CalibrationMapping): SourceResolution {
    const devices = listAt(record(devicesResponse)?.body, "devices");
    const matchingDevices = devices.filter((item) => {
      const device = record(item);
      return device !== undefined && sourceName(device) === mapping.sourceDeviceName;
    });
    const device = unique(devices, (item) => sourceName(item) === mapping.sourceDeviceName);
    if (!device) return { mapping, reason: matchingDevices.length > 1 ? "source_ambiguous" : "source_not_found" };
    const dashboard = record(device.dashboard_data);
    const sourceTemperature = dashboard?.Temperature;
    const timestamp = dashboard?.time_utc;
    if (!temperature(sourceTemperature)) return { mapping, reason: "source_temperature_invalid" };
    if (!temperature(timestamp)) return { mapping, reason: "source_timestamp_invalid", sourceTemperature };
    return { mapping, sourceTemperature, timestamp };
  }

  resolveTarget(homesResponse: unknown, mapping: CalibrationMapping): TargetResolution {
    const homes = listAt(record(homesResponse)?.body, "homes");
    const matchingHomes = homes.filter((item) => record(item)?.name === mapping.targetHomeName);
    const home = unique(homes, (item) => item.name === mapping.targetHomeName);
    if (!home) return { mapping, reason: matchingHomes.length > 1 ? "home_ambiguous" : "home_not_found" };
    const homeId = home.id;
    if (typeof homeId !== "string" || homeId.length === 0 || !Array.isArray(home.rooms)) return { mapping, reason: "home_unavailable" };
    const rooms = home.rooms;
    const matchingRooms = rooms.filter((item) => record(item)?.name === mapping.targetRoomName);
    const room = unique(rooms, (item) => item.name === mapping.targetRoomName);
    if (!room) return { mapping, reason: matchingRooms.length > 1 ? "room_ambiguous" : "room_not_found" };
    if (typeof room.id !== "string" || !room.id || room.reachable === false) return { mapping, reason: room.reachable === false ? "target_unreachable" : "room_unavailable" };
    return { mapping, homeId, roomId: room.id };
  }

  resolve(devicesResponse: unknown, homesResponse: unknown, mapping: CalibrationMapping): MappingResolution {
    const source = this.resolveSource(devicesResponse, mapping);
    if ("reason" in source) return source;
    const target = this.resolveTarget(homesResponse, mapping);
    if ("reason" in target) return target;
    return { mapping, sourceTemperature: source.sourceTemperature, timestamp: source.timestamp, homeId: target.homeId, roomId: target.roomId };
  }
}
