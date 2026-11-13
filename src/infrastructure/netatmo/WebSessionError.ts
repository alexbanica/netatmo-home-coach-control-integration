export type WebSessionErrorOptions = {
  status?: number;
  retryAfterMs?: number;
};

/** Web authentication failure with a non-sensitive message and bounded metadata. */
export class WebSessionError extends Error {
  readonly code: string;
  readonly status?: 429;
  readonly retryAfterMs?: number;

  constructor(message: string, code = "WEB_SESSION_INVALID", { status, retryAfterMs }: WebSessionErrorOptions = {}) {
    super(message);
    this.name = "WebSessionError";
    this.code = code;
    if (status === 429) this.status = 429;
    if (Number.isFinite(retryAfterMs) && retryAfterMs !== undefined && retryAfterMs >= 0) this.retryAfterMs = retryAfterMs;
  }
}
