# NETATMO-004 — Debug temperature observations

Status: Approved
Date: 2026-11-19
Approval: Explicit user approval on 2026-11-19 ("approve") of this complete specification.

## Purpose and authority

Make the existing Home Coach-to-room calibration observable before changing its policy. The user has communal heating with Netatmo valves, wants to preserve the Netatmo schedule, and reports that the current calibration improves room comfort compared with manual adjustment. Radiator-local bias and measurement lag are reported concerns; their causes and magnitude have not been independently measured.

Origin: the user accepted the observation-first approach with “sounds good. hide them under debug log”. This selects diagnostics-only scope; it is not approval of this complete specification or authority to implement or deploy. A subsequent request authorizes a new branch and beta tag; release target and timing are a separate delivery decision, not evidence of implemented diagnostics.

## Baseline and preserved predecessors

Research baseline: `e881b3c0dea4906d2711657bedd55b256b3b4ea5`. Planning began on `main`; at the user's explicit request the invoking checkout now uses `feat/netatmo-calibration-observations`. Preserve unrelated `.idea/` and private configuration.

Read-only predecessors: [NETATMO-001-SPEC.md](NETATMO-001-SPEC.md) and [NETATMO-001-PLAN.md](NETATMO-001-PLAN.md), including their amendments; [NETATMO-002-SPEC.md](NETATMO-002-SPEC.md) and [NETATMO-002-PLAN.md](NETATMO-002-PLAN.md); [NETATMO-003-SPEC.md](NETATMO-003-SPEC.md) and [NETATMO-003-PLAN.md](NETATMO-003-PLAN.md). Add application temperature observations without revising these artifacts, their approvals, authentication diagnostics, health semantics, or calibration behavior.

## Evidence and constraints

- `CalibrationPolicy` rounds source and target to 0.1°C, skips equality and differences above 5°C, and otherwise permits calibration unless dry-run applies.
- `TemperatureSynchronizationService` already emits final mapping outcomes with normalized temperatures and correlation identifiers. It reads Home Coach sample timestamps and current room status; it does not establish underlying valve-sample freshness.
- `StructuredLogger` already supports `LOG_LEVEL=debug`, defaults to `info`, and filters fields through an allowlist. New diagnostics must use that mechanism.
- The service's True Temperature path is calibration, not a documented Home Coach sensor binding. Neither the 0.5°C valve display nor successful API responses establish internal regulation precision or physical behavior.

## Scope and exclusions

Add one structured DEBUG observation for each mapping that reaches calibration-policy evaluation with valid finite source and target readings. Document how to compare observations with existing outcome events over time.

Exclude policy changes, deadbands, smoothing, cooldowns, new timing or freshness rules, sensor binding, setpoint/schedule/mode commands, valve-position control, extra API calls, dashboards, persistent history, new runtime settings, deployment and live heating experiments. No claim of improved regulation is an acceptance criterion for this observational change.

## Definitions and behavior

R1. Use event `sync.mapping.temperature_observation` with explicit level `debug`. Default `info`, `warn` and `error` hide this new event. Existing mapping, authentication and error logs keep their current level and content; the request to hide diagnostics does not hide existing operational outcomes.

R2. Emit at most one observation per mapping per cycle, immediately after the existing calibration decision is calculated and before its no-op/skip/write branch. Earlier exits for missing, invalid, stale or unreachable data retain their existing outcome events and do not manufacture an observation. The existing final freshness check may still prevent a write; the observation records evaluation, not authorization or dispatch.

R3. Include existing cycle and mapping correlation fields and the following finite numeric values:

| Field | Meaning |
| --- | --- |
| `sourceTemperature` | Existing 0.1°C-normalized Home Coach reference |
| `currentTemperature` | Existing 0.1°C-normalized room measurement |
| `correctedTemperature` | Existing proposed normalized calibration reference |
| `rawSourceTemperature` | Finite source value before service rounding |
| `rawCurrentTemperature` | Finite room value before service rounding |
| `temperatureDifference` | Normalized reference minus normalized room measurement, rounded to 0.1°C; positive means the reference is warmer |
| `sourceTimestamp` | Home Coach sample timestamp in Unix seconds |
| `sourceAgeSeconds` | Observation time minus source timestamp in seconds; a small negative value remains possible under the preserved clock-skew allowance |

Include `outcome` equal to the existing policy decision (`write`, `no-op`, or `skipped`). This is a proposed action, not the final mapping result. Do not add setpoint or operating-mode fields: their response contracts have not been verified for this service. The observations compare the two measurements; they do not establish deviation from a scheduled target.

R4. Use the existing log timestamp as observation time and correlate with existing final `sync.mapping.*` outcomes by cycle and mapping. An observation with `outcome: write` does not prove dispatch, acceptance, application, valve movement or comfort. Repeated source timestamps identify reuse of a sample, not necessarily a fault. Do not add previous-sample state, last-write tracking, elapsed-since-write estimates or inferred valve state.

R5. Extend the logger's field allowlist narrowly for these fields. New numeric fields must reject nonnumeric/nonfinite values. Log only the named fields, existing bounded correlation names, fixed event/outcome values and existing sanitized outcomes. Never log whole room/source objects, raw responses, account/device IDs, URLs, credentials, tokens, cookies, headers or arbitrary API strings. Preserve all existing authentication redaction boundaries.

R6. Diagnostics are best effort. A logger/sink failure must not change decisions, results, request ordering or execution. Domain rules remain pure. No extra network request, write retry, sample suppression or calibration decision is introduced by logging. No DEBUG-only side effect may alter calibration.

## Regression boundaries

Preserve exact mapping resolution, source freshness checks, serial scheduling, configured/default intervals, 0.1°C rounding, equality no-op, 5°C guard, dry-run, cancellation, rate limits, authentication budgets, pre-write recovery, no immediate POST replay, shutdown, health and private configuration. Keep Netatmo's existing schedule untouched. Do not claim to know the valve's internal measurement precision or physical opening state.

## Acceptance and validation

- A1: Static inspection establishes the event count, placement, field definitions, finite-number guards and DEBUG gating. At `info`, the new observations are filtered; existing operational events remain as before.
- A2: Existing domain/application business tests continue to pass. Necessary application-service business regressions may demonstrate preserved decisions, write counts, dry-run and failure isolation using injected gateway/clock/logger. Do not add infrastructure, logger-output, HTTP, authentication, scheduling, configuration, container or startup tests, or inline probes as substitutes. Inspect logging-specific behavior statically under the repository's business-only test rule.
- A3: Run documented `npm run check`, `npm test`, and `npm run build` under Node 24 with locked dependencies installed as needed. These establish source/business/build evidence, not live heating behavior.
- A4: Review confirms no extra API calls, control commands, calibration-policy changes, sensitive payload logging or mutation of predecessor artifacts/private files.
- A5: Update `docs/operations.md` with enabling `LOG_LEVEL=debug`, event/field meanings, signed-difference example, interpretation alongside final outcomes, source-sample reuse, unknown target-sample freshness, and the absence of scheduled-target or valve-position evidence. Explain that normal info-level logging is preserved and that this change gathers evidence before any future policy revision.
- A6: No live data collection, calibration, deployment, publication or physical-temperature test is required or authorized by this diagnostics specification. Any later runtime observation must be separately authorized. Lack of physical evidence must be disclosed, never represented as successful regulation validation.

## Approval record

Approved by the user on 2026-11-19 with "approve" in response to the complete Proposed specification. Approval covers DEBUG-only observations and preserved calibration behavior. It does not authorize implementation in this planning-only session or decide the pending beta release target. No implementation PLAN has been authored or approved for NETATMO-004.
