import { logEvent } from "./logging.js";

const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_CORRECTION_C = 5;
const cycleLocks = new WeakMap();

function record(log, fields) {
  try { log(fields); } catch { /* Logging must not interrupt synchronization. */ }
}

function result(mapping, outcome, reason, extra = {}) {
  return {
    sourceDeviceName: mapping.sourceDeviceName,
    targetHomeName: mapping.targetHomeName,
    targetRoomName: mapping.targetRoomName,
    outcome,
    ...(reason ? { reason } : {}),
    ...extra
  };
}

function failCode(error) {
  if (error?.status === 429) return "ERR_RATE_LIMIT";
  if (error?.status && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) return `HTTP_${error.status}`;
  if (typeof error?.code === "number" && Number.isInteger(error.code)) return `API_${error.code}`;
  if (["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ERR_NETWORK", "ERR_INVALID_SESSION"].includes(error?.code)) return error.code;
  return "ERR_NETWORK";
}

function isAbort(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function retryDelay(error) {
  return Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0 ? Math.ceil(error.retryAfterMs) : 0;
}

function stopForRateLimit(error) {
  return error?.status === 429;
}

function temperature(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function roundC(value) {
  return Math.round(value * 10) / 10;
}

function bodyOf(response, key) {
  const value = response?.body?.[key];
  return Array.isArray(value) ? value : null;
}

function sourceName(device) {
  return typeof device?.module_name === "string" ? device.module_name : device?.station_name;
}

function exactUnique(items, predicate) {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function isExplicitlyUnreachable(room) {
  return room?.reachable === false;
}

function sourceAgeReason(timestamp, config, now) {
  const ageSeconds = now() / 1000 - timestamp;
  if (ageSeconds < -MAX_CLOCK_SKEW_SECONDS) return "source_timestamp_future";
  if (ageSeconds > config.maxReadingAgeMinutes * 60) return "source_stale";
  return undefined;
}

function logOutcome(log, cycleId, mapping, entry) {
  record(log, {
    event: entry.reason ? `sync.mapping.${entry.reason}` : "sync.mapping.updated",
    cycleId,
    mapping: `${mapping.sourceDeviceName} -> ${mapping.targetHomeName}/${mapping.targetRoomName}`,
    outcome: entry.outcome,
    sourceDeviceName: mapping.sourceDeviceName,
    targetHomeName: mapping.targetHomeName,
    targetRoomName: mapping.targetRoomName,
    sourceTemperature: entry.sourceTemperature,
    currentTemperature: entry.currentTemperature,
    correctedTemperature: entry.correctedTemperature,
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {})
  });
}

/** Run one sequential synchronization cycle using only the injected Netatmo client. */
export async function runCycle({ config, client, log = logEvent, now = Date.now, signal, cycleId = 1 } = {}) {
  if (!config || !Array.isArray(config.mappings)) throw new TypeError("config.mappings is required");
  if (!client || typeof client !== "object") throw new TypeError("client is required");

  // Calls against one client are serialized so overlapping scheduler/manual invocations
  // cannot race authentication cycle state or issue concurrent writes.
  const prior = cycleLocks.get(client) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = prior.then(() => current);
  cycleLocks.set(client, queued);
  await prior;
  try {
    return await runLocked({ config, client, log, now, signal, cycleId });
  } finally {
    release();
    if (cycleLocks.get(client) === queued) cycleLocks.delete(client);
  }
}

async function runLocked({ config, client, log, now, signal, cycleId }) {
  const outcomes = [];
  let retryAfterMs = 0;
  const mappings = config.mappings;
  const completeRemaining = (from, outcome, reason, errorCode) => {
    for (let index = from; index < mappings.length; index += 1) {
      const entry = result(mappings[index], outcome, reason, errorCode ? { errorCode } : {});
      outcomes.push(entry);
      logOutcome(log, cycleId, mappings[index], entry);
    }
  };
  const haltOnError = (error, index) => {
    if (stopForRateLimit(error)) {
      retryAfterMs = retryDelay(error);
      completeRemaining(index, "skipped", "rate_limited", "ERR_RATE_LIMIT");
      return true;
    }
    if (isAbort(error, signal)) {
      completeRemaining(index, "skipped", "aborted");
      return true;
    }
    return false;
  };

  try {
    if (signal?.aborted) {
      completeRemaining(0, "skipped", "aborted");
      return { outcomes, retryAfterMs };
    }
    client.beginCycle?.();
    let coachData;
    let homesData;
    try {
      coachData = await client.getHomeCoachData({ signal });
      if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      homesData = await client.getHomesData({ signal });
    } catch (error) {
      if (haltOnError(error, 0)) return { outcomes, retryAfterMs };
      const code = failCode(error);
      completeRemaining(0, "failed", "discovery_failed", code);
      return { outcomes, retryAfterMs };
    }

    const devices = bodyOf(coachData, "devices") ?? [];
    const homes = bodyOf(homesData, "homes") ?? [];
    for (let index = 0; index < mappings.length; index += 1) {
      const mapping = mappings[index];
      if (signal?.aborted) {
        completeRemaining(index, "skipped", "aborted");
        break;
      }
      let entry;
      const device = exactUnique(devices, (candidate) => sourceName(candidate) === mapping.sourceDeviceName);
      if (!device) {
        const nameMatches = devices.filter((candidate) => sourceName(candidate) === mapping.sourceDeviceName).length;
        entry = result(mapping, "skipped", nameMatches > 1 ? "source_ambiguous" : "source_not_found");
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      const dashboard = device.dashboard_data;
      const sourceValue = dashboard?.Temperature;
      const timestamp = dashboard?.time_utc;
      if (!temperature(sourceValue)) {
        entry = result(mapping, "skipped", "source_temperature_invalid");
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (!temperature(timestamp)) {
        entry = result(mapping, "skipped", "source_timestamp_invalid", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      const initialAgeReason = sourceAgeReason(timestamp, config, now);
      if (initialAgeReason) {
        entry = result(mapping, "skipped", initialAgeReason, { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }

      const home = exactUnique(homes, (candidate) => candidate?.name === mapping.targetHomeName);
      if (!home) {
        const matches = homes.filter((candidate) => candidate?.name === mapping.targetHomeName).length;
        entry = result(mapping, "skipped", matches > 1 ? "home_ambiguous" : "home_not_found", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (typeof home.id !== "string" || home.id.length === 0 || !Array.isArray(home.rooms)) {
        entry = result(mapping, "skipped", "home_unavailable", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      const room = exactUnique(home.rooms, (candidate) => candidate?.name === mapping.targetRoomName);
      if (!room) {
        const matches = home.rooms.filter((candidate) => candidate?.name === mapping.targetRoomName).length;
        entry = result(mapping, "skipped", matches > 1 ? "room_ambiguous" : "room_not_found", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (typeof room.id !== "string" || room.id.length === 0 || isExplicitlyUnreachable(room)) {
        entry = result(mapping, "skipped", isExplicitlyUnreachable(room) ? "target_unreachable" : "room_unavailable", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }

      let status;
      try {
        status = await client.getHomeStatus(home.id, { signal });
      } catch (error) {
        if (haltOnError(error, index)) break;
        entry = result(mapping, error?.outcome || "failed", "target_status_failed", { sourceTemperature: roundC(sourceValue), errorCode: failCode(error) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (signal?.aborted) {
        completeRemaining(index, "skipped", "aborted");
        break;
      }
      const statusRooms = status?.body?.home?.rooms;
      const statusRoom = Array.isArray(statusRooms) ? exactUnique(statusRooms, (candidate) => candidate?.id === room.id) : null;
      if (!statusRoom || isExplicitlyUnreachable(statusRoom)) {
        entry = result(mapping, "skipped", statusRoom ? "target_unreachable" : "target_status_missing", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      const measured = statusRoom.therm_measured_temperature;
      if (!temperature(measured)) {
        entry = result(mapping, "skipped", "target_temperature_invalid", { sourceTemperature: roundC(sourceValue) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      const correctedTemperature = roundC(sourceValue);
      const currentTemperature = roundC(measured);
      const details = { sourceTemperature: correctedTemperature, currentTemperature, correctedTemperature };
      const latestAgeReason = sourceAgeReason(timestamp, config, now);
      if (latestAgeReason) {
        entry = result(mapping, "skipped", latestAgeReason, details);
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (currentTemperature === correctedTemperature) {
        entry = result(mapping, "no-op", "temperatures_equal", details);
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (Math.abs(Math.round(correctedTemperature * 10) - Math.round(currentTemperature * 10)) > MAX_CORRECTION_C * 10) {
        entry = result(mapping, "skipped", "correction_exceeds_limit", details);
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (config.dryRun === true) {
        entry = result(mapping, "skipped", "dry_run", details);
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
      }
      if (signal?.aborted) {
        completeRemaining(index, "skipped", "aborted");
        break;
      }
      try {
        const write = await client.calibrateRoom({
          homeId: home.id,
          roomId: room.id,
          currentTemperature,
          correctedTemperature,
          signal,
          beforeWrite: () => sourceAgeReason(timestamp, config, now)
        });
        const outcome = write?.outcome;
        if (["updated", "no-op", "failed", "indeterminate"].includes(outcome)) {
          entry = result(mapping, outcome, outcome === "updated" ? undefined : (outcome === "no-op" ? "nothing_to_modify" : "calibration_not_confirmed"), details);
          if (write?.status === 429) {
            entry.outcome = "failed";
            entry.reason = "rate_limited";
            entry.errorCode = "ERR_RATE_LIMIT";
            retryAfterMs = retryDelay(write);
          }
        } else {
          entry = result(mapping, "indeterminate", "calibration_response_invalid", details);
        }
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry);
        if (write?.status === 429) {
          completeRemaining(index + 1, "skipped", "rate_limited", "ERR_RATE_LIMIT");
          break;
        }
      } catch (error) {
        if (error?.code === "SOURCE_STALE") {
          entry = result(mapping, "skipped", "source_stale", details);
          outcomes.push(entry); logOutcome(log, cycleId, mapping, entry); continue;
        }
        if (haltOnError(error, index)) break;
        entry = result(mapping, error?.outcome || "failed", "calibration_failed", { ...details, errorCode: failCode(error) });
        outcomes.push(entry); logOutcome(log, cycleId, mapping, entry);
      }
    }
    return { outcomes, retryAfterMs };
  } catch (error) {
    if (isAbort(error, signal)) {
      completeRemaining(outcomes.length, "skipped", "aborted");
      return { outcomes, retryAfterMs };
    }
    throw error;
  }
}
