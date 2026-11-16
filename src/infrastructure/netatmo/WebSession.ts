import { CookieJar } from "tough-cookie";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "../http/HttpClient.js";
import { HttpError } from "../http/HttpError.js";
import { WebSessionError } from "./WebSessionError.js";
import type { LoggerInterface } from "../../shared/logging/interfaces/LoggerInterface.js";

const ALLOWED_HOSTS = ["auth.netatmo.com", "my.netatmo.com", "app.netatmo.net", "home.netatmo.com"] as const;
const ALLOWED_HOST_SET: ReadonlySet<string> = new Set(ALLOWED_HOSTS);
const AUTH_ORIGIN = "https://auth.netatmo.com";
const USER_AGENT = "netatmo-home";

type LoginOptions = { signal?: AbortSignal };
type WebRequestOptions = Omit<HttpRequestOptions, "allowedHosts" | "redirect" | "headers"> & {
  headers?: Record<string, string>;
  onInitialResponse?: (status: number) => void;
};
export type VerifyAccessToken = (token: string, options?: LoginOptions) => Promise<void>;
export type WebSessionOptions = {
  httpClient: HttpClient;
  username: string;
  password: string;
  verifyAccessToken?: VerifyAccessToken;
  logger?: LoggerInterface;
};

type AuthStage = "login_cycle" | "login_page" | "csrf" | "password_submission" | "keychain" | "token_extraction" | "session_verification";
const SAFE_AUTH_CODES = new Set([
  "WEB_TRANSPORT_ERROR", "WEB_RATE_LIMITED", "REDIRECT_REJECTED", "REDIRECT_INVALID", "REDIRECT_LIMIT",
  "AUTH_CHALLENGE", "LOGIN_LIMIT", "WEB_SESSION_INVALID", "HTTP_STATUS", "ETIMEDOUT", "ECONNRESET",
  "EAI_AGAIN", "ENOTFOUND", "ENETWORK", "EABORTED", "EHOST", "EURL", "EHEADERS", "EOPTIONS",
  "EMETHOD", "EREDIRECTLIMIT", "EREDIRECTHOST", "EREDIRECTCREDENTIALS"
]);

type RedirectRejectionReason = "invalid_url" | "scheme" | "host" | "credentials" | "port" | "post_origin" | "body_forwarding" | "missing_location";
const REDIRECT_REJECTION_REASONS = new Set<RedirectRejectionReason>(["invalid_url", "scheme", "host", "credentials", "port", "post_origin", "body_forwarding", "missing_location"]);
const SAFE_DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function safeUrl(value: string | URL, onRejected?: (reason: RedirectRejectionReason, host?: string) => void): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error: unknown) {
    onRejected?.("invalid_url");
    throw error;
  }
  let reason: RedirectRejectionReason | undefined;
  if (url.protocol !== "https:") reason = "scheme";
  else if (!ALLOWED_HOST_SET.has(url.hostname)) reason = "host";
  else if (url.username || url.password) reason = "credentials";
  else if (url.port && url.port !== "443") reason = "port";
  if (reason) {
    onRejected?.(reason, !url.username && !url.password && SAFE_DNS_NAME.test(url.hostname) ? url.hostname : undefined);
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
  #logger: LoggerInterface | undefined;

  constructor({ httpClient, username, password, verifyAccessToken, logger }: WebSessionOptions) {
    if (!httpClient?.request) throw new TypeError("httpClient.request is required");
    if (!username || !password) throw new TypeError("Web-session username and password are required");
    this.#http = httpClient;
    this.#username = username;
    this.#password = password;
    this.#jar = new CookieJar();
    this.#verify = verifyAccessToken;
    this.#logger = logger;
  }

  #log(stage: AuthStage, transition: "started" | "succeeded" | "failed" | "reused", errorCode?: string): void {
    try {
      this.#logger?.log({
        event: `netatmo.web_auth.${stage}.${transition}`,
        outcome: transition === "reused" ? "cached_token" : transition,
        ...(errorCode ? { errorCode } : {})
      });
    } catch { /* diagnostics must never affect authentication */ }
  }

  #logTransportFailure(error: unknown): void {
    const candidate = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const errorCode = isRateLimited(error) ? "WEB_RATE_LIMITED" : candidate && SAFE_AUTH_CODES.has(candidate) ? candidate : "WEB_TRANSPORT_ERROR";
    try { this.#logger?.log({ event: "netatmo.web_auth.transport.failed", outcome: "failed", errorCode }); }
    catch { /* diagnostics must never affect authentication */ }
  }

  #logRedirectRejection(reason: RedirectRejectionReason, host?: string): void {
    if (!REDIRECT_REJECTION_REASONS.has(reason)) return;
    try {
      this.#logger?.log({
        event: "netatmo.web_auth.redirect.rejected",
        outcome: "rejected",
        redirectReason: reason,
        ...(host && SAFE_DNS_NAME.test(host) ? { redirectHost: host } : {})
      });
    } catch { /* diagnostics must never affect authentication */ }
  }

  async #stage<T>(stage: AuthStage, operation: () => Promise<T>, validate?: (value: T) => string | undefined): Promise<T> {
    this.#log(stage, "started");
    try {
      const value = await operation();
      const errorCode = validate?.(value);
      if (errorCode) {
        this.#log(stage, "failed", errorCode);
        return value;
      }
      this.#log(stage, "succeeded");
      return value;
    } catch (error: unknown) {
      const candidate = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
      const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" && Number.isInteger(error.status) ? `HTTP_${error.status}` : undefined;
      this.#log(stage, "failed", status ?? (candidate && SAFE_AUTH_CODES.has(candidate) ? candidate : "WEB_SESSION_INVALID"));
      throw error;
    }
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
      this.#log("login_cycle", "reused");
      if (!this.#verified && this.#verify) {
        await this.#stage("session_verification", () => this.#verify!(this.#token!, { signal }));
        this.#verified = true;
      }
      return this.#token;
    }
    if (this.#attempted) {
      this.#log("login_cycle", "failed", "LOGIN_LIMIT");
      throw new WebSessionError("Web login already attempted during this cycle", "LOGIN_LIMIT");
    }
    this.#log("login_cycle", "started");
    this.#attempted = true;
    this.#invalidated = false;
    try {
      this.#token = await this.#login(signal);
      if (this.#verify) await this.#stage("session_verification", () => this.#verify!(this.#token!, { signal }));
      this.#log("login_cycle", "succeeded");
    } catch (error: unknown) {
      const candidate = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
      this.#log("login_cycle", "failed", candidate && SAFE_AUTH_CODES.has(candidate) ? candidate : "WEB_SESSION_INVALID");
      throw error;
    }
    this.#verified = true;
    return this.#token;
  }

  async #request(startUrl: string | URL, { method = "GET", headers = {}, body, signal, onInitialResponse }: WebRequestOptions = {}): Promise<HttpResponse> {
    let url = safeUrl(startUrl, (reason, host) => this.#logRedirectRejection(reason, host));
    let currentMethod = method;
    let currentBody = body;
    const currentHeaders: Record<string, string> = { "user-agent": USER_AGENT, ...headers };
    let responseObserved = false;
    for (let hops = 0; hops <= 10; hops += 1) {
      if (currentMethod.toUpperCase() === "POST" && url.origin !== AUTH_ORIGIN) {
        this.#logRedirectRejection("post_origin", url.username || url.password ? undefined : url.hostname);
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
        this.#logTransportFailure(error);
        if (isRateLimited(error)) {
          throw new WebSessionError("Netatmo authentication request was rate limited", "WEB_RATE_LIMITED", {
            status: 429,
            retryAfterMs: error.retryAfterMs
          });
        }
        throw new WebSessionError("Netatmo authentication request failed", "WEB_TRANSPORT_ERROR");
      }
      if (!responseObserved) {
        responseObserved = true;
        try { onInitialResponse?.(response.status); } catch { /* diagnostics must never affect authentication */ }
      }
      for (const setCookie of getSetCookies(response.headers)) {
        try { await this.#jar.setCookie(setCookie, url.href, { ignoreError: false }); } catch { /* malformed cookies are ignored */ }
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) {
        this.#logRedirectRejection("missing_location");
        throw new WebSessionError("Authentication redirect has no location", "REDIRECT_INVALID");
      }
      if (hops === 10) throw new WebSessionError("Too many authentication redirects", "REDIRECT_LIMIT");
      let redirectTarget: URL;
      try {
        redirectTarget = new URL(location, url);
      } catch (error: unknown) {
        this.#logRedirectRejection("invalid_url");
        throw error;
      }
      const next = safeUrl(redirectTarget, (reason, host) => this.#logRedirectRejection(reason, host));
      const crossOrigin = next.origin !== url.origin;
      if (crossOrigin && [307, 308].includes(response.status) && currentBody !== undefined) {
        this.#logRedirectRejection("body_forwarding", next.username || next.password ? undefined : next.hostname);
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
    let response = await this.#stage("login_page", () => this.#request(`${AUTH_ORIGIN}/en-us/access/login`, { signal }), (result) => {
      if (result.status < 200 || result.status >= 400) return `HTTP_${result.status}`;
      return this.#hasChallenge(result.text) ? "AUTH_CHALLENGE" : undefined;
    });
    if (response.status < 200 || response.status >= 400) throw new WebSessionError("Could not load Netatmo login page");
    if (this.#hasChallenge(response.text)) throw new WebSessionError("Netatmo login requires an unsupported challenge", "AUTH_CHALLENGE");
    await this.#jar.setCookie("netatmocomlast_app_used=app_thermostat; Domain=.netatmo.com; Path=/; Secure", AUTH_ORIGIN);

    response = await this.#stage("csrf", () => this.#request(`${AUTH_ORIGIN}/access/csrf`, { signal }), (result) => {
      if (result.status !== 200) return `HTTP_${result.status}`;
      try {
        const parsed: unknown = JSON.parse(result.text);
        return typeof parsed === "object" && parsed !== null && "token" in parsed && typeof parsed.token === "string" && parsed.token.length > 0 ? undefined : "CSRF_INVALID";
      } catch { return "CSRF_INVALID"; }
    });
    if (response.status !== 200) throw new WebSessionError("Could not retrieve Netatmo login token");
    let csrf: string | undefined;
    try {
      const parsed: unknown = JSON.parse(response.text);
      if (typeof parsed === "object" && parsed !== null && "token" in parsed && typeof parsed.token === "string") csrf = parsed.token;
    } catch { /* handled below */ }
    if (typeof csrf !== "string" || csrf.length === 0) throw new WebSessionError("Netatmo login token response was invalid");

    const form = new URLSearchParams({ email: this.#username, password: this.#password, stay_logged: "on", _token: csrf });
    response = await this.#stage("password_submission", () => this.#request(`${AUTH_ORIGIN}/access/postlogin`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(), signal,
      onInitialResponse: (status) => {
        try { this.#logger?.log({ event: "netatmo.web_auth.password_submission.response", outcome: "response_received", errorCode: `HTTP_${status}` }); }
        catch { /* diagnostics must never affect authentication */ }
      }
    }), (result) => {
      if (result.status < 200 || result.status >= 400) return `HTTP_${result.status}`;
      return this.#hasChallenge(result.text) ? "AUTH_CHALLENGE" : undefined;
    });
    if (response.status < 200 || response.status >= 400) throw new WebSessionError("Netatmo login was rejected");
    if (this.#hasChallenge(response.text)) {
      throw new WebSessionError("Netatmo login requires an unsupported challenge", "AUTH_CHALLENGE");
    }

    response = await this.#stage("keychain", () => this.#request(`${AUTH_ORIGIN}/access/keychain?next_url=${encodeURIComponent("https://my.netatmo.com")}`, { signal }), (result) => {
      if (result.status < 200 || result.status >= 400) return `HTTP_${result.status}`;
      return this.#hasChallenge(result.text) ? "AUTH_CHALLENGE" : undefined;
    });
    if (response.status < 200 || response.status >= 400) throw new WebSessionError("Netatmo keychain exchange failed");
    if (this.#hasChallenge(response.text)) throw new WebSessionError("Netatmo login requires an unsupported challenge", "AUTH_CHALLENGE");
    const token = await this.#stage("token_extraction", async () => {
      for (const host of ["https://auth.netatmo.com/", "https://my.netatmo.com/", "https://app.netatmo.net/"]) {
        const cookies = await this.#jar.getCookies(host);
        const found = cookies.find((cookie) => cookie.key === "netatmocomaccess_token");
        if (found?.value) {
          let token = found.value;
          try { token = decodeURIComponent(token); } catch { /* retain cookie value if malformed */ }
          if (token && !/[\r\n]/.test(token)) return token;
        }
      }
      return undefined;
    }, (value) => value ? undefined : "TOKEN_NOT_FOUND");
    if (!token) throw new WebSessionError("Netatmo login did not produce an access token");
    return token;
  }

  #hasChallenge(text: string): boolean {
    return /captcha\s+(?:required|challenge)|multi.factor authentication|two.factor authentication|verification code required|challenge required/i.test(text);
  }
}
