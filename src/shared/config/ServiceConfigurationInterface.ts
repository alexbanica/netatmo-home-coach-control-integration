export interface ServiceMapping {
  readonly sourceDeviceName: string;
  readonly targetHomeName: string;
  readonly targetRoomName: string;
}
export interface ServiceCredentials {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly username: string;
  readonly password: string;
}
export interface ServiceConfigurationInterface {
  readonly configFile: string;
  readonly syncIntervalMinutes: number;
  readonly maxReadingAgeMinutes: number;
  readonly dryRun: boolean;
  readonly healthcheckPort: number;
  readonly healthcheckMaxCycleMs: number;
  readonly credentials: ServiceCredentials;
  readonly mappings: readonly ServiceMapping[];
}
