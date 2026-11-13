import test from "node:test";
import assert from "node:assert/strict";
import { HttpClient, HttpError } from "../src/http.js";

function response(status, { headers = {}, text = "{}", body } = {}) {
  return {
    status,
    headers: new Headers(headers),
    text: async () => text,
    body: body ?? { cancel: async () => {} }
  };
}

test("HTTP transport rejects non-HTTPS and non-allowlisted hosts before fetch", async () => {
  let calls = 0;
  const client = new HttpClient({ fetchImpl: async () => { calls += 1; } });
  await assert.rejects(client.request("http://api.netatmo.com/x"), { code: "EHOST" });
  await assert.rejects(client.request("https://api.netatmo.com:8443/x"), { code: "EHOST" });
  await assert.rejects(client.request("https://example.com/x"), { code: "EHOST" });
  assert.equal(calls, 0);
});

test("default redirects enforce host allowlist and strip credentials on cross-origin GET redirect", async () => {
  const seen = [];
  const client = new HttpClient({ fetchImpl: async (url, init) => {
    seen.push({ url: String(url), method: init.method, headers: new Headers(init.headers) });
    return seen.length === 1
      ? response(302, { headers: { location: "https://auth.netatmo.com/login" } })
      : response(200, { text: "ok" });
  } });
  const result = await client.request("https://api.netatmo.com/start", {
    headers: { authorization: "Bearer secret", cookie: "session=secret", "x-private": "secret", accept: "application/json" },
    allowedHosts: ["api.netatmo.com", "auth.netatmo.com"]
  });
  assert.equal(result.text, "ok");
  assert.equal(seen[1].headers.has("authorization"), false);
  assert.equal(seen[1].headers.has("cookie"), false);
  assert.equal(seen[1].headers.has("x-private"), false);
  assert.equal(seen[1].headers.get("accept"), "application/json");

  const blocked = new HttpClient({ fetchImpl: async () => response(302, { headers: { location: "https://evil.example/" } }) });
  await assert.rejects(blocked.request("https://api.netatmo.com/start"), { code: "EREDIRECTHOST" });
});

test("browser redirects change POST to GET for 302 and pass manual redirects through", async () => {
  const seen = [];
  const client = new HttpClient({ fetchImpl: async (_url, init) => {
    seen.push({ method: init.method, body: init.body });
    return seen.length === 1 ? response(302, { headers: { location: "/next" } }) : response(200);
  } });
  await client.request("https://api.netatmo.com/start", { method: "POST", body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.deepEqual(seen, [{ method: "POST", body: "x=1" }, { method: "GET", body: undefined }]);

  const manual = new HttpClient({ fetchImpl: async () => response(303, { headers: { location: "/next" }, text: "redirect" }) });
  const redirected = await manual.request("https://api.netatmo.com/start", { redirect: "manual" });
  assert.equal(redirected.status, 303);
  assert.equal(redirected.text, "redirect");
});

test("redirect count and credential-bearing cross-origin body are bounded", async () => {
  const looping = new HttpClient({ fetchImpl: async () => response(302, { headers: { location: "/again" } }), maxRedirects: 1 });
  await assert.rejects(looping.request("https://api.netatmo.com/start"), { code: "EREDIRECTLIMIT" });
  const crossOriginPost = new HttpClient({ fetchImpl: async () => response(307, { headers: { location: "https://auth.netatmo.com/next" } }) });
  await assert.rejects(crossOriginPost.request("https://api.netatmo.com/start", {
    method: "POST", body: "password=p", allowedHosts: ["api.netatmo.com", "auth.netatmo.com"]
  }), { code: "EREDIRECTCREDENTIALS" });
});

test("25 second timeout includes complete response body and returns safe error", async () => {
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  const client = new HttpClient({ timeoutMs: 20, fetchImpl: async () => ({
    status: 200,
    headers: new Headers(),
    text: async () => { bodyStarted(); return new Promise(() => {}); }
  }) });
  const pending = client.request("https://api.netatmo.com/x");
  await started;
  await assert.rejects(pending, (error) => error instanceof HttpError && error.code === "ETIMEDOUT" && !error.message.includes("api.netatmo"));
});

test("caller abort and rate limit are safe and expose parsed Retry-After delay", async () => {
  const controller = new AbortController();
  let fetchStarted;
  const started = new Promise((resolve) => { fetchStarted = resolve; });
  const slow = new HttpClient({ fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    fetchStarted();
    signal.addEventListener("abort", () => reject(new Error("secret url")), { once: true });
  }) });
  const pending = slow.request("https://api.netatmo.com/x", { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { code: "EABORTED" });

  const limited = new HttpClient({ now: () => 100_000, fetchImpl: async () => response(429, { headers: { "retry-after": "12" }, text: "secret response" }) });
  await assert.rejects(limited.request("https://api.netatmo.com/x"), (error) => error.code === "ERATELIMIT" && error.retryAfterMs === 12_000 && !error.message.includes("secret"));
});
