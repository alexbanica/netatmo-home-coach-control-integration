export interface ServiceHealthInterface {
  start(): void;
  beginCycle(): void;
  finishCycle(): void;
  stop(): void;
  isHealthy(): boolean;
}
