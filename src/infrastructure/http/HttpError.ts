export interface HttpErrorOptions {
  status?: number;
  retryAfterMs?: number;
}

/** An HTTP failure with a deliberately non-sensitive message. */
export class HttpError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(code: string, { status, retryAfterMs }: HttpErrorOptions = {}) {
    super(code === "ERATELIMIT" ? "HTTP rate limit reached" : `HTTP request failed (${code})`);
    this.name = "HttpError";
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
    if (Number.isFinite(retryAfterMs)) this.retryAfterMs = retryAfterMs;
  }
}
