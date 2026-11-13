import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { main } from "../src/index.js";

test("invalid startup configuration reports a fixed diagnostic before any network request", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "netatmo-service-"));
  try {
    await writeFile(join(cwd, "config.json"), JSON.stringify({
      mappings: [{ sourceDeviceName: "Coach", targetHomeName: "Home", targetRoomName: "Room" }]
    }));
    let requests = 0;
    const events = [];
    const code = await main({
      cwd,
      env: { NETATMO_USERNAME: "user", NETATMO_PASSWORD: "password" },
      fetchImpl: async () => { requests += 1; throw new Error("unexpected network access"); },
      log: (event) => events.push(event)
    });
    assert.equal(code, 1);
    assert.equal(requests, 0);
    assert.deepEqual(events, [{ event: "startup_failed", level: "error", outcome: "missing_access_token" }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("real service wiring passes shutdown into an in-flight mocked request and makes no later calls", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "netatmo-service-"));
  try {
    await writeFile(join(cwd, "config.json"), JSON.stringify({
      mappings: [{ sourceDeviceName: "Coach", targetHomeName: "Home", targetRoomName: "Room" }]
    }));
    const processLike = new EventEmitter();
    const requests = [];
    const events = [];
    const fetchImpl = async (url, { signal }) => {
      requests.push(String(url));
      processLike.emit("SIGTERM");
      assert.equal(signal.aborted, true);
      return {
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ body: { devices: [] } })
      };
    };
    const code = await main({
      cwd,
      processLike,
      env: {
        ACCESS_TOKEN: "synthetic-access-token",
        NETATMO_USERNAME: "synthetic-user",
        NETATMO_PASSWORD: "synthetic-password"
      },
      fetchImpl,
      log: (event) => events.push(event)
    });
    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^https:\/\/api\.netatmo\.com\//);
    assert.equal(events.some((event) => event.outcome === "access_token_only"), true);
    assert.equal(processLike.listenerCount("SIGTERM"), 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
