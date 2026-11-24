export interface CalibrationStateRecord {
  readonly homeId: string;
  readonly roomId: string;
  readonly preWriteTemperature: number;
}

export interface CalibrationStateStoreInterface {
  save(records: readonly CalibrationStateRecord[]): Promise<void>;
}
