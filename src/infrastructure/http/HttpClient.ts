import { HttpError } from "./HttpError.js";

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_REDIRECTS = 5;
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

export interface HttpRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal;
  allowedHosts?: readonly string[];
  redirect?: "follow" | "manual";
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
}

export interface HttpClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  maxRedirects?: number;
}

function safeUrl(input: string | URL, allowedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError("EURL"); }
  if (url.protocol !== "https:" || (url.port !== "" && url.port !== "443") || url.username || url.password || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new HttpError("EHOST");
  }
  return url;
}

function retryAfterMs(value: string | null, now: () => number): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) ? ms : undefined;
  }
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
}

function makeHeaders(headers: HeadersInit | undefined): Headers {
  try { return new Headers(headers); } catch { throw new HttpError("EHEADERS"); }
}

function withoutCredentials(headers: Headers): Headers {
  const result = new Headers();
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (CREDENTIAL_HEADERS.has(lower)) continue;
    // Do not carry caller-specific headers to another origin. These two are
    // content-negotiation metadata and are safe for a permitted redirect.
    if (lower === "accept" || lower === "user-agent") result.set(name, value);
  }
  return result;
}

function redirectMethod(status: number, method: string): string {
  if ((status === 301 || status === 302) && method.toUpperCase() === "POST") return "GET";
  if (status === 303 && !["GET", "HEAD"].includes(method.toUpperCase())) return "GET";
  return method;
}

/**
 * Bounded HTTPS transport. The timeout remains active until the complete
 * response body has been read. Redirects are checked and followed manually so
 * credentials cannot be forwarded by the fetch implementation.
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly maxRedirects: number;

  constructor({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now, maxRedirects = DEFAULT_MAX_REDIRECTS }: HttpClientOptions = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) throw new TypeError("maxRedirects must be a nonnegative integer");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.maxRedirects = maxRedirects;
  }

  async request(input: string | URL, { method = "GET", headers = {}, body, signal, allowedHosts = ["api.netatmo.com"], redirect = "follow" }: HttpRequestOptions = {}): Promise<HttpResponse> {
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0 || !["follow", "manual"].includes(redirect)) {
      throw new HttpError("EOPTIONS");
    }
    let url = safeUrl(input, allowedHosts);
    let currentMethod = String(method).toUpperCase();
    if (!/^[A-Z]+$/.test(currentMethod)) throw new HttpError("EMETHOD");
    let currentBody = body;
    let currentHeaders = makeHeaders(headers);
    let redirects = 0;

    while (true) {
      if (signal?.aborted) throw new HttpError("EABORTED");
      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      let rejectTimeout!: (reason?: unknown) => void;
      const timeoutPromise = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        rejectTimeout(new HttpError("ETIMEDOUT"));
      }, this.timeoutMs);
      let response: Response;
      let text: string;
      try {
        response = await Promise.race([this.fetchImpl(url, {
          method: currentMethod,
          headers: currentHeaders,
          body: currentBody,
          signal: controller.signal,
          redirect: "manual"
        }), timeoutPromise]);
        const status = response.status;
        const location = response.headers?.get?.("location");
        if (redirect === "follow" && [301, 302, 303, 307, 308].includes(status) && location) {
          if (redirects >= this.maxRedirects) throw new HttpError("EREDIRECTLIMIT", { status });
          let next: URL;
          try { next = safeUrl(new URL(location, url).href, allowedHosts); } catch { throw new HttpError("EREDIRECTHOST", { status }); }
          const nextMethod = redirectMethod(status, currentMethod);
          const bodyRemoved = nextMethod === "GET" || nextMethod === "HEAD";
          if (next.origin !== url.origin && !bodyRemoved && currentBody !== undefined && currentBody !== null) {
            throw new HttpError("EREDIRECTCREDENTIALS", { status });
          }
          try { await Promise.race([response.body?.cancel(), timeoutPromise]); } catch (error) {
            if (error instanceof HttpError) throw error;
            // Discard redirect body; cancellation failure does not affect the next request.
          }
          if (next.origin !== url.origin) currentHeaders = withoutCredentials(currentHeaders);
          if (bodyRemoved) {
            currentBody = undefined;
            currentHeaders.delete("content-length");
            currentHeaders.delete("content-type");
          }
          currentMethod = nextMethod;
          url = next;
          redirects += 1;
          continue;
        }
        text = await Promise.race([response.text(), timeoutPromise]);
      } catch (error: unknown) {
        if (error instanceof HttpError) throw error;
        if (timedOut) throw new HttpError("ETIMEDOUT");
        if (signal?.aborted) throw new HttpError("EABORTED");
        throw new HttpError("ENETWORK");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromCaller);
      }
      const result = { status: response.status, headers: response.headers, text };
      if (response.status === 429) {
        throw new HttpError("ERATELIMIT", {
          status: 429,
          retryAfterMs: retryAfterMs(response.headers?.get?.("retry-after") ?? null, this.now)
        });
      }
      return result;
    }
  }
}
