# NETATMO-002 — Local service health endpoint

Status: Approved
Date: 2026-11-13
Approval: Explicit user approval on 2026-11-13 ("approve") of this complete specification.

## Purpose and authority

Expose worker responsiveness and scheduler progress through a local HTTP endpoint so RpiInfrastructure can perform healthchecks. Origin: the user's `spec-plan healthcheck mechanism` request, confirmation of endpoint and worker-health semantics, confirmation of proposed settings, and subsequent instruction: "this should change/add only the endpoint and the service logic. The healthcheck should be done in the RpiInfrastructure".

This is planning only. The last instruction supersedes the earlier proposal to add a Docker HEALTHCHECK here. This repository supplies the endpoint and health state; RpiInfrastructure owns probe execution and probe timing. No cross-repository changes, probe deployment, release, publication or live calibration are authorized.

## Baseline and preserved artifacts

Research baseline: main at `5a4b8e77c541ea29d2ec1324565e7f58e6a95263`. The service has no inbound HTTP listener or health state. `src/main.ts` owns lifecycle; `src/AppFactory.ts` composes components; `SerialScheduler` runs one immediate cycle and waits after completion, including Retry-After backoff. Cycle outcomes distinguish calibration success, no-op, skips, failures and indeterminate writes.

Read-only predecessor references: [NETATMO-001-SPEC.md](NETATMO-001-SPEC.md), including amendments through SPEC-A2, and [NETATMO-001-PLAN.md](NETATMO-001-PLAN.md), including their effective amendments. Their content and approval remain unchanged. This new work adds a narrowly scoped local operational endpoint to the earlier exclusion of public HTTP APIs. Calibration rules, authentication, serial scheduling, retry/backoff and all business behavior remain preserved.

## Scope and exclusions

Production changes are limited to the endpoint, its startup/shutdown wiring and configuration, and service health state derived from scheduler lifecycle. Keep the composition root as the sole concrete wiring point and preserve inward dependency boundaries.

Exclude Dockerfile HEALTHCHECK, probe commands or scripts, Docker port publication, container runtime changes, CI/publisher changes, RpiInfrastructure changes, dashboards, public APIs, metrics, alerts, automatic restart, new calibration retries, durable health state and runtime/deployment actions. The previously discussed probe interval, timeout, failure count and startup grace belong to RpiInfrastructure and are not requirements implemented here.

## Definitions and confirmed decisions

- Worker health means that the HTTP event loop responds and the scheduler is running or waiting as expected. It does not establish successful calibration, valid credentials, fresh readings, availability of Netatmo, or physical heating response.
- An active cycle is one invocation of the existing synchronization use case, from scheduler invocation until resolution or rejection.
- A scheduled wait is the existing delay after a cycle, including the greater of the configured interval and valid Retry-After backoff.
- Expose `GET /healthz` on IPv4 loopback `127.0.0.1`, default port `8080`. The port is configurable; the bind address is not externally exposed by this feature.
- Configuration uses `HEALTHCHECK_PORT` (default `8080`, integer 1–65535) and `HEALTHCHECK_MAX_CYCLE_SECONDS` (default `600`, positive integer whose millisecond conversion is a safe integer). Configuration is read once at startup; invalid values fail startup before calibration begins.
- The active-cycle limit reports a stall; it does not cancel or retry the cycle. Operators with legitimately longer cycles can increase the limit.

## Behavior and invariants

H1. Validate startup configuration and successfully bind the listener before starting the first synchronization cycle. A bind failure produces a sanitized startup diagnostic and nonzero exit, without calibration writes. Preserve existing invalid-configuration behavior and protect private credentials and configuration.

H2. `GET /healthz` returns `Content-Type: application/json` and `Cache-Control: no-store`. Healthy response: HTTP 200 with exactly `{"status":"healthy"}`. Unhealthy response: HTTP 503 with exactly `{"status":"unhealthy"}`. Do not disclose mapping names, account identifiers, temperatures, errors, credentials or configuration in either body.

H3. Health starts unhealthy until the scheduler enters its running lifecycle. Once entered, an active cycle is healthy while elapsed time since its start is less than or equal to the configured limit, and unhealthy once that limit is exceeded. Measure durations monotonically so wall-clock adjustments cannot change stall classification. A responding listener alone must not conceal an overdue active cycle.

H4. Completed or rejected cycles reset the active-cycle state and enter the existing scheduled wait. All scheduled waits remain healthy, regardless of duration, including rate-limit backoff. The next cycle starts a new active-cycle deadline. Updated, no-op, skipped, failed and indeterminate outcomes do not themselves change health. Dry-run follows the same rules. Preserve immediate first execution, non-overlap, ordinary delays and network timeout behavior.

H5. An unexpectedly stopped scheduler is unhealthy while the endpoint remains available. On SIGINT/SIGTERM mark health unhealthy immediately, abort future scheduling and in-flight work using existing lifecycle behavior, and close the listener without allowing persistent HTTP connections to delay shutdown indefinitely. Requests accepted before listener closure observe the stopping state. A closed or unresponsive endpoint is a failed probe from the external checker's perspective.

H6. A later cycle completion can restore health from a reported stall without restarting. Health requests only read in-memory state: they never invoke Netatmo, load private configuration, trigger synchronization, mutate calibration state or alter scheduling. Repeated probes add no external API traffic.

H7. Unknown paths return HTTP 404; methods other than GET on `/healthz` return HTTP 405 with `Allow: GET`. These responses expose no internal details. Keep the operational surface minimal, without dependencies or persistence that lack a concrete need.

H8. Add no Docker HEALTHCHECK, probe runner, automatic restart, process exit on a stalled cycle, or listener exposure beyond loopback. A separate RpiInfrastructure change must arrange probing from the service's network namespace; this specification does not assume that a remote host can reach a loopback listener.

## Regression and validation

Acceptance criteria:

- A1: Static inspection confirms H1–H8, bounded startup/shutdown wiring and read-only endpoint behavior, including port conflicts, invalid settings, active-cycle boundaries, delayed recovery and unexpected scheduler termination.
- A2: Existing permitted checks pass with Node.js 24 and locked dependencies: `npm ci`, `npm run check`, `npm test`, `npm run build`. Retain the business-only domain/application suite. Do not introduce endpoint, HTTP, configuration, scheduler, startup, container or other infrastructure tests, or inline runtime probes as substitutes.
- A3: Review confirms unchanged calibration decisions, credential handling, request timeouts, serial execution, rate-limit backoff and signal cancellation. Health inspection cannot send calibration or authentication requests.
- A4: Change review confirms no Docker/CI/probe/RpiInfrastructure modifications and preservation of `.idea/`, private `.env.local`, `config.json`, predecessor artifacts and unrelated work.

Infrastructure runtime tests and live endpoint/container/probe execution are outside the permitted validation scope. Static checks and existing business tests do not prove runtime endpoint reachability or RpiInfrastructure integration; report that omitted evidence explicitly. Existing unrelated physical/live acceptance obligations are not newly triggered by this endpoint feature.

## Documentation and handoff

This specification is the endpoint contract and operational handoff: loopback address, port/default, environment settings, status bodies, health meaning, active-cycle timeout and network-namespace requirement are defined above. Consistent with the user's endpoint/service-only scope, no maintained README, operations, example configuration, Docker or RpiInfrastructure edits are included. The later PLAN must preserve this boundary and identify external probe integration as separate work, without treating it as delivered or making it a prerequisite for this repository's endpoint delivery.

## Approval record

Approved by the user on 2026-11-13 with "approve" in response to presentation of this complete SPEC. Approval covers endpoint/service logic only, with RpiInfrastructure owning external healthcheck execution. PLAN approval remains separate; no implementation is authorized in this planning session.
