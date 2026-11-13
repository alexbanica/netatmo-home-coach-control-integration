# NETATMO-001 — Home Coach to room True Temperature service

Status: Approved
Date: 2026-11-13
Approval: Explicit user approval on 2026-11-13 ("approve"), including the feature-branch/separate-worktree delivery constraint.

## Purpose and authority

Create a Node.js background service that periodically uses a Netatmo Home Coach temperature as the reference for a configured Netatmo heating room's True Temperature calibration. Origin: the user's spec-plan request and subsequent direction to use direct HTTP calls without the unofficial client, plus Dockerfile, GitHub Actions and documentation. This is planning only; neither implementation nor live rollout is authorized by this document.

This is the first specification in this repository; no earlier approved artifacts are changed. The repository initially contains README, LICENSE and gitignore, with no service implementation. Preserve unrelated `.idea/` content and private environment files.

Delivery constraint from the user: implementation must take place on a dedicated feature branch in a separate Git worktree, not on main or in the invoking checkout. Planning artifacts remain in the invoking checkout during spec-plan. The PLAN must define the exact feature branch, verified base policy and worktree path; the later implement session owns worktree preparation. Do not copy credentials into tracked files or disturb unrelated work when preparing that workspace.

## Evidence and limits

Observed in this conversation on 2026-11-13:

- OAuth reads of `gethomecoachsdata`, `homesdata`, and `homestatus` succeeded (HTTP 200).
- `POST https://app.netatmo.net/api/truetemperature` exists: an empty request returned missing-token error, while a nonexistent route returned 404.
- The supplied developer OAuth token returned HTTP 403 / code 13 / Operation is forbidden for the tested calibration request. This does not prove all OAuth tokens are incompatible.
- Direct web login through `auth.netatmo.com` obtained a cookie-derived access token. With that token, a request for Nederland Home / Kai’s Room using 22°C as both current and corrected temperature returned HTTP 406 / code 7 / Nothing to modify.
- Therefore web-session access reached calibration validation; a successful nonzero calibration and physical heating response remain unverified. No nonzero write was performed.

True Temperature is sensor calibration, not a heating setpoint or a supported external-sensor binding. The app endpoint and web-login flow are undocumented and can change. The service must not claim that five-minute calibration is vendor-supported or that valves will physically respond correctly without evidence.

Sources:
- https://dev.netatmo.com/apidocumentation/energy
- https://helpcenter.netatmo.com/hc/en-us/articles/360021158691-How-to-calibrate-the-temperature-sensor
- https://github.com/py-netatmo-unofficial/py-netatmo-truetemp (research evidence only; not a runtime dependency)

## Scope and exclusions

Deliver the Node service, automated tests, Dockerfile and .dockerignore, GitHub Actions validation, example environment/config files, and maintained README/operations documentation. Use direct HTTPS calls; do not install or invoke the unofficial True Temperature client.

Exclude setpoint changes, schedule/mode changes, heating-control algorithms, valve pairing, dashboards/public HTTP APIs, deployment, registry publication, release automation, credential acquisition UI, and installation on a live host. The service calibrates configured rooms; it does not command individual valves independently of room membership. No password, token, home ID or room ID from the user's account is committed.

## Configuration and definitions

- A mapping explicitly identifies one Home Coach device by its exact device name and one heating home/room by exact names. Names are case-sensitive and Unicode-preserving. No fuzzy matching or implicit same-name selection across homes.
- JSON configuration contains a nonempty `mappings` array of `{sourceDeviceName, targetHomeName, targetRoomName}` records. One source may feed multiple rooms; each target home/room pair may appear only once. Missing or ambiguous discovery results prevent writes for that mapping and produce a diagnostic.
- All connection credentials and runtime settings come from environment variables; names and mappings live only in JSON. Use `CONFIG_FILE` (default `./config.json`) to locate that file.
- OAuth read credentials: `ACCESS_TOKEN`, with `REFRESH_TOKEN`, `CLIENT_ID`, and `CLIENT_SECRET` required together to enable automatic refresh. An access-token-only mode is valid but cannot recover after expiry; report that limitation. Never infer a client secret from other credentials.
- True Temperature authentication: `NETATMO_USERNAME` and `NETATMO_PASSWORD`. Obtain a web-session token directly; retain session cookies/tokens only in memory. Do not require browser cookie extraction or persist web sessions.
- `SYNC_INTERVAL_MINUTES` defaults to 5 and must be a positive integer. Run one cycle at startup, then wait that many minutes after each completed cycle. Never overlap cycles.
- `MAX_READING_AGE_MINUTES` defaults to 15 and must be a positive integer; it is independent of the sync interval. Stale Home Coach samples cannot drive calibration.
- `DRY_RUN` defaults to false; when true, perform reads and report intended adjustments without True Temperature writes. Accept only explicit true/false values.
- Local development can load `.env.local` explicitly using the documented launch command. Process environment takes precedence. Containers receive environment variables at runtime; no environment file is baked into an image.
- Configuration is read at startup; changes require restart. Invalid syntax, duplicate targets or missing required credentials cause a nonzero startup exit before any calibration write.

## Synchronization behavior and invariants

1. Discover Home Coach devices and heating homes/rooms; resolve each configured mapping uniquely. Obtain source temperatures and timestamps from Home Coach and target measured temperatures from fresh room status responses during each cycle. Do not use a previously successful cycle's target reading for a new write.
2. Reject missing, nonnumeric or nonfinite temperatures; missing/invalid timestamps; future timestamps more than one minute ahead; source samples older than the configured age; and unavailable/unreachable target rooms. Skip the affected mapping, report the reason and continue independent mappings. Discovery ambiguity never selects an arbitrary device.
3. Normalize source/reference and measured target temperatures to one decimal Celsius. If equal, report a no-op without posting. Do not compare only against the last submitted source value: compare to the current target measurement.
4. If the absolute difference between corrected/reference and current target temperature exceeds 5°C, skip and report it; do not clamp or split a larger correction into multiple writes. This is a conservative per-request guard, not proof of the undocumented endpoint's total calibration constraints.
5. Otherwise call `POST https://app.netatmo.net/api/truetemperature` with JSON `{home_id, room_id, current_temperature, corrected_temperature}`, where current is the fresh target measurement and corrected is the Home Coach reading, authenticated with the web-session Bearer token.
6. Treat HTTP 406 with API code 7 and the specific Nothing to modify response as a no-op. Do not treat all 406s or all API code 7 responses as successful. Record an accepted write only when a non-error, valid JSON response indicates success; malformed or unexpected success responses are indeterminate and must not be reported as confirmed calibration.
7. Never automatically retry a calibration POST after timeout, connection loss or server error: it may already have applied. Report indeterminate outcome and wait for the next ordinary cycle, which must re-read target status before considering a new request. Do not immediately replay writes following reauthentication.
8. Expired read tokens may be refreshed once per cycle when the refresh credentials are present. Use a returned rotated refresh token in memory and never rewrite `.env.local`. Document that restarting requires a still-valid provisioned refresh token; do not claim durable refresh recovery. Missing client credentials or refresh rejection produces a clear recoverable diagnostic rather than unbounded retries.
9. Reuse the web session in memory. Reauthenticate at most once per cycle after an explicit expired/invalid session response, with no immediate write replay. MFA, CAPTCHA or changed login flow must stop that login attempt; never bypass challenges. Resume on a later scheduled cycle without a tight retry loop.
10. Use bounded HTTPS request timeouts of 25 seconds. Enforce TLS validation. Credentials go only to the appropriate Netatmo HTTPS hosts; reject unexpected redirect hosts. Rate-limit responses halt remaining API work for that cycle and postpone the next cycle until at least any valid Retry-After delay and the normal configured delay have passed. No concurrent per-room writes.
11. SIGINT/SIGTERM cancels future cycles, bounds in-flight network work and exits cleanly without starting another write. One service instance per configuration is the documented operating model; distributed locking is excluded.
12. Emit structured logs with cycle and mapping outcomes (updated/no-op/skipped/failed/indeterminate), names, relevant temperature values and sanitized error codes. Never log credentials, cookies, authorization headers, token responses, credential-bearing URLs or raw authentication bodies. API acceptance is not evidence of a physical valve response.

## Docker and GitHub Actions

- Provide a reproducible dependency-locked Node.js image, running as a non-root user, with a documented foreground entry point and graceful signal handling. Exclude `.env*` (except safe examples), private config, `.git`, `.idea`, dependencies and other local artifacts from the build context as appropriate. Examples contain placeholders, never account data.
- Document `docker build` and `docker run --env-file ...` with a read-only configuration bind mount; credentials are supplied at runtime. A writable application state volume is not required.
- GitHub Actions runs on pull requests and pushes to main, with minimal read-only repository permissions. Install locked dependencies, run static checks and automated tests, then build the Docker image. Exercise container startup/config validation without Netatmo credentials or live API calls.
- CI must work without account secrets and must never log credentials. No image push, registry credentials, automatic deploy or release is included.

## Acceptance and validation

A1. Configuration tests cover default/custom intervals, invalid settings, explicit source/target mapping, duplicate targets, ambiguity and absent credentials. No invalid startup can write.

A2. Mocked HTTP contract tests cover Home Coach reads, room reads, direct web login, OAuth refresh, expected True Temperature payload and authentication separation. Test challenges, expired sessions and redaction of secrets. Do not perform real login in CI.

A3. Synchronization tests cover fresh/stale/missing/future readings, offline rooms, rounding, equal-value no-op, greater-than-5°C skip, exact Nothing-to-modify classification, malformed responses, partial mapping failures, rate limits and indeterminate writes. No immediate POST replay is permitted.

A4. Scheduler tests verify startup execution, configured delay, non-overlap and graceful shutdown. Container validation verifies non-root execution, startup/config errors, no bundled secrets and signal handling. GitHub Actions must run the documented deterministic checks and container build.

A5. Live acceptance is separate and requires explicit authorization for the selected mapping and nonzero correction. Capture source and target readings, sanitized response, and subsequent room/app evidence. A zero-adjustment 406 does not satisfy this criterion. Any physical-response claim requires actual observed evidence; this specification authorizes no unattended live calibration test or restoration experiment. If required live validation is unavailable, retain DRAFT delivery and identify the missing evidence.

A6. README and operational documentation explain configuration schema; OAuth permission/token provisioning and refresh limitations; web-login dependency; five-minute default and stale-data policy; Docker usage; CI; dry-run; errors/recovery; secret handling; and the distinction between calibration, setpoints and physical heating behavior. All example commands work with placeholders and never require credentials in command arguments.

## Regression and preserved behavior

No existing service behavior exists to preserve. Preserve LICENSE, private `.env.local` and unrelated IDE files. Assert no setpoint/schedule/mode endpoints are called, no unintended room is selected, no unofficial client dependency is added, and no CI or container layer receives user secrets. No planning or implementation action implies deployment authority.

## Approval record

Approved by the user on 2026-11-13 with "approve" in response to the updated complete specification. Approval includes direct web authentication, calibration limitations, configuration defaults, CI/build-only scope, live acceptance boundary and feature-branch/separate-worktree delivery constraint.

## Amendment 1 — 2026-11-13 — Business-only tests and Forgejo image publication

- Amendment ID: NETATMO-001-SPEC-A1
- Previous version: original approved SPEC
- Approval: Automatically approved under the originating implement request and explicit user scope instructions
- Request and purpose: User instructed "should not have infrastructure tests - containers. unit tests should be done only on business logic", then "should use forgejo integration as other nodejs projects to publish the docker image".

### Changes against the previous version

| Section / requirement | Before | After | Reason |
| --- | --- | --- | --- |
| Scope/exclusions; Docker and GitHub Actions | Registry publication and release automation excluded; CI builds and smoke-tests containers | Add tag-triggered GitHub Actions publication to Forgejo; ordinary CI performs static checks and business unit tests only | Explicit publication request and infrastructure-test exclusion |
| A1–A4 validation | Configuration, transport/authentication, service/scheduler, container and integration tests required | Unit tests exercise mapping and calibration business rules using injected clients and clocks. Remove infrastructure, HTTP/authentication, scheduler/startup/logging and container tests, fixtures and smoke commands. Do not rerun or require those excluded tests | Exact user test-scope instruction overrides prior validation obligations |
| Docker publication contract | Build-only Docker support | Publish linux/arm64 images to forgejo.alexlab.nl/alexlab/netatmo-home-coach-control-integration on a non-deleted tag push. Tags are <git-tag>-node24-bookworm-slim and latest-node24-bookworm-slim | Current still-good-api and service-availability-scheduler local workflow conventions |

### Preserved behavior and impact

Runtime behavior, all calibration/authentication safety controls, exact mappings, dry-run, Dockerfile's pinned Node 24.21.0 bookworm-slim base, and live A5 authority remain unchanged. The changed acceptance scope omits infrastructure-test evidence; earlier test runs are historical evidence, not current acceptance requirements. A5 still requires separately authorized nonzero calibration and subsequent room/app evidence. No deployment, main merge, release-tag creation, or immediate registry mutation is authorized merely by configuring the workflow.

The publisher checks out the exact tagged commit without persisted Git credentials, validates lowercase Docker tag syntax and the 128-character suffixed-tag limit before credentials, runs locked installation/static checks/business units, and builds on a native ARM64 runner. It authenticates only to forgejo.alexlab.nl using GitHub Actions secrets FORGEJO_REGISTRY_USERNAME and FORGEJO_REGISTRY_TOKEN, pushes the versioned and moving tags, verifies matching published digests, and always logs out/cleans temporary Docker credentials. Build, image metadata and publication-receipt verification are delivery operations, not container runtime tests. Do not add container execution, smoke tests or infrastructure unit tests. Application credentials are never supplied to publication.

The Git tag defines the image version; no package.json equality gate is introduced because the inspected sibling Docker workflows have none. The workflow does not create tags or run on PR/feature-branch pushes. Actual publication remains pending a release tag and available registry credentials; repository-level secret-name inspection on 2026-11-13 returned none. No secret values were read.

### Approval record

NETATMO-001-SPEC-A1 is automatically approved on 2026-11-13 by the active implement amendment procedure, based on both exact user instructions above. Approval covers the complete effective SPEC, including this test-evidence reduction and bounded publishing addition; it does not claim the user manually reviewed this generated amendment. Corresponding PLAN amendment: NETATMO-001-PLAN-A2.

## Amendment 2 — 2026-11-13 — Reserve the moving image alias

- Amendment ID: NETATMO-001-SPEC-A2
- Previous version: NETATMO-001-SPEC-A1
- Approval: Automatically approved under the active implement request
- Request and purpose: Correct the supported medium finding from NETATMO-001-REVISED-CONTRACT: Git tag latest would collapse the versioned and moving image references into the same name.

### Changes against the previous version

| Section / requirement | Before | After | Reason |
| --- | --- | --- | --- |
| SPEC-A1 Docker tag validation | Lowercase Docker tag syntax and suffixed length limit | Same rules, plus reject the reserved Git tag latest before credentials or publication | Preserve separate versioned and moving references |

### Preserved behavior and impact

All other accepted release tags, image naming, pinned runtime base, ARM64 platform, credentials, receipts/cleanup, business-only test restriction and live A5 boundary remain unchanged. No new test category, tag creation, credential provisioning or registry mutation is authorized by this correction. The user has not supplied a release tag; no existing published artifact is changed. Corresponding PLAN revision: NETATMO-001-PLAN-A3.

### Approval record

On 2026-11-13 the active implement automatic amendment procedure authorizes the complete effective SPEC through NETATMO-001-SPEC-A2. This bounded correctness correction implements distinct release/latest naming and is not a claim of separate manual user approval.
