export interface CalibrationRequest {
  readonly homeId: string;
  readonly roomId: string;
  readonly currentTemperature: number;
  readonly correctedTemperature: number;
  readonly signal?: AbortSignal;
  readonly beforeWrite?: () => string | undefined | Promise<string | undefined>;
}

export interface SynchronizationGatewayInterface {
  beginCycle?(): void;
  getHomeCoachData(options?: { readonly signal?: AbortSignal }): Promise<unknown>;
  getHomesData(options?: { readonly signal?: AbortSignal }): Promise<unknown>;
  getHomeStatus(homeId: string, options?: { readonly signal?: AbortSignal }): Promise<unknown>;
  calibrateRoom(request: CalibrationRequest): Promise<unknown>;
}
