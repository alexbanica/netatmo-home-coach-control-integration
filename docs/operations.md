# Operations

## What the service does

The service reads Home Coach temperatures and configured heating-room
measurements, then may call Netatmo's undocumented web-app True Temperature
endpoint to calibrate a room. True Temperature is a sensor calibration. It is
not a target setpoint, schedule or heating-mode command, and it does not bind a
Home Coach as a supported external sensor. An accepted API response is not
evidence that a valve or heating system physically responded.

The app endpoint and direct web-login flow are undocumented and may change.
Only a zero-adjustment response was observed during planning; a changed-write
success response body has not been observed. The implementation's recognized
`status: "ok"` success shape is a conservative assumption. A5 still needs an
authorized nonzero live write plus subsequent room/app evidence. Physical
heating response is separately unverified and must not be inferred from API
acceptance. Historical generic HTTP 403 calibration-path records do not show
whether the rejection came from pre-write session verification or the
calibration POST, and do not establish the cause or frequency of connection
emails. This recovery change cannot be attributed as a fix for those incidents
from the available logs. This delivery remains DRAFT.

## Configuration

Create `config.json` from the example only when it does not already exist:

```sh
cp -n config.example.json config.json
```

The JSON document has exactly one top-level key, `mappings`, containing a
nonempty array. Each entry must contain only these three nonempty, case-sensitive
and Unicode-preserving names:

```json
{
  "mappings": [
    {
      "sourceDeviceName": "Home Coach Living Room",
      "targetHomeName": "Example Home",
      "targetRoomName": "Living Room"
    }
  ]
}
```

Names must exactly match Netatmo's discovered names. No fuzzy matching is
performed. A source device may feed multiple target rooms, but a home/room
target may appear only once. Missing or ambiguous discovery results skip that
mapping; the service never selects an arbitrary device or room. Configuration
is loaded at startup, so edits require a restart.

Connection credentials and runtime settings come from environment variables.
`CONFIG_FILE` selects the JSON file and defaults to `./config.json`.

| Variable | Required | Default / rule |
| --- | --- | --- |
| `ACCESS_TOKEN` | Yes, including dry-run | Provisioned OAuth access token for the read APIs. |
| `NETATMO_USERNAME` | Yes, including dry-run | Netatmo account email used for web-session login. |
| `NETATMO_PASSWORD` | Yes, including dry-run | Netatmo account password used for web-session login. |
| `REFRESH_TOKEN` | No | Optional OAuth refresh; must be supplied together with `CLIENT_ID` and `CLIENT_SECRET`. |
| `CLIENT_ID` | No | Required with both other refresh values. |
| `CLIENT_SECRET` | No | Required with both other refresh values. |
| `CONFIG_FILE` | No | `./config.json`. |
| `SYNC_INTERVAL_MINUTES` | No | `5`; positive integer. |
| `MAX_READING_AGE_MINUTES` | No | `15`; positive integer, independent of the cycle interval. |
| `MAX_CORRECTION_C` | No | `5`°C; positive finite Celsius value in 0.1°C increments. Caps the absolute adjustment in each write. |
| `CALIBRATION_RETRY_UNCHANGED_CYCLES` | No | `2`; positive integer count of unchanged valid room readings before another write is eligible. |
| `CALIBRATION_STATE_FILE` | No | `./calibration-state.json`, relative to the working directory. Stores each room's last successful write's normalized pre-write temperature. |
| `DRY_RUN` | No | `false`; only literal `true` or `false` is accepted. |

Malformed JSON, unknown keys, duplicate targets, invalid settings, incomplete
refresh credentials, missing required credentials, or invalid/unreadable
calibration state stop startup with a nonzero exit before API or calibration
work. Dry-run still requires all three
required credentials, performs reads and reports intended adjustments, but
does not issue True Temperature writes.

## OAuth and web-session credentials

Provision an OAuth access token outside this service using Netatmo's supported
developer authorization flow and the scopes `read_homecoach`,
`read_thermostat`, and `write_thermostat`. The service has no credential
acquisition UI and never obtains OAuth credentials for you. The
`write_thermostat` scope does not establish that Netatmo's undocumented True
Temperature endpoint accepts a particular token; an observed token was
rejected by that endpoint.

The OAuth token is used for Home Coach, homes and room-status reads. If only
`ACCESS_TOKEN` is configured, the service logs an access-token-only warning:
it cannot recover automatically when that token expires. To enable the
optional refresh attempt, provide `REFRESH_TOKEN`, `CLIENT_ID` and
`CLIENT_SECRET` together. For a GET, the service can refresh once per cycle
after HTTP 401 or an explicit numeric API error code 2 (invalid access token)
or 3 (expired access token). Explicit numeric code 13 suppresses refresh even
on HTTP 401; for other HTTP statuses, only explicit code 2 or 3 triggers it.
Malformed, missing or unrelated response bodies do not trigger a refresh on
their own. If refresh succeeds, the original GET is retried once. Writes are
never replayed during OAuth recovery. A rotated refresh token is held in memory
and is not written back to a file. After restart, provide a still-valid
provisioned refresh token. The service does not provide durable refresh-token
rotation or recovery. The meanings of codes 2, 3 and 13 follow Netatmo's
official PHP SDK definitions; OAuth recovery has not been runtime-tested for
this service.

Calibration uses a separate direct Netatmo web login with
`NETATMO_USERNAME` and `NETATMO_PASSWORD`. Cookies and its access token remain
in memory. The existing password-login allowance is shared by all mappings and
allows at most one attempt per synchronization cycle, including an initial
login or recovery login. Separately, at most one pre-write recovery sequence is
available per cycle; it does not reset or bypass the shared login allowance.
The ordinary flow remains: a later mapping can use an unused login allowance
under existing rules, and an invalidated session can be tried again in a later
scheduled cycle.

For the current mapping, same-cycle recovery is considered only when the
read-only `homesdata` verification performed before its first calibration POST
returns a completed response with parsed JSON that fails verification and has
HTTP 401 or the adapter's explicit invalid/expired token or session message.
Numeric error codes 2 or 3 alone do not trigger this web-session recovery.
Numeric API code 13 vetoes recovery even if the status or message would
otherwise qualify; generic HTTP 403 without an explicit invalid/expired
message also does not trigger it. HTTP 429, HTTP 5xx, redirects, transport
failures, malformed JSON, and structural failures without a qualifying
authentication signal do not recover. These exclusions take precedence over
message matching.

When the recovery sequence and shared password-login allowances are available,
the rejected token and its verification cache are invalidated, the existing
login flow is attempted once, and the replacement token is verified once. A
failed login or replacement verification ends that recovery attempt; it does
not loop. If the login allowance was already consumed, no recovery login
starts, though a qualifying rejection still invalidates the cached token for
later scheduled recovery. After successful verification, cancellation and the
existing source-reading freshness check run again immediately before the
single possible calibration POST. If cancelled or stale, no POST is sent.
Recovery never replays a POST that was already dispatched. POST failures,
including HTTP 401/403 or an expiry-looking response, keep their existing
outcome and invalidation behavior and do not enter this recovery path. The
later ordinary cycle rereads target status before considering another write.

The `netatmo.web_auth.prewrite_recovery.started`, `.succeeded` and `.failed`
DEBUG events describe the bounded recovery sequence: `started` means an
eligible recovery login is actually beginning, `succeeded` means the
replacement token passed verification, and `failed` means that started attempt
did not complete. They do not report calibration success. Cases where recovery
does not start are covered by the existing verification/login diagnostics.
Netatmo's current web-login flow was observed during planning, not exercised by
implementation acceptance. MFA, CAPTCHA or other changed login challenges are
unsupported: the service stops the login attempt and does not bypass them.
Changes to the undocumented flow can require a code update.

Authentication diagnostics use events under `netatmo.web_auth.*` to identify
login-cycle reuse and progress through the login page, CSRF, password submission,
keychain, token extraction and session verification stages. Calibration request
diagnostics use `netatmo.calibration_write.*`. Compare the stage events with
`sync.mapping.*` outcomes: a calibration-write start means the temperature-setting
request was attempted; its success event records an accepted API response, not
physical heating behavior. Existing `ERR_NETWORK` mapping outcomes remain a
generic service classification and do not by themselves identify a network
failure. Diagnostics contain bounded stage, outcome, safe error category and
HTTP status fields only. A rejected redirect additionally records a fixed
rejection reason and, when it is a credential-free ASCII DNS hostname, that
hostname alone. Paths, query strings, URL credentials, cookies, tokens and
response bodies are not logged. These diagnostics add no session persistence;
the bounded pre-write recovery behavior is described above.

Set `LOG_LEVEL=debug` to emit these authentication and calibration diagnostics.
The default is `info`, which hides debug events while retaining informational,
warning and error records. Supported levels are `debug`, `info`, `warn` and
`error`; an unset or unrecognized value uses `info`.

## Keep credentials private

The checked-in `.env.example` contains placeholders only. Create a private
local environment file only if absent, then edit it locally:

```sh
cp -n .env.example .env.local
chmod 600 .env.local
```

Never replace an existing private file with the example. Keep real credentials
out of JSON config, source, shell history, command arguments, logs, images and
CI. `.env.local` and `config.json` are ignored by Git; verify their contents
and permissions on your host. Do not paste real values into commands below.

## Local use

Install the locked dependencies with Node.js 24:

```sh
npm ci
```

Create or review `config.json` as described above. Put the required values in
`.env.local`, then start the service:

```sh
npm run start:local
```

This uses Node's `--env-file-if-exists=.env.local`; variables already present
in the process environment take precedence over file values. The service
starts one cycle immediately, then waits after each completed cycle. It does
not overlap cycles. Run only one service instance for a given configuration;
distributed locking is not implemented.

For development, `npm run dev` watches and runs `src/main.ts` through `tsx`,
but does not load `.env.local`; provide environment variables through your
shell or another local process manager. To start the compiled application
directly, first run `npm run build`, then `npm start`. The `start:local` command
also builds before starting and loads `.env.local` when that file exists.
`npm run check` runs lint and strict source/test type-checking without emitting
files; `npm test` runs the domain and application business-rule unit suite.

## Reading checks and calibration limits

The Home Coach source must have a finite temperature and valid timestamp. By
default, readings older than 15 minutes are skipped; timestamps more than 60
seconds in the future are also skipped. These age checks apply to the Home
Coach source. The target room temperature is fetched from a new `homestatus`
response during the current cycle; receiving that HTTP response does not prove
the underlying sensor sample itself is fresh because the service does not
validate a target-sensor timestamp.

The source and current target values are rounded to one decimal Celsius. Equal
rounded values are a no-op. `MAX_CORRECTION_C` caps the absolute signed
difference for each write; its default is 5°C and configured values may use
positive finite decimal increments of 0.1°C. For example, with the default cap,
a room at 18°C and source at 25°C produces a 23°C candidate, while a room at
25°C and source at 18°C produces a 20°C candidate. A configured cap of 2.5°C
would bound those candidates to 20.5°C and 22.5°C, respectively. The payload
uses the current room measurement and the bounded candidate. Only HTTP 406
with API code 7 and the
exact `Nothing to modify` message is classified as a no-op; other 406 or code
7 responses are not success. A write counts as updated only for a valid
success response. A malformed or unexpected response, timeout, connection
loss or server error can have an indeterminate result; the service does not
replay that write. It waits for the next ordinary cycle, which rereads status.

After a successful write, the service saves the normalized room temperature
observed before that write, keyed by resolved home and room IDs. This comparison
value prevents another correction while Netatmo still reports the same room
temperature. The default retry threshold is two valid unchanged room readings,
counted at most once per synchronization cycle. At the default five-minute
interval, the first such reading is held and a write can become eligible on the
second, roughly ten minutes after the original write, subject to cycle duration
and any rate-limit delay. Set `CALIBRATION_RETRY_UNCHANGED_CYCLES` to a positive
integer to change the threshold. A changed valid room temperature releases the
guard in that cycle; missing or invalid room readings neither advance nor
release it. Another successful correction resets the count. Reaching the
threshold only permits an attempt if the usual checks pass; it does not prove
the earlier write failed.

An indeterminate POST timeout is handled separately: the service retains the
pre-write comparison in memory until the next ordinary cycle with a valid room
reading. It then reevaluates the current readings and may make a fresh eligible
write whether the room value is unchanged or changed. A later write can apply
an additional correction even if the timed-out request took effect after the
room status was read. Timeout comparison state is not persisted and is lost on
restart.

The state file is loaded and validated at startup; if absent, an empty state
file is created. Invalid or unreadable state, or inability to create it, stops
startup before calibration. The file contains only home and room identifiers
and their last successful write's normalized pre-write temperature. On restart,
the saved value is restored with its unchanged-cycle counter reset to zero; the
last successful record remains on disk when an observed room change releases
the in-memory guard. The service atomically replaces the file after successful
writes. If Netatmo accepts a write but saving fails, the mapping remains
`updated` with reason `calibration_state_save_failed`; the in-memory guard is
kept, and further writes are held until saving the pending state succeeds.
There is a crash window between provider acceptance and local save in which the
latest successful write may be absent from disk. Run one service instance per
configuration.

## Logs, errors and recovery

Logs are structured JSON with allowlisted fields: fixed event/outcome names,
cycle and mapping names, relevant temperatures and sanitized error codes.
Credentials, cookies, authorization headers, token responses,
credential-bearing URLs and raw authentication bodies are excluded.

- `startup_failed`: inspect the fixed outcome, required environment variables,
  JSON syntax/schema, positive integer settings, and the calibration state
  file's path, permissions and contents. Correct local config or state storage
  and restart; invalid startup never starts calibration.
- `source_not_found`, `source_ambiguous`, stale/invalid source, or target
  discovery/status outcomes: check exact configured names and device/room
  availability. Independent mappings continue when possible.
- `dry_run`: review the intended mapping and values. Set `DRY_RUN=false` only
  when a calibration write is deliberately intended.
- A mapping reports `awaiting_room_temperature_change` when the room still
  reports its pre-write temperature below the configured unchanged-cycle
  threshold, or when an earlier mapping to the same room timed out in this
  cycle. The service reevaluates the room on a later cycle.
- A mapping can report `updated` with reason `calibration_state_save_failed`
  when Netatmo accepted the write but local persistence failed. The process
  retains the guard and holds further writes while it retries saving the file.
- Access-token-only warning or OAuth refresh diagnostics: reprovision valid
  OAuth credentials; a complete refresh credential trio enables one GET
  refresh attempt per cycle for HTTP 401 or explicit API code 2/3. Code 13
  suppresses refresh, and writes are never replayed. After restart, supply a
  still-valid refresh token.
- Invalid/expired web session: the service may reauthenticate once during
  that cycle. Login challenges are not bypassed; if the web flow changed,
  update the supported service before relying on calibration.
- Rate limiting (HTTP 429): remaining API work stops for that cycle. The next
  cycle waits at least the greater of the normal interval and a valid
  `Retry-After` delay.
- Indeterminate calibration: do not assume the write failed or succeeded. Do
  not replay it manually from logs; allow the next cycle to fetch a new target
  reading and assess the current difference.
- SIGINT or SIGTERM stops future cycles, aborts bounded in-flight work and
  exits without starting another write.

## Docker

Build locally from the project root:

```sh
docker --context default build --tag netatmo-homecoach:local .
```

`--context default` selects the local Docker daemon, even if another context is
configured as the host default. The Dockerfile uses the same digest-pinned
Node 24.21 Alpine base for builder and runtime stages. It compiles the
TypeScript application in the builder, then packages the compiled `dist/`
output with locked production dependencies. The image runs as non-root UID
1000 (`node`) and starts `node dist/main.js` in the foreground. It contains no
runtime configuration or credentials. Calibration state must be kept in a
writable persistent host directory so it survives container replacement.

After creating and reviewing private `.env.local` and `config.json`, start
with the environment file and a read-only config bind mount:

```sh
docker --context default run --rm \
  --env-file .env.local \
  --env CONFIG_FILE=/app/config.json \
  --env CALIBRATION_STATE_FILE=/var/lib/netatmo/calibration-state.json \
  --mount "type=bind,src=$PWD/config.json,dst=/app/config.json,readonly" \
  --mount "type=bind,src=$PWD/calibration-data,dst=/var/lib/netatmo" \
  netatmo-homecoach:local
```

The image does not copy the host environment file. Supply credentials only at
container runtime; do not place them in Docker build arguments, image layers,
or command-line values. Ensure the host config file is readable by UID 1000 and
the host `calibration-data` directory exists and is writable by UID 1000; set
its ownership for the container's runtime user before starting. The state path
must point inside that mounted directory. Custom `CALIBRATION_STATE_FILE`
paths also require an explicit writable mount in a container. Run one
container for each configuration.

## CI and local checks

GitHub Actions validation runs on pull requests and pushes to `main` and
`feature/netatmo-homecoach-true-temperature`. It installs locked dependencies,
runs ESLint and strict source/test type-checking, runs the domain and
application business-rule unit cases, and compiles the application. These tests
do not exercise infrastructure, authentication, HTTP, scheduling or container
execution. Validation uses no Netatmo account credentials and makes no live API
calls. Ordinary CI does not build or publish a container image and does not
deploy the service.

The local equivalents are:

```sh
npm run check
npm test
npm run build
```

These checks do not satisfy live A5 acceptance or demonstrate physical
heating behavior.

## Forgejo image publishing

The separate `.github/workflows/publish-docker-images.yml` workflow runs only
for non-deleted Git tag push events. It checks out the tagged commit, validates
the tag before dependency installation or registry login, then runs `npm ci`,
`npm run check`, `npm test`, and `npm run build` before building or pushing. It does not run for
pull requests, branch pushes (including `main`), or manual dispatch. It does
not create release tags or deploy the service.

The Git tag determines the image version; it does not need to match
`package.json`'s version. Tags must be lowercase Docker-compatible values
matching `^[a-z0-9_][a-z0-9._-]*$`. The reserved tag `latest` is rejected, and
the tag with the `-node24-alpine` suffix must fit Docker's 128-character
tag limit. The workflow builds for native `linux/arm64` on an ARM64 runner and
uses the repository's pinned Alpine base image. It publishes:

```text
forgejo.alexlab.nl/alexlab/netatmo-home-coach-control-integration:<tag>-node24-alpine
forgejo.alexlab.nl/alexlab/netatmo-home-coach-control-integration:latest-node24-alpine
```

The moving `latest-node24-alpine` alias is pushed alongside each
versioned image. Its name does not guarantee version ordering or immutability.
The workflow checks that both push receipts report the same valid image digest
and records image references and digests in the job summary. It inspects image
architecture metadata but does not run the image or perform a container smoke
test. Registry credentials are used only by the publishing workflow, and
temporary Docker credentials are logged out and removed after the job.

Repository secrets `FORGEJO_REGISTRY_USERNAME` and `FORGEJO_REGISTRY_TOKEN`
must be configured with permission to push to the `alexlab` namespace on
`forgejo.alexlab.nl`. Never place secret values in source, commands, or logs.
Publication has not been performed: it requires those credentials and a
selected, authorized release tag pointing at a commit that contains the
publisher workflow. The workflow itself neither creates that tag nor grants
deployment authority. Live calibration acceptance A5 also remains pending.
