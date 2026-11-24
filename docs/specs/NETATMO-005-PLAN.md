# NETATMO-005 — Room calibration guard and correction cap implementation

Status: Approved

## Authority, scope and delivery

Implement the approved [NETATMO-005 SPEC](NETATMO-005-SPEC.md). The predecessor
[NETATMO-001 SPEC](NETATMO-001-SPEC.md) and [PLAN](NETATMO-001-PLAN.md) describe
the former fixed skip threshold and ordinary reread. [NETATMO-003 SPEC](NETATMO-003-SPEC.md)
and [PLAN](NETATMO-003-PLAN.md) retain the pre-write recovery boundary.
[NETATMO-004 SPEC](NETATMO-004-SPEC.md) and [PLAN](NETATMO-004-PLAN.md) define
the DEBUG observation, which will show the capped candidate and its delta.
Preserve those approved artifacts. Limit execution to the named paths and
dependencies. The planning checkout remains on its current branch.

Use isolated worktree
`/tmp/agent-worktrees/netatmo-home-coach-control-integration/netatmo-005`
and delivery branch `feat/netatmo-calibration-retry` on `origin`. For first
execution use pinned diagnostics baseline
`6dadf16fa03833368ba7c39ea21000b4e3a82f14`, verified reachable from the
refreshed `origin/feat/netatmo-calibration-observations` or `origin/main`.
This retains the approved diagnostics dependency regardless of its integration
timing. Verify current remote main and delivery-branch state before creating
the worktree. If the delivery branch exists, resume only a verified checkpoint
of this work using its refreshed remote tip and confirmed ancestry. Stop on
unknown branch ownership, conflicting state or unavailable required refs.
The planning checkout's tracking refs are cached. GitHub branch search showed
`main` and the diagnostics branch, with no matching retry branch. Direct Git
remote SHA verification was blocked by DNS. Refresh and verify Git refs at
implementation entry.

## Units and sequencing

| Unit | Owner and paths | Prerequisite and completion evidence |
| --- | --- | --- |
| U0 | Parent, Git and the two NETATMO-005 artifacts | Verify effective approvals, hashes, remote refs, workspace registration and exact starting commit. Transfer artifact bytes into a detached isolated checkout with recorded invoking path, HEAD, index and content state. Preserve unrelated and private data. |
| U1 | Developer, `src/domain/services/CalibrationPolicy.ts`, `tests/unit/domain/CalibrationPolicy.test.ts` | After U0. Add business cases before policy edits. Use integer tenths to cap signed deltas. Check equality, dry-run, custom and default cap, both directions and exact boundary. |
| U2 | Developer, `src/application/services/TemperatureSynchronizationService.ts`, new `src/application/ports/CalibrationStateStoreInterface.ts`, `src/application/ports/SynchronizationGatewayInterface.ts`, `src/infrastructure/netatmo/NetatmoClient.ts`, `tests/unit/application/TemperatureSynchronizationService.test.ts` | After U1. Add business cases first with injected gateway, clock and store. Carry typed calibration POST timeout provenance while retaining existing outcome/error behavior. Track rooms by both IDs and count valid readings once per room/cycle. Restart receives validated records. Preserve the successful record and flush a failed save before permitting any later POST. Add skipped reason `awaiting_room_temperature_change` and sanitized `calibration_state_save_failed` outcome reporting without hiding that Netatmo accepted the write. |
| U3 | Developer, new `src/infrastructure/config/CalibrationStateFileStore.ts`, `src/infrastructure/config/EnvironmentConfigLoader.ts`, `src/shared/config/ServiceConfigurationInterface.ts`, `src/AppFactory.ts` | After U2. Wire startup config, initial state and store through the composition root. Resolve paths relative to the configured working directory. Use a JSON array of records with home ID, room ID and pre-write temperature, reject duplicate IDs or invalid records, and use same-directory temporary write plus rename for replacement. Before startup, reject a state path resolving to the configuration file. Surface sanitized errors without raw filesystem data. Review boundaries in source. |
| U4 | Parent coordinates independent code review, contract review and QA across U1–U3; correction developers retain their owned files | Integrated development checks, complete review coverage, supported findings corrected, affected checks rerun and final QA. |
| U5 | Documentation writer, `docs/operations.md`, `.env.example`, `.gitignore` | After U4. Document settings, cap examples, polling and restart behavior, save recovery, DEBUG/final outcome meanings, locally ignored file and explicit writable directory mount plus state path for the non-root container. Inspect against approved behavior and final implementation. |
| U6 | Parent, accepted paths and Git | After U5. Recheck final artifact bytes, exact accepted paths, final diff and delivery. Report terminal status and omitted evidence. |

Keep shared edits, integration and validation serial. Each dispatched specialist
gets a bounded assignment and five-minute limit. Keep the file format local to the
adapter and inject records and save behavior through the application port. Preserve
the previous file until rename succeeds. Keep the Docker image and CI configuration
unchanged and document the persistent writable path as a runtime prerequisite.

## Requirement-to-delivery trace

| SPEC anchor | Units and evidence |
| --- | --- |
| Behavior 1 and acceptance bullet 1 | U1 policy and tests, U3 setting validation and composition, U5 settings and examples. |
| Behavior 2 and acceptance bullet 2, suppression and resumption | U2 service and business tests for counting, per-room isolation, changed and invalid readings, source changes, eligibility and reset. U5 explains cadence. |
| Behavior 3 and acceptance bullet 2, success and timeout | U2 and U3 port, adapter, service and store. Test confirmed success, pending save, definitive failure, dry-run, timeout equality and change and repeat timeout. Inspect the POST transport error path separately from pre-write failures. |
| Behavior 4–5 and acceptance bullet 2, restore and I/O | U2 and U3 startup and save wiring, fake-store cases for restored state and failed save recovery, source inspection for creation, validation and replacement, U5 for restart and persistence instructions. |
| Behavior 6 and preserved scope under Purpose | U2 observation and mapping outcomes, U4 integrated checks and contract assessment, U5 operations. Review preserved request shape, source freshness, authentication, discovery, scheduler, health, rate limit and dry-run behavior. |
| Acceptance bullet 3 and excluded effects | U5 documentation and final inspection, U6 verified branch, draft PR and exact-head CI. No source for release, deployment or live acceptance. |

## Assurance and completion

Use full assurance because coordination crosses application, startup configuration
and filesystem state and changes a structured event's meaning. Room calibration
is the single business domain, so architect assurance is inapplicable. Independent
PLAN readiness is required. Code review covers the full integrated change.
Contract review covers corrected temperature/delta semantics and new mapping
outcome reporting, and verifies the existing provider payload and outcome
compatibility. Security review was not explicitly requested.

Use Node.js 24 and run `npm ci`, `npm run check`, `npm test` and
`npm run build`. Business tests only under existing domain and application
paths. Use static inspection of startup, file and HTTP paths. No inline
infrastructure probes, live login, calibration or physical checks. Parent runs
`git diff --check`. Freeze the integrated diff, hashes, criteria and check
evidence before review, reconcile the whole wave and correct supported findings
in one batch with affected revalidation. Run one independent final QA pass over
the business acceptance and source evidence, with another cycle only for a
qualifying confirmed failure or regression under the implementation skill.
Then dispatch the documentation writer and reconcile the final diff.

Commit only accepted changes and both approved artifacts. For new delivery,
create the exact branch at the verified detached worktree HEAD immediately
before the first commit after confirming the local branch is absent and
unattached. Push non-force to `origin/feat/netatmo-calibration-retry`, verify
upstream, commit SHA and artifact bytes, then create or reuse one draft PR from
that branch to `main`. The pinned diagnostics changes may be visible in the
draft PR until they integrate into main. Verify the PR head and ordinary CI for
that exact SHA. This plan authorizes the draft PR and push upon approved
implementation entry. Merge, tag, publication and deployment require separate
authority.

At a recoverable checkpoint, complete safe independent work and continue.
If a genuine blocker persists, record exact missing evidence and safely commit
and non-force push authorized DRAFT work where possible. Validate the upstream,
detach and retain the clean delivery worktree, and restore only unchanged
transferred origin content/index as required by implement. Resume only from a
refreshed verified checkpoint branch with matching ancestry and no competing
attachment. For a registered but absent exact planned worktree, use non-forced
removal of that registration only before recreation. Unsafe or overlapping
state blocks that operation.

Done requires the approved pair, completed units, supported findings closed with
required evidence, passing local checks, synchronized docs, verified branch
commit/push and draft PR at that commit, passing exact-head CI and verified
workspace reconciliation. A missing required result leaves delivery DRAFT.

## PLAN readiness

Independent reviewer `NETATMO-005-readiness` compared approved SPEC digest
`90609a2daea9f923473cb355b5a0fae854e7331b0288505562fd3cc3f5d48e98`
with PLAN draft digest
`e98492abb7b90758954edbf8aa7100322ed81b033fdb67dd0a4b6eed756f7f20`.
It covered requirements, ownership, sequencing, validation, assurance,
delivery and recovery. It reported no actionable findings. The remote branch
search note adds read-only evidence without changing the reviewed delivery
requirements. No implementation or live behavior was verified.

## Approval

The user explicitly approved this complete PLAN on 2026-11-23 with “apprrove”
in response to its approval request.

## Amendment 1 — 2026-11-23 — Base new delivery on origin/main

- Amendment ID: NETATMO-005-PLAN-A1
- Previous version: Original approved PLAN
- Approval: Approved
- Request and purpose: The user requested “from origin main please” after confirming the original PLAN pinned the diagnostics branch commit.

### Changes against the previous version

| Section / requirement | Before | After | Reason |
| --- | --- | --- | --- |
| Authority, scope and delivery and U0 | Start first execution at pinned diagnostics commit `6dadf16`. | For first execution, fetch and resolve `origin/main` and the planned delivery branch state. If no delivery branch exists, start the isolated worktree at the exact refreshed `origin/main` tip. No fallback base. | Use the requested base. |
| U0 dependency verification | The pinned base contains NETATMO-004 diagnostics. | Before first execution, verify the refreshed main tip contains the NETATMO-004 observation contract and its maintained predecessor artifacts. Check ancestry of `6dadf16` or verify equivalent merged content when integrated by squash or rebase. If missing or unverifiable, stop before creating the worktree or editing source. | Preserve the approved SPEC's diagnostics behavior on the requested base. |
| Draft PR contents | The draft PR can carry the diagnostics commit until its integration into main. | U6 delivers NETATMO-005 from the verified main-based checkout. NETATMO-004 must already be present on the selected main base. | Keep NETATMO-005 delivery scoped to the requested base. |

The current read-only GitHub comparison shows main at
`e881b3c0dea4906d2711657bedd55b256b3b4ea5`, with the diagnostics branch one
commit ahead. First execution is therefore gated on verifying the dependency
on refreshed main. This amendment grants no authority to merge, cherry-pick,
or recreate the predecessor. Resume uses a verified NETATMO-005 checkpoint
only if its recorded original base satisfies this amendment. A different base
or missing provenance blocks resumption.

### Preserved behavior and impact

The approved NETATMO-005 SPEC (SHA-256
`90609a2daea9f923473cb355b5a0fae854e7331b0288505562fd3cc3f5d48e98`),
worktree path, delivery branch, draft PR target, U1–U5 ownership and sequencing,
validation, assurance and commit/push authority continue to apply. Room
calibration remains one business domain. No architect review is triggered.

### Requirement-to-delivery trace

- SPEC Purpose and Behavior 6: U0 verifies main provides the approved diagnostics
  dependency, then U2 updates the candidate and delta semantics. U4 verifies
  the integrated observation and outcomes.
- SPEC Behaviors 1–5 and all acceptance bullets: retain the original trace,
  units and validation. U6 records the refreshed main base and exact delivered
  SHA with the existing draft PR and CI evidence.

### Amendment readiness

Independent review `NETATMO-005-A1-readiness` compared PLAN digest
`9032d888e531a63ea9a0392321c683282a31d563ee37b9aa2229732f630e9fd4`
against the approved SPEC digest above. It checked amendment precedence,
base and dependency verification, trace, carried-forward execution,
validation and delivery. No findings were reported.

### Approval record

On 2026-11-23 the user replied “approve” to the explicit approval request for
`NETATMO-005-PLAN-A1`. This approves the complete effective PLAN with the
refreshed `origin/main` base and NETATMO-004 dependency verification.
