import type { CalibrationRequest, SynchronizationGatewayInterface } from "../../application/ports/SynchronizationGatewayInterface.js";
import { NetatmoApiError } from "./NetatmoApiError.js";

const API_BASE = "https://api.netatmo.com/api";
const APP_BASE = "https://app.netatmo.net/api";
const OAUTH_HOSTS = ["api.netatmo.com"];
const APP_HOSTS = ["app.netatmo.net"];

interface HttpResponse {
  readonly status: number;
  readonly text: string;
  readonly headers?: Headers;
}

interface HttpRequestOptions {
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly body?: string;
  readonly signal?: AbortSignal;
  readonly allowedHosts?: readonly string[];
  readonly redirect?: "manual";
}

interface HttpClientLike {
  request(input: string | URL, options?: HttpRequestOptions): Promise<HttpResponse>;
}

interface OAuthClientLike {
  beginCycle?(): void;
  request(input: string | URL, options?: HttpRequestOptions): Promise<HttpResponse>;
}

interface WebSessionLike {
  beginCycle?(): void;
  getAccessToken(options?: { readonly signal?: AbortSignal }): Promise<string>;
  invalidate?(): void;
}

interface NetatmoClientOptions {
  readonly oauthClient: OAuthClientLike;
  readonly webSession: WebSessionLike;
  readonly httpClient: HttpClientLike;
}

interface ApiErrorBody {
  readonly code?: unknown;
  readonly message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(response: HttpResponse, operation: string): unknown {
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new NetatmoApiError(`${operation} returned invalid JSON`, { code: "INVALID_JSON", status: response.status });
  }
}

function responseStatus(response: HttpResponse): number {
  return Number.isInteger(response.status) ? response.status : 200;
}

function isInvalidSessionMessage(message: unknown): boolean {
  return /\b(?:invalid|expired)\s+(?:access\s+)?(?:token|session)\b|\b(?:token|session)(?:\s+\w+){0,2}\s+(?:invalid|expired)\b/i.test(String(message || ""));
}

function apiError(body: unknown, response: HttpResponse, operation: string): NetatmoApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code = error?.code;
  const retryAfter = response.headers?.get("retry-after");
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  return new NetatmoApiError(`${operation} failed`, {
    status: responseStatus(response),
    code: typeof code === "number" && Number.isFinite(code) ? String(code) : "NETATMO_API_ERROR",
    retryAfterMs
  });
}

function hasApiError(body: unknown): boolean {
  return isRecord(body) && Boolean(body.error);
}

function errorDetails(body: unknown): ApiErrorBody | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  return body.error;
}

/** Read-only OAuth API and the separate app.netatmo.net calibration surface. */
export class NetatmoClient implements SynchronizationGatewayInterface {
  readonly #oauth: OAuthClientLike;
  readonly #web: WebSessionLike;
  readonly #http: HttpClientLike;
  #verifiedToken: string | undefined;

  constructor({ oauthClient, webSession, httpClient }: NetatmoClientOptions) {
    if (!oauthClient || typeof oauthClient.request !== "function") throw new TypeError("oauthClient.request is required");
    if (!webSession || typeof webSession.getAccessToken !== "function") throw new TypeError("webSession.getAccessToken is required");
    if (!httpClient || typeof httpClient.request !== "function") throw new TypeError("httpClient.request is required");
    this.#oauth = oauthClient;
    this.#web = webSession;
    this.#http = httpClient;
  }

  beginCycle(): void {
    this.#oauth.beginCycle?.();
    this.#web.beginCycle?.();
    this.#verifiedToken = undefined;
  }

  async #read(path: string, { signal }: { readonly signal?: AbortSignal } = {}): Promise<unknown> {
    const response = await this.#oauth.request(`${API_BASE}/${path}`, { method: "GET", signal, allowedHosts: OAUTH_HOSTS });
    const body = parseResponse(response, path);
    if (responseStatus(response) < 200 || responseStatus(response) >= 300 || hasApiError(body)) throw apiError(body, response, path);
    return body;
  }

  getHomeCoachData(options?: { readonly signal?: AbortSignal }): Promise<unknown> {
    return this.#read("gethomecoachsdata", options);
  }

  getHomesData(options?: { readonly signal?: AbortSignal }): Promise<unknown> {
    return this.#read("homesdata", options);
  }

  async getHomeStatus(homeId: string, options?: { readonly signal?: AbortSignal }): Promise<unknown> {
    if (typeof homeId !== "string" || !homeId) throw new TypeError("homeId is required");
    const url = new URL(`${API_BASE}/homestatus`);
    url.searchParams.set("home_id", homeId);
    const response = await this.#oauth.request(url.href, { method: "GET", signal: options?.signal, allowedHosts: OAUTH_HOSTS });
    const body = parseResponse(response, "homestatus");
    if (responseStatus(response) < 200 || responseStatus(response) >= 300 || hasApiError(body)) throw apiError(body, response, "homestatus");
    return body;
  }

  async #webToken({ signal }: { readonly signal?: AbortSignal } = {}): Promise<string> {
    const token = await this.#web.getAccessToken({ signal });
    if (token !== this.#verifiedToken) {
      const response = await this.#http.request(`${APP_BASE}/homesdata`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal,
        allowedHosts: APP_HOSTS,
        redirect: "manual"
      });
      let body: unknown;
      try {
        body = JSON.parse(response.text) as unknown;
      } catch {
        throw new NetatmoApiError("Web session verification returned invalid JSON", { code: "INVALID_JSON", status: response.status });
      }
      const error = errorDetails(body);
      const responseBody = isRecord(body) && isRecord(body.body) ? body.body : undefined;
      if (response.status !== 200 || hasApiError(body) || !Array.isArray(responseBody?.homes)) {
        if (response.status === 401 || isInvalidSessionMessage(error?.message)) this.#web.invalidate?.();
        throw new NetatmoApiError("Web session could not access the Netatmo app API", { status: response.status, code: "WEB_SESSION_INVALID" });
      }
      this.#verifiedToken = token;
    }
    return token;
  }

  async calibrateRoom({ homeId, roomId, currentTemperature, correctedTemperature, signal, beforeWrite }: CalibrationRequest): Promise<unknown> {
    if (![homeId, roomId].every((value) => typeof value === "string" && value)) throw new TypeError("homeId and roomId are required");
    if (![currentTemperature, correctedTemperature].every((value) => Number.isFinite(value))) throw new TypeError("Temperatures must be finite numbers");
    const token = await this.#webToken({ signal });
    if (await beforeWrite?.()) {
      throw new NetatmoApiError("True Temperature write was skipped because the source reading is stale", {
        code: "SOURCE_STALE",
        outcome: "skipped"
      });
    }
    let response: HttpResponse;
    try {
      response = await this.#http.request(`${APP_BASE}/truetemperature`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ home_id: homeId, room_id: roomId, current_temperature: currentTemperature, corrected_temperature: correctedTemperature }),
        signal,
        allowedHosts: APP_HOSTS,
        redirect: "manual"
      });
    } catch (error: unknown) {
      throw new NetatmoApiError("True Temperature write outcome is indeterminate", {
        status: isRecord(error) && typeof error.status === "number" ? error.status : undefined,
        code: "WRITE_TRANSPORT_ERROR",
        outcome: "indeterminate",
        retryAfterMs: isRecord(error) && typeof error.retryAfterMs === "number" ? error.retryAfterMs : undefined
      });
    }
    let body: unknown;
    try {
      body = JSON.parse(response.text) as unknown;
    } catch {
      throw new NetatmoApiError("True Temperature write returned invalid JSON", { status: response.status, code: "INVALID_JSON", outcome: "indeterminate" });
    }
    const error = errorDetails(body);
    if (response.status === 406 && error?.code === 7 && error.message === "Nothing to modify") {
      return { outcome: "no-op", status: response.status, code: 7 };
    }
    if (response.status === 401 || isInvalidSessionMessage(error?.message)) this.#web.invalidate?.();
    if (response.status < 200 || response.status >= 300 || hasApiError(body)) {
      const outcome = response.status >= 500 || response.status === 401 ? "indeterminate" : "failed";
      const retryAfter = response.headers?.get("retry-after");
      throw new NetatmoApiError("True Temperature write was not confirmed", {
        status: response.status,
        code: typeof error?.code === "number" && Number.isFinite(error.code) ? String(error.code) : "CALIBRATION_REJECTED",
        outcome,
        retryAfterMs: retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined
      });
    }
    if (isRecord(body) && body.status === "ok") return { outcome: "updated", status: response.status };
    throw new NetatmoApiError("True Temperature write response was not a recognized success", { status: response.status, code: "UNEXPECTED_SUCCESS_BODY", outcome: "indeterminate" });
  }
}
