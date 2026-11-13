# NETATMO-002 — Local service health endpoint implementation plan

Status: Approved
Date: 2026-11-13
Approval: Explicit user approval on 2026-11-13 ("approve") of this complete plan after readiness review and finding disposition.

## Authority, scope and baseline

Implement the approved [NETATMO-002-SPEC.md](NETATMO-002-SPEC.md), explicitly approved on 2026-11-13. The user limited production changes to the endpoint and service logic and assigned healthcheck execution to RpiInfrastructure. Follow the complete SPEC, including its exclusions. Preserve [NETATMO-001-SPEC.md](NETATMO-001-SPEC.md) and [NETATMO-001-PLAN.md](NETATMO-001-PLAN.md), with all amendments, unchanged. The delta is a loopback operational API and in-memory scheduler state; all existing calibration, authentication and scheduling policy remains unchanged.

Planning checkout: `/home/alexbanica/workspace/netatmo-home-coach-control-integration`, main at `5a4b8e77c541ea29d2ec1324565e7f58e6a95263`. Unrelated untracked `.idea/` exists and must be preserved. No source edits, runtime probes or delivery occur in this planning session. Later implementation uses the approved artifacts and named patterns below, without reopening unrelated research.

## Workspace and Git delivery

- Delivery branch: `feature/netatmo-health-endpoint` on `origin` (`https://github.com/alexbanica/netatmo-home-coach-control-integration`).
- Isolated worktree: `/tmp/agent-worktrees/netatmo-home-coach-control-integration/netatmo-002`. Preserve the invoking main checkout and all private/unrelated files.
- At implementation entry, refresh the remote delivery branch if it exists and use its verified tip; otherwise refresh `origin/main`, falling back to `origin/master` only if main is unavailable. Record the actual selected ref and SHA before edits. The research SHA above is not a pinned implementation base.
- Prepare/reuse the worktree according to implement's guarded lifecycle. If the exact path is registered but absent, only non-forced removal of that registration and verified recreation is permitted. Any other dirty, conflicting, missing or unsafe worktree state stops as DRAFT. Never overwrite concurrent work.
- For a new branch, prepare at detached verified base; immediately before first commit verify the delivery branch is absent locally and unattached, then create it at that HEAD. Existing delivery-branch checkpoints resume only that verified branch, checking ancestry and attachments; never reset to a new main.
- Parent byte-verifies transfer of this approved SPEC/PLAN to the worktree and retains original content/index/HEAD recovery state. Never copy `.env.local`, `config.json`, `.idea/` or credentials.
- PLAN approval followed by valid fresh-session implement entry authorizes parent commit and non-force push of accepted source and these two artifacts to `origin/feature/netatmo-health-endpoint`. Verify staged paths, actual commit, remote SHA and upstream. No main merge, PR mutation, tag, publication, restart or deployment is included.
- After verified push, detach the retained clean worktree and restore only unchanged transferred artifact content/index in the invoking checkout according to implement. Preserve concurrent edits. Failed transfer, push, verification or cleanup remains DRAFT.

## Architecture and selected defaults

Keep domain and calibration use-case policy unchanged. Add a shared in-memory `ServiceHealthState` with its own `ServiceHealthInterface` contract; the scheduler and HTTP adapter depend on that contract. Store lifecycle and active-cycle start time only, with an injected monotonic time function, composed with `performance.now()` at AppFactory. Evaluate the active limit on each read; do not introduce heartbeat timers, filesystem state, new dependencies or a wall-clock-based deadline.

The state distinguishes not-started, active-cycle, scheduled-wait and stopped. Before scheduler entry it is unhealthy. An active cycle is healthy through the exact configured limit and unhealthy after it; completion or rejection enters healthy wait. Rate-limit waits never expire by age. Scheduler exit/finally marks stopped. A stopping latch overrides later cycle completion so shutdown cannot restore healthy status.

Add `HealthEndpoint` under infrastructure HTTP using Node's built-in HTTP server. Bind only `127.0.0.1`; handle GET `/healthz`, 404 and 405 exactly as the SPEC defines. Ignore query data for health evaluation and disclose only the specified status body. Set fixed small HTTP header/request/idle timeouts (5 seconds) as reversible resource-handling defaults; they do not change health-state deadlines or external probe timing. Closing must terminate remaining HTTP connections rather than await keep-alive indefinitely. Do not log per-probe account or request data.

Extend validated configuration with `healthcheckPort` and `healthcheckMaxCycleSeconds` from the SPEC's two environment variables. Reuse strict positive-integer parsing, enforce the port upper bound and safe millisecond conversion. Do not alter the JSON mappings schema. AppFactory owns concrete composition; main owns listener startup, process signals, cancellation and cleanup. Bind and register failure handling before first synchronization. Sanitize startup/bind diagnostics to fixed codes, never raw errors or configuration. Unexpected listener errors mark health stopped and abort existing scheduling, followed by cleanup and nonzero exit; no cycle retry is introduced.

Ensure signals during asynchronous listener startup are captured before synchronization can begin. On shutdown, latch stopping before aborting the controller, close the listener and retain existing in-flight cancellation behavior. On unexpected scheduler return, synchronously mark stopped before initiating listener cleanup. While the endpoint remains available during cleanup, all accepted health requests return 503 as required by H5; after closure probes fail by connection failure. Close the listener and finish process cleanup rather than retain a stale 200 or keep an otherwise terminated worker running. H5 specifies status while available, not indefinite endpoint availability after scheduler termination.

## Units, ownership and sequence

All source units are serialized. Every bounded specialist assignment includes exact artifact digests, current source boundary, prerequisites, permitted effects, a stable unit ID, five-minute limit and the mandatory single-JSON handoff. Children preserve others' work and never branch, create worktrees, commit, push or deploy. Parent retains integration and acceptance. Split an unfinished assignment into disjoint successors after verified handoff; temporary capacity limits queue work rather than end it.

### N002-U1 — Scheduler health state and configuration

- Role: developer. Prerequisite: valid fresh implement entry, verified base/worktree and approved artifact transfer.
- Exclusive production ownership: `src/shared/health/ServiceHealthState.ts`, `src/shared/health/interfaces/ServiceHealthInterface.ts`, `src/shared/config/ServiceConfigurationInterface.ts`, `src/infrastructure/config/EnvironmentConfigLoader.ts`, `src/infrastructure/scheduling/SerialScheduler.ts`.
- Deliver validated settings, monotonic state transitions, scheduler-entry/cycle/wait/finally notifications, stopping latch and read-only health classification. Keep optional injected health notifications compatible with existing scheduler construction until U2 wires them; do not change wait calculation, cycle sequencing or error handling policy.
- Completion evidence: exact paths and diff, static boundary review against H3–H6, strict type/lint result. No infrastructure tests or runtime probes.
- Next step: parent verifies handoff and integrates U1; then U2 consumes the concrete contract. U1 handoff is intermediate, not delivery completion.

### N002-U2 — Endpoint and runtime lifecycle

- Role: developer. Prerequisite: accepted U1 handoff and contract.
- Exclusive production ownership: `src/infrastructure/http/HealthEndpoint.ts`, `src/AppFactory.ts`, `src/main.ts`.
- Deliver minimal loopback HTTP operation, fixed status JSON/headers, method/path responses, lifecycle wiring and sanitized startup/listener failure handling. Build and validate before listening; bind before synchronization; preserve cancellation and ensure bounded listener cleanup.
- Completion evidence: exact diff, static startup/shutdown and no-Netatmo-on-probe path review; development checks below. No infrastructure tests or runtime probes.
- Next step: parent integrates and freezes the complete diff for assurance.

### N002-U3 — Assurance, correction and final assessment

- Parent owns source integration, acceptance, artifact updates and Git. Any accepted source corrections return to the owning developer under the same file boundaries; serialize changes and repository checks.
- Freeze baseline/current source, integrated diff, approved SPEC/PLAN digests, trace and actual development-check results. Assign one independent code-reviewer covering the complete change and one independent contract-reviewer covering HTTP operation, lifecycle-visible status and configuration contract. Both are read-only, independently inspect full assigned coverage, and return correlated JSON evidence within five minutes.
- Wait for the whole wave. Parent disposes each finding and applies one consolidated in-scope correction batch, followed by affected checks. Behavior gaps require the implement amendment procedure; no silent expansion.
- Run one final independent qa-agent pass over the approved requirements, integrated source and check evidence. QA does not edit or run excluded infrastructure checks. Repeat the full correction cycle only for a confirmed required-check/acceptance failure, regression, contract incompatibility, high/critical security defect or blocked requested behavior when the benefit exceeds the impact.
- Documentation-writer source edits are inapplicable: the explicit endpoint/service-only boundary excludes maintained documentation, examples and unrelated files. This SPEC/PLAN contain the approved operational contract and handoff; parent checks consistency before delivery. Do not dispatch a writer merely to edit excluded files.
- Next step: parent verifies Definition of Done and completes authorized commit/push and cleanup, or records exact blocked DRAFT evidence. Review/QA handoffs never require a routine continuation question.

## Assurance rationale and planning assurance

Select **full** assurance: a new HTTP API introduces producer/consumer semantics and a listener, plus cross-component scheduler/lifecycle behavior. Independent code review, contract review and final QA are required. Security-reviewer is not triggered because the user did not explicitly request security review; code/contract review still inspect loopback binding, disclosure and safe shutdown. Architect planning assurance is not triggered: this change is operational worker health around the single calibration capability; endpoint, configuration and scheduler are technical components, not multiple interacting business domains. There is no change to the calibration domain's rules.

Independent plan-readiness review completed on 2026-11-13 by `health_plan_readiness`, unit `N002-PLAN-REVIEW`, against approved SPEC SHA-256 `8b88a303188a1cfd0f67f78af78836009d040d832ec27675e96f4900d4718579` and pre-correction PLAN SHA-256 `5a6f1ce1922e6db63d3ea686e0b0a49a14b0156c3ddaafbfb089c7e28f38bb46`. Coverage: handoff, SPEC/trace consistency, ownership/dependencies, validation exclusions, delivery/recovery and approval boundaries. Two findings were reconciled: (1) clarify H5 on unexpected scheduler exit: state is synchronously stopped before listener cleanup, with 503 for requests accepted while available and failed connections after closure; no indefinite listener lifetime is specified by H5; (2) require successful npm ci evidence for the implementation checkout and lockfile, reusing only an unchanged successful applicable run. The plan now states both explicitly. Review was read-only and did not verify runtime behavior or grant approval.

## Requirement-to-delivery trace

| SPEC requirement | Delivery ownership/outcome | Validation or terminal evidence |
| --- | --- | --- |
| Confirmed settings and definitions | U1 config/state; U2 composition and listener | Static default/range/unit review, strict checks |
| H1 | U1 validation; U2 main/AppFactory/endpoint | Static bind-before-cycle and sanitized failure/cleanup review |
| H2, H7 | U2 HealthEndpoint | Contract/code review of exact status, JSON, headers, 404/405 |
| H3 | U1 shared state/scheduler | Monotonic elapsed comparison and initial-state review |
| H4 | U1 scheduler/state | Complete, rejected, wait, backoff and dry-run path review; business regressions |
| H5 | U1 stopping/finally; U2 signals/cleanup | Static signal/startup/late-completion/exit and connection-closure review |
| H6 | U1 classification and recovery; U2 read-only handler | Dependency/call-path review; no API work from probe |
| H8 | U1/U2 source only; external integration excluded | Diff scope audit, loopback-only bind, no probe or restart machinery |
| A1 | U1/U2 and U3 integrated assurance | Independent code/contract coverage of H1–H8, final QA |
| A2 | U1/U2 development; U3 affected validation | Locked install, check, existing business suite, build; no infrastructure tests |
| A3 | U3 integrated review | Calibration/auth source unchanged; scheduling/cancellation diff review |
| A4 | Parent reconciliation and U3 | Exact changed-path audit, predecessor/private-file preservation, diff check |
| Documentation/handoff | This SPEC/PLAN only; no maintained-doc source edits | Parent consistency review; RpiInfrastructure probe/runtime evidence explicitly omitted |

## Validation and evidence limits

Use Node.js 24 and the checked-in lockfile. Development checks: `npm ci`, `npm run check`, `npm test`, `npm run build`; parent also runs `git diff --check`. Serialize installation and repository-wide checks. Reuse unchanged successful evidence; rerun affected checks after corrections. Require successful `npm ci` evidence for the implementation checkout and checked-in lockfile. Reuse a prior run only when its successful result, exact checkout, unchanged lockfile/dependency inputs and installed dependency state are established; otherwise run `npm ci`. Merely observing installed dependencies does not satisfy A2. Tests remain domain/application business-only. New health logic is infrastructure/lifecycle behavior, so test-first and new automated health tests are inapplicable under repository policy.

No endpoint curl/fetch probes, listener execution harnesses, auth/network/config/scheduler tests, container execution, Docker HEALTHCHECK validation or live Netatmo work. Static/type/business/build results do not prove endpoint runtime reachability, container networking or RpiInfrastructure probe integration. Report those omitted outcomes as intentionally outside this feature's current scope, rather than inventing runtime evidence or making them a new delivery blocker. Hosted CI is observed only if naturally triggered by authorized delivery; no CI changes or excluded infrastructure execution are added.

## Completion, stop conditions and recovery

Definition of Done: approved consistent artifacts; H1–H8/A1–A4 covered by source, permitted checks and reconciled reviews; independent final QA complete; exact source-only scope and artifact consistency verified; authorized commit and push verified against the destination branch; guarded detach/transfer restoration completed. Final report identifies feature value, actual check outcomes, commit/branch and intentional lack of endpoint/runtime/RpiInfrastructure evidence.

Stop affected work for missing authority, artifact inconsistency, inability to resolve a supported behavior gap, failed fetch or unavailable base, unsafe/conflicting worktree/branch state, unavailable required assurance after permitted recovery, failed required checks or unverified push. Complete safe independent work first. When safe and authorized, parent may commit/push a clearly labeled DRAFT checkpoint to the same branch, record unmet criteria and detach; a checkpoint is intermediate and does not satisfy Definition of Done. Preserve partial work and unrelated changes; never force-reset, force-push or deploy. Routine stage transitions continue autonomously after valid implement entry.

## Approval record

Approved by the user on 2026-11-13 with "approve" in response to presentation of this complete PLAN after readiness assurance and finding disposition. Approval covers the implementation, assurance, permitted validation and feature-branch commit/push lifecycle defined above. This human-invoked spec-plan session remains planning-only. Start a new fresh assistant conversation and invoke implement with the approved SPEC and PLAN paths; do not implement in this session.
