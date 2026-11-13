import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

const validEnv = {
  ACCESS_TOKEN: "oauth-access-canary", NETATMO_USERNAME: "user@example.test",
  NETATMO_PASSWORD: "password-canary"
};
const mapping = { sourceDeviceName: "Coach Å", targetHomeName: "Home", targetRoomName: "Room" };

async function setup(t, value = { mappings: [mapping] }) {
  const cwd = await mkdtemp(join(tmpdir(), "netatmo-config-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "config.json"), JSON.stringify(value));
  return cwd;
}

test("loads defaults, mappings and credentials", async (t) => {
  const cwd = await setup(t);
  const config = await loadConfig({ env: validEnv, cwd });
  assert.equal(config.syncIntervalMinutes, 5);
  assert.equal(config.maxReadingAgeMinutes, 15);
  assert.equal(config.dryRun, false);
  assert.deepEqual(config.mappings, [mapping]);
  assert.equal(config.credentials.accessToken, validEnv.ACCESS_TOKEN);
  assert.equal(config.credentials.refreshToken, undefined);
});

test("accepts custom intervals, explicit dry-run and complete refresh credentials", async (t) => {
  const cwd = await setup(t);
  const config = await loadConfig({ env: {
    ...validEnv, SYNC_INTERVAL_MINUTES: "7", MAX_READING_AGE_MINUTES: "23", DRY_RUN: "true",
    REFRESH_TOKEN: "refresh", CLIENT_ID: "id", CLIENT_SECRET: "secret"
  }, cwd });
  assert.equal(config.syncIntervalMinutes, 7);
  assert.equal(config.maxReadingAgeMinutes, 23);
  assert.equal(config.dryRun, true);
  assert.equal(config.credentials.clientSecret, "secret");
});

test("rejects invalid intervals, booleans, partial refresh and missing credentials", async (t) => {
  const cwd = await setup(t);
  for (const env of [
    { ...validEnv, SYNC_INTERVAL_MINUTES: "0" },
    { ...validEnv, SYNC_INTERVAL_MINUTES: "" },
    { ...validEnv, MAX_READING_AGE_MINUTES: "1.5" },
    { ...validEnv, DRY_RUN: "yes" },
    { ...validEnv, CLIENT_ID: "id" },
    { NETATMO_USERNAME: "user", NETATMO_PASSWORD: "pass" }
  ]) await assert.rejects(loadConfig({ env, cwd }));
});

test("rejects duplicate targets, unknown keys and empty mappings", async (t) => {
  const duplicate = { mappings: [mapping, { ...mapping, sourceDeviceName: "Other" }] };
  const cwd = await setup(t, duplicate);
  await assert.rejects(loadConfig({ env: validEnv, cwd }), /Duplicate target/);
  await writeFile(join(cwd, "config.json"), JSON.stringify({ mappings: [], extra: true }));
  await assert.rejects(loadConfig({ env: validEnv, cwd }), /unknown keys/);
});

test("uses inherited environment values and custom configuration path", async (t) => {
  const cwd = await setup(t);
  await writeFile(join(cwd, "chosen.json"), JSON.stringify({ mappings: [mapping] }));
  const config = await loadConfig({ env: { ...validEnv, CONFIG_FILE: "chosen.json", DRY_RUN: "true" }, cwd });
  assert.equal(config.configFile, join(cwd, "chosen.json"));
  assert.equal(config.dryRun, true);
});
