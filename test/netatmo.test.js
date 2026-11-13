import test from "node:test";
import assert from "node:assert/strict";
import { NetatmoClient, NetatmoApiError } from "../src/netatmo.js";
import { HttpClient } from "../src/http.js";

const json = (status, value, headers = {}) => ({ status, headers: new Headers(headers), text: JSON.stringify(value) });

function setup({ calibration = json(200, { status: "ok" }), verification = json(200, { body: { homes: [] } }), throwWrite } = {}) {
  const calls = [];
  let invalidations = 0;
  const oauthClient = { beginCycle() {}, async request(url, options) { calls.push({ kind: "oauth", url, options }); return json(200, { body: {} }); } };
  const webSession = { beginCycle() {}, async getAccessToken() { return "web-token"; }, invalidate() { invalidations += 1; } };
  const httpClient = { async request(url, options) {
    calls.push({ kind: "web", url, options });
    if (url.endsWith("/homesdata")) return verification;
    if (throwWrite) throw throwWrite;
    return calibration;
  } };
  return { client: new NetatmoClient({ oauthClient, webSession, httpClient }), calls, get invalidations() { return invalidations; } };
}

test("reads use OAuth API; web token is verified separately and write payload is exact", async () => {
  const s = setup();
  await s.client.getHomeCoachData();
  await s.client.getHomesData();
  await s.client.getHomeStatus("home id");
  const result = await s.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 21.2, correctedTemperature: 21.8 });
  assert.equal(result.outcome, "updated");
  assert.equal(s.calls.filter((c) => c.kind === "oauth").length, 3);
  const verify = s.calls.find((c) => c.url.endsWith("/homesdata") && c.kind === "web");
  const write = s.calls.find((c) => c.url.endsWith("/truetemperature"));
  assert.equal(verify.options.headers.authorization, "Bearer web-token");
  assert.equal(write.options.headers.authorization, "Bearer web-token");
  assert.deepEqual(JSON.parse(write.options.body), { home_id: "h", room_id: "r", current_temperature: 21.2, corrected_temperature: 21.8 });
  assert.equal(s.calls.filter((c) => c.url.endsWith("/homesdata") && c.kind === "web").length, 1);
});

test("only exact 406 code 7 Nothing to modify is a no-op", async () => {
  const ok = setup({ calibration: json(406, { error: { code: 7, message: "Nothing to modify" } }) });
  assert.deepEqual(await ok.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 20 }), { outcome: "no-op", status: 406, code: 7 });
  for (const calibration of [
    json(406, { error: { code: 7, message: "Different message" } }),
    json(406, { error: { code: 13, message: "Operation is forbidden" } }),
    json(200, { message: "success" })
  ]) {
    const s = setup({ calibration });
    await assert.rejects(s.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), NetatmoApiError);
  }
});

test("malformed and transport-failed writes are indeterminate and never replayed", async () => {
  for (const s of [
    setup({ calibration: { status: 200, headers: new Headers(), text: "not json" } }),
    setup({ throwWrite: Object.assign(new Error("canary-secret"), { code: "canary-secret" }) })
  ]) {
    await assert.rejects(s.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), (error) => error.outcome === "indeterminate");
    assert.equal(s.calls.filter((c) => c.url.endsWith("/truetemperature")).length, 1);
  }
});

test("web verification requires a usable homes response and does not expose response details", async () => {
  const s = setup({ verification: json(200, { body: { error: { message: "secret-canary" } } }) });
  await assert.rejects(s.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), (error) => {
    assert.match(error.message, /could not access/);
    assert.equal(error.message.includes("secret-canary"), false);
    return true;
  });
  assert.equal(s.calls.some((c) => c.url.endsWith("/truetemperature")), false);
});

test("explicit expired session invalidates once and failed writes are not retried", async () => {
  const s = setup({ calibration: json(401, { error: { code: 401, message: "session token expired" } }) });
  await assert.rejects(s.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), (error) => error.outcome === "indeterminate");
  assert.equal(s.invalidations, 1);
  assert.equal(s.calls.filter((c) => c.url.endsWith("/truetemperature")).length, 1);
});

test("only explicit session messages or HTTP 401 invalidate after a failed write", async () => {
  for (const calibration of [
    json(403, { error: { code: 13, message: "Operation is forbidden" } }),
    json(400, { error: { code: 42, message: "Invalid temperature value" } }),
    json(400, { error: { code: 43, message: "Invalid room identifier" } }),
    json(400, { error: { code: 44, message: "Invalid request" } })
  ]) {
    const s = setup({ calibration });
    await assert.rejects(s.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), NetatmoApiError);
    assert.equal(s.invalidations, 0);
    assert.equal(s.calls.filter((c) => c.url.endsWith("/truetemperature")).length, 1);
  }

  const tokenError = setup({ calibration: json(400, { error: { code: 45, message: "Access token is invalid" } }) });
  await assert.rejects(tokenError.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), NetatmoApiError);
  assert.equal(tokenError.invalidations, 1);
  assert.equal(tokenError.calls.filter((c) => c.url.endsWith("/truetemperature")).length, 1);
});

test("app homes verification invalidates only on 401 or an explicit session message", async () => {
  const unrelated = setup({ verification: json(403, { error: { code: 13, message: "Invalid home configuration" } }) });
  await assert.rejects(unrelated.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), NetatmoApiError);
  assert.equal(unrelated.invalidations, 0);
  assert.equal(unrelated.calls.some((c) => c.url.endsWith("/truetemperature")), false);

  const session = setup({ verification: json(403, { error: { code: 13, message: "Session is expired" } }) });
  await assert.rejects(session.client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), NetatmoApiError);
  assert.equal(session.invalidations, 1);
  assert.equal(session.calls.some((c) => c.url.endsWith("/truetemperature")), false);
});

test("app verification and calibration never follow redirects or replay credentials", async () => {
  for (const phase of ["verification", "calibration"]) {
    for (const status of [301, 302, 303, 307, 308]) {
      for (const location of ["/outside-api", "https://outside.example/api"]) {
        const requests = [];
        const client = new NetatmoClient({
          oauthClient: { async request() { throw new Error("unexpected OAuth request"); } },
          webSession: { async getAccessToken() { return "canary-bearer"; } },
          httpClient: new HttpClient({ fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (phase === "calibration" && requests.length === 1) {
              return new Response(JSON.stringify({ body: { homes: [] } }), { status: 200 });
            }
            return new Response("{}", { status, headers: { location } });
          } })
        });
        await assert.rejects(client.calibrateRoom({ homeId: "h", roomId: "r", currentTemperature: 20, correctedTemperature: 21 }), NetatmoApiError);
        assert.equal(requests.length, phase === "verification" ? 1 : 2, `${phase} ${status} ${location}`);
        assert.equal(requests.at(-1).options.headers.get("authorization"), "Bearer canary-bearer");
        assert.equal(requests.some(({ url }) => url.includes("outside-api") || url.includes("outside.example")), false);
      }
    }
  }
});
