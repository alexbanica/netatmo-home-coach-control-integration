import test from "node:test";
import assert from "node:assert/strict";
import { logEvent } from "../src/logging.js";

test("emits structured allowlisted fields and drops arbitrary sensitive error text", () => {
  const output = [];
  logEvent({ level: "error", event: "request-failed", outcome: "indeterminate", errorCode: "ETIMEDOUT",
    error: "password-canary bearer token-canary", body: "cookie-canary", url: "https://user:secret@example.test" },
  (line) => output.push(line));
  assert.equal(output.length, 1);
  const record = JSON.parse(output[0]);
  assert.equal(record.event, "request-failed");
  assert.equal(record.errorCode, "ETIMEDOUT");
  assert.equal("error" in record, false);
  assert.equal("body" in record, false);
  assert.equal("url" in record, false);
  assert.doesNotMatch(output[0], /canary|secret|example\.test/);
});

test("rejects unsafe error codes and nonfinite temperatures", () => {
  let output;
  logEvent({ errorCode: "raw secret text", sourceTemperature: Number.NaN }, (line) => { output = line; });
  const record = JSON.parse(output);
  assert.equal("errorCode" in record, false);
  assert.equal("sourceTemperature" in record, false);
});
