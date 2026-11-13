const API_BASE = "https://api.netatmo.com/api";
const APP_BASE = "https://app.netatmo.net/api";
const OAUTH_HOSTS = ["api.netatmo.com"];
const APP_HOSTS = ["app.netatmo.net"];

export class NetatmoApiError extends Error {
  constructor(message, { code = "NETATMO_API_ERROR", status, outcome = "failed", retryAfterMs } = {}) {
    super(message);
    this.name = "NetatmoApiError";
    this.code = code;
    this.status = status;
    this.outcome = outcome;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseResponse(response, operation) {
  if (response && typeof response === "object" && "text" in response) {
    try { return JSON.parse(response.text); } catch {
      throw new NetatmoApiError(`${operation} returned invalid JSON`, { code: "INVALID_JSON", status: response.status });
    }
  }
  if (response && typeof response === "object") return response;
  throw new NetatmoApiError(`${operation} returned an invalid response`, { code: "INVALID_RESPONSE" });
}

function responseStatus(response) {
  return Number.isInteger(response?.status) ? response.status : 200;
}

function isInvalidSessionMessage(message) {
  return /\b(?:invalid|expired)\s+(?:access\s+)?(?:token|session)\b|\b(?:token|session)(?:\s+\w+){0,2}\s+(?:invalid|expired)\b/i.test(String(message || ""));
}

function apiError(body, response, operation) {
  const error = body?.error;
  const status = responseStatus(response);
  const code = error?.code;
  const retryAfter = response?.headers?.get?.("retry-after");
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  return new NetatmoApiError(`${operation} failed`, {
    status,
    code: typeof code === "number" && Number.isFinite(code) ? String(code) : "NETATMO_API_ERROR",
    retryAfterMs
  });
}

/** Read-only OAuth API and the separate app.netatmo.net calibration surface. */
export class NetatmoClient {
  #oauth;
  #web;
  #http;
  #verifiedToken;

  constructor({ oauthClient, webSession, httpClient } = {}) {
    if (!oauthClient?.request) throw new TypeError("oauthClient.request is required");
    if (!webSession?.getAccessToken) throw new TypeError("webSession.getAccessToken is required");
    if (!httpClient?.request) throw new TypeError("httpClient.request is required");
    this.#oauth = oauthClient;
    this.#web = webSession;
    this.#http = httpClient;
  }

  beginCycle() {
    this.#oauth.beginCycle?.();
    this.#web.beginCycle?.();
    this.#verifiedToken = undefined;
  }

  async #read(path, { signal } = {}) {
    const url = `${API_BASE}/${path}`;
    const response = await this.#oauth.request(url, { method: "GET", signal, allowedHosts: OAUTH_HOSTS });
    const body = parseResponse(response, path);
    if (responseStatus(response) < 200 || responseStatus(response) >= 300 || body?.error) throw apiError(body, response, path);
    return body;
  }

  getHomeCoachData(options) { return this.#read("gethomecoachsdata", options); }
  getHomesData(options) { return this.#read("homesdata", options); }
  getHomeStatus(homeId, options) {
    if (typeof homeId !== "string" || !homeId) throw new TypeError("homeId is required");
    const url = new URL(`${API_BASE}/homestatus`);
    url.searchParams.set("home_id", homeId);
    return this.#oauth.request(url.href, { method: "GET", signal: options?.signal, allowedHosts: OAUTH_HOSTS }).then((response) => {
      const body = parseResponse(response, "homestatus");
      if (responseStatus(response) < 200 || responseStatus(response) >= 300 || body?.error) throw apiError(body, response, "homestatus");
      return body;
    });
  }

  async #webToken({ signal } = {}) {
    const token = await this.#web.getAccessToken({ signal });
    if (token !== this.#verifiedToken) {
      // Login-page success is not sufficient: the cookie-derived token must work against app API.
      const response = await this.#http.request(`${APP_BASE}/homesdata`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal,
        allowedHosts: APP_HOSTS,
        redirect: "manual"
      });
      let body;
      try { body = JSON.parse(response.text); } catch { throw new NetatmoApiError("Web session verification returned invalid JSON", { code: "INVALID_JSON", status: response.status }); }
      if (response.status !== 200 || body?.error || !Array.isArray(body?.body?.homes)) {
        if (response.status === 401 || isInvalidSessionMessage(body?.error?.message)) this.#web.invalidate?.();
        throw new NetatmoApiError("Web session could not access the Netatmo app API", { status: response.status, code: "WEB_SESSION_INVALID" });
      }
      this.#verifiedToken = token;
    }
    return token;
  }

  async calibrateRoom({ homeId, roomId, currentTemperature, correctedTemperature, signal, beforeWrite } = {}) {
    if (![homeId, roomId].every((value) => typeof value === "string" && value)) throw new TypeError("homeId and roomId are required");
    if (![currentTemperature, correctedTemperature].every((value) => Number.isFinite(value))) throw new TypeError("Temperatures must be finite numbers");
    const token = await this.#webToken({ signal });
    if (await beforeWrite?.()) {
      throw new NetatmoApiError("True Temperature write was skipped because the source reading is stale", {
        code: "SOURCE_STALE",
        outcome: "skipped"
      });
    }
    let response;
    try {
      response = await this.#http.request(`${APP_BASE}/truetemperature`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ home_id: homeId, room_id: roomId, current_temperature: currentTemperature, corrected_temperature: correctedTemperature }),
        signal,
        allowedHosts: APP_HOSTS,
        redirect: "manual"
      });
    } catch (error) {
      // A write may have reached Netatmo before transport failed: never replay it here.
      throw new NetatmoApiError("True Temperature write outcome is indeterminate", {
        status: error?.status,
        code: "WRITE_TRANSPORT_ERROR",
        outcome: "indeterminate",
        retryAfterMs: error?.retryAfterMs
      });
    }
    let body;
    try { body = JSON.parse(response.text); } catch {
      throw new NetatmoApiError("True Temperature write returned invalid JSON", { status: response.status, code: "INVALID_JSON", outcome: "indeterminate" });
    }
    if (response.status === 406 && body?.error?.code === 7 && body?.error?.message === "Nothing to modify") {
      return { outcome: "no-op", status: response.status, code: 7 };
    }
    if (response.status === 401 || isInvalidSessionMessage(body?.error?.message)) {
      this.#web.invalidate?.();
    }
    if (response.status < 200 || response.status >= 300 || body?.error) {
      const outcome = response.status >= 500 || response.status === 401 ? "indeterminate" : "failed";
      throw new NetatmoApiError("True Temperature write was not confirmed", {
        status: response.status,
        code: typeof body?.error?.code === "number" && Number.isFinite(body.error.code) ? String(body.error.code) : "CALIBRATION_REJECTED",
        outcome,
        retryAfterMs: response.headers?.get?.("retry-after") && /^\d+$/.test(response.headers.get("retry-after")) ? Number(response.headers.get("retry-after")) * 1000 : undefined
      });
    }
    if (body?.status === "ok") return { outcome: "updated", status: response.status };
    throw new NetatmoApiError("True Temperature write response was not a recognized success", { status: response.status, code: "UNEXPECTED_SUCCESS_BODY", outcome: "indeterminate" });
  }
}
