import type { CalibrationMapping } from "../../domain/models/CalibrationMapping.js";
import type { CycleOutcome } from "../../domain/models/CalibrationTypes.js";
import { CalibrationPolicy } from "../../domain/services/CalibrationPolicy.js";
import { MappingResolver } from "../../domain/services/MappingResolver.js";
import type { SynchronizationGatewayInterface } from "../ports/SynchronizationGatewayInterface.js";
import type { TemperatureSynchronizationServiceInterface, SynchronizationCycleResult, SynchronizationExecutionOptions } from "./interfaces/TemperatureSynchronizationServiceInterface.js";
import type { LoggerInterface } from "../../shared/logging/interfaces/LoggerInterface.js";
import type { ClockInterface } from "../../shared/clock/interfaces/ClockInterface.js";

export interface SynchronizationConfigurationSubset {
  readonly mappings: readonly CalibrationMapping[];
  readonly maxReadingAgeMinutes: number;
  readonly dryRun: boolean;
}

const cycleLocks = new WeakMap<object, Promise<void>>();
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function failCode(error: unknown): string {
  const value = record(error);
  if (value?.status === 429) return "ERR_RATE_LIMIT";
  if (typeof value?.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) return `HTTP_${value.status}`;
  if (typeof value?.code === "number" && Number.isInteger(value.code)) return `API_${value.code}`;
  const code = value?.code;
  return typeof code === "string" && ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ERR_NETWORK", "ERR_INVALID_SESSION"].includes(code) ? code : "ERR_NETWORK";
}
function aborted(error: unknown, signal?: AbortSignal): boolean {
  const value = record(error);
  return signal?.aborted === true || value?.name === "AbortError" || value?.code === "ABORT_ERR";
}
function retryDelay(error: unknown): number {
  const delay = record(error)?.retryAfterMs;
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : 0;
}
function result(mapping: CalibrationMapping, outcome: CycleOutcome["outcome"], reason?: string, extra: Partial<CycleOutcome> = {}): CycleOutcome {
  return { sourceDeviceName: mapping.sourceDeviceName, targetHomeName: mapping.targetHomeName, targetRoomName: mapping.targetRoomName, outcome, ...(reason ? { reason } : {}), ...extra };
}

/** Executes one deterministic, sequential synchronization cycle through injected ports. */
export class TemperatureSynchronizationService implements TemperatureSynchronizationServiceInterface {
  private readonly resolver = new MappingResolver();
  private readonly policy = new CalibrationPolicy();

  constructor(
    private readonly configuration: SynchronizationConfigurationSubset,
    private readonly gateway: SynchronizationGatewayInterface,
    private readonly logger: LoggerInterface,
    private readonly clock: ClockInterface
  ) {}

  async execute(options: SynchronizationExecutionOptions = {}): Promise<SynchronizationCycleResult> {
    const prior = cycleLocks.get(this.gateway) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => current);
    cycleLocks.set(this.gateway, queued);
    await prior;
    try { return await this.executeLocked(options); }
    finally { release(); if (cycleLocks.get(this.gateway) === queued) cycleLocks.delete(this.gateway); }
  }

  private emit(mapping: CalibrationMapping, outcome: CycleOutcome, cycleId: number | string): void {
    try {
      this.logger.log({
        event: outcome.reason ? `sync.mapping.${outcome.reason}` : "sync.mapping.updated",
        cycleId,
        mapping: `${mapping.sourceDeviceName} -> ${mapping.targetHomeName}/${mapping.targetRoomName}`,
        outcome: outcome.outcome,
        sourceDeviceName: mapping.sourceDeviceName,
        targetHomeName: mapping.targetHomeName,
        targetRoomName: mapping.targetRoomName,
        sourceTemperature: outcome.sourceTemperature,
        currentTemperature: outcome.currentTemperature,
        correctedTemperature: outcome.correctedTemperature,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {})
      });
    } catch { /* Logging must not interrupt synchronization. */ }
  }

  private async executeLocked(options: SynchronizationExecutionOptions): Promise<SynchronizationCycleResult> {
    const { signal, cycleId = 1 } = options;
    const outcomes: CycleOutcome[] = [];
    let retryAfterMs = 0;
    const mappings = this.configuration.mappings;
    const add = (mapping: CalibrationMapping, entry: CycleOutcome): void => { outcomes.push(entry); this.emit(mapping, entry, cycleId); };
    const completeRemaining = (from: number, outcome: CycleOutcome["outcome"], reason: string, errorCode?: string): void => {
      for (let index = from; index < mappings.length; index += 1) add(mappings[index]!, result(mappings[index]!, outcome, reason, errorCode ? { errorCode } : {}));
    };
    const halt = (error: unknown, index: number): boolean => {
      const err = record(error);
      if (err?.status === 429) { retryAfterMs = retryDelay(error); completeRemaining(index, "skipped", "rate_limited", "ERR_RATE_LIMIT"); return true; }
      if (aborted(error, signal)) { completeRemaining(index, "skipped", "aborted"); return true; }
      return false;
    };
    if (signal?.aborted) { completeRemaining(0, "skipped", "aborted"); return { outcomes, retryAfterMs }; }
    try {
      this.gateway.beginCycle?.();
      let coachData: unknown;
      let homesData: unknown;
      try {
        coachData = await this.gateway.getHomeCoachData({ signal });
        if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        homesData = await this.gateway.getHomesData({ signal });
      } catch (error) {
        if (halt(error, 0)) return { outcomes, retryAfterMs };
        completeRemaining(0, "failed", "discovery_failed", failCode(error));
        return { outcomes, retryAfterMs };
      }
      for (let index = 0; index < mappings.length; index += 1) {
        const mapping = mappings[index]!;
        if (signal?.aborted) { completeRemaining(index, "skipped", "aborted"); break; }
        const source = this.resolver.resolveSource(coachData, mapping);
        if ("reason" in source) {
          add(mapping, result(mapping, "skipped", source.reason, source.sourceTemperature === undefined ? {} : { sourceTemperature: this.policy.roundCelsius(source.sourceTemperature) }));
          continue;
        }
        const sourceTemperature = this.policy.roundCelsius(source.sourceTemperature);
        const staleReason = this.policy.sourceAgeReason(source.timestamp, this.configuration.maxReadingAgeMinutes, this.clock.now());
        if (staleReason) { add(mapping, result(mapping, "skipped", staleReason, { sourceTemperature })); continue; }
        const target = this.resolver.resolveTarget(homesData, mapping);
        if ("reason" in target) { add(mapping, result(mapping, "skipped", target.reason, { sourceTemperature })); continue; }
        let status: unknown;
        try { status = await this.gateway.getHomeStatus(target.homeId, { signal }); }
        catch (error) {
          if (halt(error, index)) break;
          const err = record(error);
          const outcome = err?.outcome === "indeterminate" || err?.outcome === "failed" ? err.outcome : "failed";
          add(mapping, result(mapping, outcome, "target_status_failed", { sourceTemperature, errorCode: failCode(error) })); continue;
        }
        if (signal?.aborted) { completeRemaining(index, "skipped", "aborted"); break; }
        const rooms = record(record(record(status)?.body)?.home)?.rooms;
        const statusRooms = Array.isArray(rooms) ? rooms : [];
        const matches = statusRooms.filter((item) => record(item)?.id === target.roomId);
        const targetRoom = matches.length === 1 ? record(matches[0]) : undefined;
        if (!targetRoom || targetRoom.reachable === false) {
          add(mapping, result(mapping, "skipped", targetRoom ? "target_unreachable" : "target_status_missing", { sourceTemperature })); continue;
        }
        const measured = targetRoom.therm_measured_temperature;
        if (typeof measured !== "number" || !Number.isFinite(measured)) { add(mapping, result(mapping, "skipped", "target_temperature_invalid", { sourceTemperature })); continue; }
        const latestReason = this.policy.sourceAgeReason(source.timestamp, this.configuration.maxReadingAgeMinutes, this.clock.now());
        const decision = this.policy.decide(source.sourceTemperature, measured, this.configuration.dryRun);
        const detail = { sourceTemperature, currentTemperature: decision.currentTemperature, correctedTemperature: decision.correctedTemperature };
        if (latestReason) { add(mapping, result(mapping, "skipped", latestReason, detail)); continue; }
        if (decision.outcome !== "write") { add(mapping, result(mapping, decision.outcome, decision.reason, detail)); continue; }
        if (signal?.aborted) { completeRemaining(index, "skipped", "aborted"); break; }
        try {
          const response = record(await this.gateway.calibrateRoom({
            homeId: target.homeId, roomId: target.roomId,
            currentTemperature: decision.currentTemperature!, correctedTemperature: decision.correctedTemperature!, signal,
            beforeWrite: () => this.policy.sourceAgeReason(source.timestamp, this.configuration.maxReadingAgeMinutes, this.clock.now())
          }));
          const outcome = response?.outcome;
          let entry: CycleOutcome;
          if (outcome === "updated") entry = result(mapping, "updated", undefined, detail);
          else if (outcome === "no-op") entry = result(mapping, "no-op", "nothing_to_modify", detail);
          else if (outcome === "failed" || outcome === "indeterminate") entry = result(mapping, outcome, "calibration_not_confirmed", detail);
          else entry = result(mapping, "indeterminate", "calibration_response_invalid", detail);
          if (response?.status === 429) { entry.outcome = "failed"; entry.reason = "rate_limited"; entry.errorCode = "ERR_RATE_LIMIT"; retryAfterMs = retryDelay(response); }
          add(mapping, entry);
          if (response?.status === 429) { completeRemaining(index + 1, "skipped", "rate_limited", "ERR_RATE_LIMIT"); break; }
        } catch (error) {
          if (record(error)?.code === "SOURCE_STALE") { add(mapping, result(mapping, "skipped", "source_stale", detail)); continue; }
          if (halt(error, index)) break;
          const err = record(error);
          const outcome = err?.outcome === "indeterminate" || err?.outcome === "failed" ? err.outcome : "failed";
          add(mapping, result(mapping, outcome, "calibration_failed", { ...detail, errorCode: failCode(error) }));
        }
      }
      return { outcomes, retryAfterMs };
    } catch (error) {
      if (!aborted(error, signal)) throw error;
      completeRemaining(outcomes.length, "skipped", "aborted");
      return { outcomes, retryAfterMs };
    }
  }
}
