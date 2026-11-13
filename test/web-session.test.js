import test from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../src/http.js";
import { NetatmoClient } from "../src/netatmo.js";
import { OAuthClient } from "../src/oauth.js";
import { runCycle } from "../src/sync.js";
import { runScheduler } from "../src/scheduler.js";
import { WebSession } from "../src/web-session.js";

function response(status, text = "", headers = {}) {
  return { status, text, headers: new Headers(headers) };
}

test("direct login submits credentials only to auth host and extracts cookie token", async () => {
  const calls = [];
  const httpClient = { async request(url, options) {
    calls.push({ url, options });
    if (url.endsWith("/en-us/access/login")) return response(200, "login", { "set-cookie": "auth-session=one; Path=/; Secure; HttpOnly" });
    if (url.endsWith("/access/csrf")) return response(200, JSON.stringify({ token: "csrf" }));
    if (url.endsWith("/access/postlogin")) {
      assert.equal(new URLSearchParams(options.body).get("email"), "user@example.test");
      assert.equal(new URLSearchParams(options.body).get("password"), "secret");
      return response(200, "logged in");
    }
    if (url.includes("/access/keychain?")) return response(200, "ok", { "set-cookie": "netatmocomaccess_token=web%2Btoken; Domain=.netatmo.com; Path=/; Secure; HttpOnly" });
    throw new Error(`unexpected request ${url}`);
  } };
  let verified;
  const session = new WebSession({ httpClient, username: "user@example.test", password: "secret", verifyAccessToken: async (token) => { verified = token; } });
  assert.equal(await session.getAccessToken(), "web+token");
  assert.equal(verified, "web+token");
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ url }) => new URL(url).hostname === "auth.netatmo.com"));
  assert.ok(calls[2].options.body.includes("password=secret"));
  session.beginCycle();
  assert.equal(await session.getAccessToken(), "web+token");
  assert.equal(calls.length, 4, "cached token is reused without another login");
});

test("login stops on challenge and refuses an unapproved redirect host", async () => {
  const challenged = new WebSession({
    username: "u", password: "p",
    httpClient: { async request(url) { return url.endsWith("/access/csrf") ? response(200, '{"token":"c"}') : url.endsWith("/access/postlogin") ? response(200, "CAPTCHA required") : response(200); } }
  });
  await assert.rejects(challenged.getAccessToken(), { code: "AUTH_CHALLENGE" });

  const redirected = new WebSession({
    username: "u", password: "p",
    httpClient: { async request() { return response(302, "", { location: "https://evil.example/steal" }); } }
  });
  await assert.rejects(redirected.getAccessToken(), { code: "REDIRECT_REJECTED" });
});

test("a login is attempted at most once in one cycle", async () => {
  const session = new WebSession({ username: "u", password: "p", httpClient: { async request() { throw Object.assign(new Error("temporary"), { code: "ENETWORK" }); } } });
  await assert.rejects(session.getAccessToken());
  await assert.rejects(session.getAccessToken(), { code: "LOGIN_LIMIT" });
  session.beginCycle();
  await assert.rejects(session.getAccessToken());
});

test("HTTP login rate limit stops later mappings and carries only safe retry metadata to the scheduler", async () => {
  const requests = [];
  const events = [];
  const now = 1_800_000_000_000;
  const username = "secret-user-canary";
  const password = "secret-password-canary";
  const httpClient = new HttpClient({ fetchImpl: async (input, options) => {
    const url = new URL(input);
    const method = options.method;
    requests.push({ host: url.hostname, path: url.pathname, method });
    const reply = (status, body, headers = {}) => ({ status, headers: new Headers(headers), text: async () => JSON.stringify(body) });
    if (url.hostname === "auth.netatmo.com") {
      return reply(429, { error: "secret-body-canary" }, { "retry-after": "900" });
    }
    if (url.hostname === "api.netatmo.com" && url.pathname.endsWith("gethomecoachsdata")) {
      return reply(200, { body: { devices: [
        { module_name: "Coach A", dashboard_data: { Temperature: 21, time_utc: now / 1000 } },
        { module_name: "Coach B", dashboard_data: { Temperature: 22, time_utc: now / 1000 } }
      ] } });
    }
    if (url.hostname === "api.netatmo.com" && url.pathname.endsWith("homesdata")) {
      return reply(200, { body: { homes: [{ id: "home-id", name: "Home", rooms: [
        { id: "room-a", name: "Room A" }, { id: "room-b", name: "Room B" }
      ] }] } });
    }
    if (url.hostname === "api.netatmo.com" && url.pathname.endsWith("homestatus")) {
      return reply(200, { body: { home: { rooms: [{ id: "room-a", therm_measured_temperature: 20 }, { id: "room-b", therm_measured_temperature: 20 }] } } });
    }
    throw new Error("unexpected mocked request");
  } });
  const webSession = new WebSession({ httpClient, username, password });
  const client = new NetatmoClient({
    httpClient,
    oauthClient: new OAuthClient({ httpClient, accessToken: "synthetic-access-token" }),
    webSession
  });
  const config = {
    dryRun: false,
    maxReadingAgeMinutes: 15,
    mappings: [
      { sourceDeviceName: "Coach A", targetHomeName: "Home", targetRoomName: "Room A" },
      { sourceDeviceName: "Coach B", targetHomeName: "Home", targetRoomName: "Room B" }
    ]
  };
  const controller = new AbortController();
  let cycleResult;
  const waits = [];
  await runScheduler({
    intervalMs: 60_000,
    signal: controller.signal,
    now: () => now,
    log: (event) => events.push(event),
    wait: async (delay) => { waits.push(delay); controller.abort(); },
    runCycle: async ({ cycleId, signal }) => {
      cycleResult = await runCycle({ config, client, now: () => now, signal, cycleId, log: (event) => events.push(event) });
      return cycleResult;
    }
  });

  assert.equal(cycleResult.retryAfterMs, 900_000);
  assert.deepEqual(cycleResult.outcomes.map((entry) => entry.reason), ["rate_limited", "rate_limited"]);
  assert.deepEqual(waits, [900_000]);
  assert.equal(requests.filter(({ host }) => host === "auth.netatmo.com").length, 1);
  assert.equal(requests.some(({ method }) => method === "POST"), false, "a login POST and calibration POST are both suppressed");
  const rateLimitIndex = requests.findIndex(({ host }) => host === "auth.netatmo.com");
  assert.ok(rateLimitIndex >= 0);
  assert.deepEqual(requests.slice(rateLimitIndex + 1), [], "no API call follows the authentication 429");
  assert.equal(JSON.stringify(events).includes(username), false);
  assert.equal(JSON.stringify(events).includes(password), false);
  assert.equal(JSON.stringify(events).includes("secret-body-canary"), false);
});
