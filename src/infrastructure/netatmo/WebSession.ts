import { CookieJar } from "tough-cookie";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "../http/HttpClient.js";
import { HttpError } from "../http/HttpError.js";
import { WebSessionError } from "./WebSessionError.js";

const ALLOWED_HOSTS = ["auth.netatmo.com", "my.netatmo.com", "app.netatmo.net"] as const;
const ALLOWED_HOST_SET: ReadonlySet<string> = new Set(ALLOWED_HOSTS);
const AUTH_ORIGIN = "https://auth.netatmo.com";
const USER_AGENT = "netatmo-home";

type LoginOptions = { signal?: AbortSignal };
type WebRequestOptions = Omit<HttpRequestOptions, "allowedHosts" | "redirect" | "headers"> & {
  headers?: Record<string, string>;
};
export type VerifyAccessToken = (token: string, options?: LoginOptions) => Promise<void>;
export type WebSessionOptions = {
  httpClient: HttpClient;
  username: string;
  password: string;
  verifyAccessToken?: VerifyAccessToken;
};

function safeUrl(value: string | URL): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOST_SET.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) {
    throw new WebSessionError("Web authentication redirect host is not permitted", "REDIRECT_REJECTED");
  }
  return url;
}

function getSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function isRateLimited(error: unknown): error is HttpError & { status: 429; retryAfterMs?: number } {
  if (!(error instanceof HttpError)) return false;
  return error.status === 429;
}

/** Direct Netatmo web login. Cookies and access tokens live only in this instance. */
export class WebSession {
  #http: HttpClient;
  #username: string;
  #password: string;
  #jar: CookieJar;
  #token: string | undefined;
  #attempted = false;
  #invalidated = false;
  #verified = false;
  #verify: VerifyAccessToken | undefined;

  constructor({ httpClient, username, password, verifyAccessToken }: WebSessionOptions) {
    if (!httpClient?.request) throw new TypeError("httpClient.request is required");
    if (!username || !password) throw new TypeError("Web-session username and password are required");
    this.#http = httpClient;
    this.#username = username;
    this.#password = password;
    this.#jar = new CookieJar();
    this.#verify = verifyAccessToken;
  }

  /** Starts an authentication cycle. At most one password login is allowed per cycle. */
  beginCycle(): void {
    if (this.#invalidated) this.#token = undefined;
    this.#attempted = false;
    this.#invalidated = false;
    this.#verified = false;
  }

  invalidate(): boolean {
    if (this.#invalidated) return false;
    this.#token = undefined;
    this.#verified = false;
    this.#invalidated = true;
    return true;
  }

  async getAccessToken({ signal }: LoginOptions = {}): Promise<string> {
    if (this.#token && !this.#invalidated) {
      if (!this.#verified && this.#verify) {
        await this.#verify(this.#token, { signal });
        this.#verified = true;
      }
      return this.#token;
    }
    if (this.#attempted) throw new WebSessionError("Web login already attempted during this cycle", "LOGIN_LIMIT");
    this.#attempted = true;
    this.#invalidated = false;
    this.#token = await this.#login(signal);
    if (this.#verify) await this.#verify(this.#token, { signal });
    this.#verified = true;
    return this.#token;
  }

  async #request(startUrl: string | URL, { method = "GET", headers = {}, body, signal }: WebRequestOptions = {}): Promise<HttpResponse> {
    let url = safeUrl(startUrl);
    let currentMethod = method;
    let currentBody = body;
    const currentHeaders: Record<string, string> = { "user-agent": USER_AGENT, ...headers };
    for (let hops = 0; hops <= 10; hops += 1) {
      if (currentMethod.toUpperCase() === "POST" && url.origin !== AUTH_ORIGIN) {
        throw new WebSessionError("Refusing to submit login credentials outside auth.netatmo.com", "REDIRECT_REJECTED");
      }
      const cookie = await this.#jar.getCookieString(url.href);
      const requestHeaders = { ...currentHeaders };
      if (cookie) requestHeaders.cookie = cookie;
      else delete requestHeaders.cookie;
      let response: HttpResponse;
      try {
        response = await this.#http.request(url.href, {
          method: currentMethod,
          headers: requestHeaders,
          body: currentBody,
          signal,
          allowedHosts: [...ALLOWED_HOSTS],
          redirect: "manual"
        });
      } catch (error: unknown) {
        if (isRateLimited(error)) {
          throw new WebSessionError("Netatmo authentication request was rate limited", "WEB_RATE_LIMITED", {
            status: 429,
            retryAfterMs: error.retryAfterMs
          });
        }
        throw new WebSessionError("Netatmo authentication request failed", "WEB_TRANSPORT_ERROR");
      }
      for (const setCookie of getSetCookies(response.headers)) {
        try { await this.#jar.setCookie(setCookie, url.href, { ignoreError: false }); } catch { /* malformed cookies are ignored */ }
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) throw new WebSessionError("Authentication redirect has no location", "REDIRECT_INVALID");
      if (hops === 10) throw new WebSessionError("Too many authentication redirects", "REDIRECT_LIMIT");
      const next = safeUrl(new URL(location, url));
      const crossOrigin = next.origin !== url.origin;
      if (crossOrigin && [307, 308].includes(response.status) && currentBody !== undefined) {
        throw new WebSessionError("Refusing to forward an authentication request body across origins", "REDIRECT_REJECTED");
      }
      if (response.status === 303 || ([301, 302].includes(response.status) && currentMethod.toUpperCase() === "POST")) {
        currentMethod = "GET";
        currentBody = undefined;
        delete currentHeaders["content-type"];
        delete currentHeaders["Content-Type"];
      }
      if (crossOrigin) {
        for (const key of Object.keys(currentHeaders)) {
          if (["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase())) delete currentHeaders[key];
        }
      }
      url = next;
    }
    throw new WebSessionError("Authentication redirect limit exceeded", "REDIRECT_LIMIT");
  }

  async #login(signal?: AbortSignal): Promise<string> {
    this.#jar = new CookieJar();
    let response = await this.#request(`${AUTH_ORIGIN}/en-us/access/login`, { signal });
    if (response.status < 200 || response.status >= 400) throw new WebSessionError("Could not load Netatmo login page");
    if (this.#hasChallenge(response.text)) throw new WebSessionError("Netatmo login requires an unsupported challenge", "AUTH_CHALLENGE");
    await this.#jar.setCookie("netatmocomlast_app_used=app_thermostat; Domain=.netatmo.com; Path=/; Secure", AUTH_ORIGIN);

    response = await this.#request(`${AUTH_ORIGIN}/access/csrf`, { signal });
    if (response.status !== 200) throw new WebSessionError("Could not retrieve Netatmo login token");
    let csrf: string | undefined;
    try {
      const parsed: unknown = JSON.parse(response.text);
      if (typeof parsed === "object" && parsed !== null && "token" in parsed && typeof parsed.token === "string") csrf = parsed.token;
    } catch { /* handled below */ }
    if (typeof csrf !== "string" || csrf.length === 0) throw new WebSessionError("Netatmo login token response was invalid");

    const form = new URLSearchParams({ email: this.#username, password: this.#password, stay_logged: "on", _token: csrf });
    response = await this.#request(`${AUTH_ORIGIN}/access/postlogin`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(), signal
    });
    if (response.status < 200 || response.status >= 400) throw new WebSessionError("Netatmo login was rejected");
    if (this.#hasChallenge(response.text)) {
      throw new WebSessionError("Netatmo login requires an unsupported challenge", "AUTH_CHALLENGE");
    }

    response = await this.#request(`${AUTH_ORIGIN}/access/keychain?next_url=${encodeURIComponent("https://my.netatmo.com")}`, { signal });
    if (response.status < 200 || response.status >= 400) throw new WebSessionError("Netatmo keychain exchange failed");
    if (this.#hasChallenge(response.text)) throw new WebSessionError("Netatmo login requires an unsupported challenge", "AUTH_CHALLENGE");
    for (const host of ["https://auth.netatmo.com/", "https://my.netatmo.com/", "https://app.netatmo.net/"]) {
      const cookies = await this.#jar.getCookies(host);
      const found = cookies.find((cookie) => cookie.key === "netatmocomaccess_token");
      if (found?.value) {
        let token = found.value;
        try { token = decodeURIComponent(token); } catch { /* retain cookie value if malformed */ }
        if (token && !/[\r\n]/.test(token)) return token;
      }
    }
    throw new WebSessionError("Netatmo login did not produce an access token");
  }

  #hasChallenge(text: string): boolean {
    return /captcha\s+(?:required|challenge)|multi.factor authentication|two.factor authentication|verification code required|challenge required/i.test(text);
  }
}
