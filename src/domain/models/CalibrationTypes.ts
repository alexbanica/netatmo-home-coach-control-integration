import type { CalibrationMapping } from "./CalibrationMapping.js";

export type MappingResolution =
  | { readonly mapping: CalibrationMapping; readonly reason: string; readonly sourceTemperature?: number }
  | { readonly mapping: CalibrationMapping; readonly sourceTemperature: number; readonly timestamp: number; readonly homeId: string; readonly roomId: string };

export type SourceResolution =
  | { readonly mapping: CalibrationMapping; readonly reason: string; readonly sourceTemperature?: number }
  | { readonly mapping: CalibrationMapping; readonly sourceTemperature: number; readonly timestamp: number };

export type TargetResolution =
  | { readonly mapping: CalibrationMapping; readonly reason: string }
  | { readonly mapping: CalibrationMapping; readonly homeId: string; readonly roomId: string };

export interface CalibrationDecision {
  readonly outcome: "no-op" | "skipped" | "write";
  readonly reason?: string;
  readonly currentTemperature?: number;
  readonly correctedTemperature?: number;
}

export interface CycleOutcome {
  readonly sourceDeviceName: string;
  readonly targetHomeName: string;
  readonly targetRoomName: string;
  outcome: "updated" | "no-op" | "skipped" | "failed" | "indeterminate";
  reason?: string;
  sourceTemperature?: number;
  currentTemperature?: number;
  correctedTemperature?: number;
  errorCode?: string;
}
