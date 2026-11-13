import { HttpError } from "./http.js";

const API_HOSTS = ["api.netatmo.com"];
const TOKEN_URL = "https://api.netatmo.com/oauth2/token";

function validateApiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError("EURL"); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== API_HOSTS[0] ||
      (url.port !== "" && url.port !== "443") || url.username || url.password) {
    throw new HttpError("EHOST");
  }
  return url.href;
}

function responseErrorCode(response) {
  if (typeof response?.text !== "string") return undefined;
  try {
    const payload = JSON.parse(response.text);
    const code = payload?.error?.code;
    return typeof code === "number" ? code : undefined;
  } catch {
    return undefined;
  }
}

/** OAuth reads and one in-memory refresh opportunity per synchronization cycle. */
export class OAuthClient {
  constructor({ httpClient, accessToken, refreshToken, clientId, clientSecret } = {}) {
    if (!httpClient || typeof httpClient.request !== "function") throw new TypeError("httpClient is required");
    if (typeof accessToken !== "string" || accessToken.length === 0) throw new TypeError("accessToken is required");
    const refreshParts = [refreshToken, clientId, clientSecret];
    if (refreshParts.some((value) => value !== undefined) && refreshParts.some((value) => typeof value !== "string" || value.length === 0)) {
      throw new TypeError("refreshToken, clientId and clientSecret must be supplied together");
    }
    this.httpClient = httpClient;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshAttempted = false;
  }

  beginCycle() {
    this.refreshAttempted = false;
  }

  async request(url, { method = "GET", headers = {}, ...options } = {}) {
    url = validateApiUrl(url);
    const safeMethod = String(method).toUpperCase();
    const requestHeaders = new Headers(headers);
    requestHeaders.set("authorization", `Bearer ${this.accessToken}`);
    const response = await this.httpClient.request(url, {
      ...options,
      method: safeMethod,
      headers: requestHeaders,
      allowedHosts: API_HOSTS
    });
    if (safeMethod !== "GET" || !this.refreshToken || this.refreshAttempted) return response;
    const errorCode = responseErrorCode(response);
    if (errorCode === 13 || (response.status !== 401 && errorCode !== 2 && errorCode !== 3)) return response;
    this.refreshAttempted = true;
    await this.refresh(options.signal);
    const retryHeaders = new Headers(headers);
    retryHeaders.set("authorization", `Bearer ${this.accessToken}`);
    return this.httpClient.request(url, {
      ...options,
      method: safeMethod,
      headers: retryHeaders,
      allowedHosts: API_HOSTS
    });
  }

  async refresh(signal) {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) throw new HttpError("EOAUTHREFRESHUNAVAILABLE");
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret
    });
    const response = await this.httpClient.request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
      signal,
      allowedHosts: API_HOSTS
    });
    if (response.status < 200 || response.status >= 300) throw new HttpError("EOAUTHREFRESH", { status: response.status });
    let payload;
    try { payload = JSON.parse(response.text); } catch { throw new HttpError("EOAUTHRESPONSE"); }
    if (!payload || typeof payload.access_token !== "string" || payload.access_token.length === 0 ||
        typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
      throw new HttpError("EOAUTHRESPONSE");
    }
    if (payload.refresh_token !== undefined && (typeof payload.refresh_token !== "string" || payload.refresh_token.length === 0)) {
      throw new HttpError("EOAUTHRESPONSE");
    }
    this.accessToken = payload.access_token;
    if (payload.refresh_token !== undefined) this.refreshToken = payload.refresh_token;
  }
}
