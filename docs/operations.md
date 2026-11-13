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
acceptance. This delivery remains DRAFT.

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
| `DRY_RUN` | No | `false`; only literal `true` or `false` is accepted. |

Malformed JSON, unknown keys, duplicate targets, invalid settings, incomplete
refresh credentials, or missing required credentials stop startup with a
nonzero exit before API or calibration work. Dry-run still requires all three
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
in memory. Login is attempted at most once per cycle and may be retried on a
later scheduled cycle after an explicit invalid/expired session response; a
write is never immediately replayed after reauthentication. Netatmo's current
web-login flow was observed during planning, not exercised by implementation
acceptance. MFA, CAPTCHA or other changed login challenges are unsupported:
the service stops the login attempt and does not bypass them. Changes to the
undocumented flow can require a code update.

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

## Reading checks and calibration limits

The Home Coach source must have a finite temperature and valid timestamp. By
default, readings older than 15 minutes are skipped; timestamps more than 60
seconds in the future are also skipped. These age checks apply to the Home
Coach source. The target room temperature is fetched from a new `homestatus`
response during the current cycle; receiving that HTTP response does not prove
the underlying sensor sample itself is fresh because the service does not
validate a target-sensor timestamp.

The source and current target values are rounded to one decimal Celsius. Equal
rounded values are a no-op. A difference greater than 5°C is skipped without
clamping or splitting. For an allowed correction the payload uses the current
room measurement and Home Coach value. Only HTTP 406 with API code 7 and the
exact `Nothing to modify` message is classified as a no-op; other 406 or code
7 responses are not success. A write counts as updated only for a valid
success response. A malformed or unexpected response, timeout, connection
loss or server error can have an indeterminate result; the service does not
retry that write. It waits for the next ordinary cycle, which rereads status.

## Logs, errors and recovery

Logs are structured JSON with allowlisted fields: fixed event/outcome names,
cycle and mapping names, relevant temperatures and sanitized error codes.
Credentials, cookies, authorization headers, token responses,
credential-bearing URLs and raw authentication bodies are excluded.

- `startup_failed`: inspect the fixed outcome, required environment variables,
  JSON syntax/schema, and positive integer settings. Correct local config and
  restart; invalid startup never starts calibration.
- `source_not_found`, `source_ambiguous`, stale/invalid source, or target
  discovery/status outcomes: check exact configured names and device/room
  availability. Independent mappings continue when possible.
- `dry_run`: review the intended mapping and values. Set `DRY_RUN=false` only
  when a calibration write is deliberately intended.
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
configured as the host default. The image uses the locked production
dependencies, runs as the non-root `node` user and starts `node src/index.js`
in the foreground. It contains no runtime configuration or credentials. No
writable application volume is needed.

After creating and reviewing private `.env.local` and `config.json`, start
with the environment file and a read-only config bind mount:

```sh
docker --context default run --rm \
  --env-file .env.local \
  --env CONFIG_FILE=/app/config.json \
  --mount "type=bind,src=$PWD/config.json,dst=/app/config.json,readonly" \
  netatmo-homecoach:local
```

The image does not copy the host environment file. Supply credentials only at
container runtime; do not place them in Docker build arguments, image layers,
or command-line values. Ensure the host config file is readable by the image's
non-root UID 1000. Run one container for each configuration.

## CI and local checks

GitHub Actions validation runs on pull requests and pushes to `main` and
`feature/netatmo-homecoach-true-temperature`. It installs locked dependencies,
runs the source check and the 12 business-rule unit cases. These tests do not
exercise infrastructure, authentication, HTTP, scheduling or container
execution. Validation uses no Netatmo account credentials and makes no live API
calls. Ordinary CI does not build or publish a container image and does not
deploy the service.

The same source and business unit checks are:

```sh
npm run check
npm test
```

These checks do not satisfy live A5 acceptance or demonstrate physical
heating behavior.

## Forgejo image publishing

The separate `.github/workflows/publish-docker-images.yml` workflow runs only
for non-deleted Git tag push events. It checks out the tagged commit, validates
the tag before dependency installation or registry login, then runs `npm ci`,
`npm run check`, and `npm test` before building or pushing. It does not run for
pull requests, branch pushes (including `main`), or manual dispatch. It does
not create release tags or deploy the service.

The Git tag determines the image version; it does not need to match
`package.json`'s version. Tags must be lowercase Docker-compatible values
matching `^[a-z0-9_][a-z0-9._-]*$`. The reserved tag `latest` is rejected, and
the tag with the `-node24-bookworm-slim` suffix must fit Docker's 128-character
tag limit. The workflow builds for native `linux/arm64` on an ARM64 runner and
uses the repository's pinned Bookworm-slim base image. It publishes:

```text
forgejo.alexlab.nl/alexlab/netatmo-home-coach-control-integration:<tag>-node24-bookworm-slim
forgejo.alexlab.nl/alexlab/netatmo-home-coach-control-integration:latest-node24-bookworm-slim
```

The moving `latest-node24-bookworm-slim` alias is pushed alongside each
versioned image. Its name does not guarantee version ordering or immutability.
The workflow checks that both push receipts report the same valid image digest
and records image references and digests in the job summary. It inspects image
architecture metadata but does not run the image or perform a container smoke
test. Registry credentials are used only by the publishing workflow, and
temporary Docker credentials are logged out and removed after the job.

Repository secrets `FORGEJO_REGISTRY_USERNAME` and `FORGEJO_REGISTRY_TOKEN`
must be configured with permission to push to the `alexlab` namespace on
`forgejo.alexlab.nl`. Never place secret values in source, commands, or logs.
This repository currently has no configured repository-level secret names.
Publication has not been performed: it requires those credentials and a
selected, authorized release tag pointing at a commit that contains the
publisher workflow. The workflow itself neither creates that tag nor grants
deployment authority. Live calibration acceptance A5 also remains pending.
