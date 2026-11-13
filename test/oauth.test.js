import test from "node:test";
import assert from "node:assert/strict";
import { OAuthClient } from "../src/oauth.js";

function result(status, text = "{}") { return { status, headers: new Headers(), text }; }

test("OAuth refresh rotates tokens in memory once per cycle then retries a safe GET once", async () => {
  const calls = [];
  let reads = 0;
  const httpClient = { async request(url, options) {
    calls.push({ url, ...options });
    if (url.endsWith("/oauth2/token")) return result(200, JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    reads += 1;
    return [1, 3, 4].includes(reads) ? result(401) : result(200, "read-ok");
  } };
  const client = new OAuthClient({ httpClient, accessToken: "old-access", refreshToken: "old-refresh", clientId: "id", clientSecret: "secret" });
  const first = await client.request("https://api.netatmo.com/api/homesdata");
  assert.equal(first.status, 200);
  assert.equal(client.accessToken, "new-access");
  assert.equal(client.refreshToken, "new-refresh");
  const refresh = calls.find((call) => call.url.endsWith("/oauth2/token"));
  assert.equal(refresh.method, "POST");
  assert.match(refresh.body, /grant_type=refresh_token/);
  assert.match(refresh.body, /refresh_token=old-refresh/);
  assert.match(refresh.body, /client_secret=secret/);
  assert.equal(calls[0].headers.get("authorization"), "Bearer old-access");
  assert.equal(calls[2].headers.get("authorization"), "Bearer new-access");

  const second401 = await client.request("https://api.netatmo.com/api/homesdata");
  assert.equal(second401.status, 401);
  assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 1);
  client.beginCycle();
  const afterNewCycle = await client.request("https://api.netatmo.com/api/homesdata");
  assert.equal(afterNewCycle.status, 200);
  assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 2);
});

test("OAuth never refreshes or replays a calibration POST", async () => {
  const calls = [];
  const httpClient = { async request(url, options) {
    calls.push({ url, ...options });
    return url.endsWith("/oauth2/token") ? result(200, '{"access_token":"new"}') : result(401);
  } };
  const client = new OAuthClient({ httpClient, accessToken: "old", refreshToken: "refresh", clientId: "id", clientSecret: "secret" });
  const post = await client.request("https://api.netatmo.com/api/truetemperature", { method: "POST", body: "{}" });
  assert.equal(post.status, 401);
  assert.equal(calls.length, 1);
});

test("refresh retains the current refresh token when response omits rotation", async () => {
  let reads = 0;
  const httpClient = { async request(url) {
    if (url.endsWith("/oauth2/token")) return result(200, '{"access_token":"rotated-access","expires_in":1800}');
    reads += 1;
    return reads === 1 ? result(401) : result(200);
  } };
  const client = new OAuthClient({ httpClient, accessToken: "old", refreshToken: "keep", clientId: "id", clientSecret: "secret" });
  await client.request("https://api.netatmo.com/api/homesdata");
  assert.equal(client.accessToken, "rotated-access");
  assert.equal(client.refreshToken, "keep");
});

test("OAuth constrains API host and sanitizes malformed or rejected refresh", async () => {
  const noCalls = { request: async () => { throw new Error("must not be called"); } };
  const client = new OAuthClient({ httpClient: noCalls, accessToken: "token" });
  await assert.rejects(client.request("https://example.com/api"), { code: "EHOST" });

  const rejected = new OAuthClient({
    httpClient: { request: async (url) => url.endsWith("/oauth2/token") ? result(200, "not json") : result(401) },
    accessToken: "token", refreshToken: "refresh", clientId: "id", clientSecret: "secret"
  });
  await assert.rejects(rejected.request("https://api.netatmo.com/api/homesdata"), (error) => error.code === "EOAUTHRESPONSE" && !error.message.includes("not json"));

  const invalidLifetime = new OAuthClient({
    httpClient: { request: async (url) => url.endsWith("/oauth2/token") ? result(200, '{"access_token":"new","expires_in":0}') : result(401) },
    accessToken: "token", refreshToken: "refresh", clientId: "id", clientSecret: "secret"
  });
  await assert.rejects(invalidLifetime.request("https://api.netatmo.com/api/homesdata"), { code: "EOAUTHRESPONSE" });
});
