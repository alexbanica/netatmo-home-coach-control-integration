export type NetatmoApiOutcome = "failed" | "skipped" | "indeterminate";

export interface NetatmoApiErrorOptions {
  readonly code?: string;
  readonly status?: number;
  readonly outcome?: NetatmoApiOutcome;
  readonly retryAfterMs?: number;
}

export class NetatmoApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly outcome: NetatmoApiOutcome;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, { code = "NETATMO_API_ERROR", status, outcome = "failed", retryAfterMs }: NetatmoApiErrorOptions = {}) {
    super(message);
    this.name = "NetatmoApiError";
    this.code = code;
    this.status = status;
    this.outcome = outcome;
    this.retryAfterMs = retryAfterMs;
  }
}
