export interface LoggerInterface {
  log(record: Readonly<Record<string, unknown>>): void;
}
