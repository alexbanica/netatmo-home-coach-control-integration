# NETATMO-004 — Debug temperature observations delivery

Status: Approved
Date: 2026-11-19
Approval: Explicit user approval on 2026-11-19 ("approve") of the complete reviewed PLAN.

## Authority and approved behavior

Implement [NETATMO-004-SPEC.md](NETATMO-004-SPEC.md), explicitly approved on 2026-11-19. The user's subsequent clarification assigns the new branch and new beta tag to the tracing logs. Deliver DEBUG-only observations without changing calibration or schedule behavior. Earlier NETATMO-001/002/003 SPEC/PLAN pairs remain read-only. This human-invoked spec-plan session performs planning only; implementation requires a new assistant session with the approved pair.

The beta is `1.0.3-beta1`, identifying the final validated diagnostics commit. The requested tag includes its non-force push and the existing automatic publisher, producing `1.0.3-beta1-node24-alpine` and updating `latest-node24-alpine`. No deployment or live calibration follows. SPEC A6 excludes live/publication evidence from diagnostics validation; the explicit subsequent release request separately authorizes this delivery publication, not a physical test. Never create or move a tag on a partial/DRAFT commit.

## Workspace, base and Git delivery

- Branch: `feat/netatmo-calibration-observations`, already created in the invoking checkout at `e881b3c0dea4906d2711657bedd55b256b3b4ea5` under the user's request. It contains no diagnostics commit yet.
- Isolated execution path: `/tmp/agent-worktrees/netatmo-home-coach-control-integration/netatmo-004`. Planning artifacts stay at origin until byte-verified transfer.
- Remote verification on 2026-11-19: `origin/main` is `e881b3c0dea4906d2711657bedd55b256b3b4ea5`; neither remote delivery branch nor `1.0.3-beta1` exists. This is a snapshot, not future fetch evidence.
- At implement entry refresh the remote delivery branch if present; otherwise fetch `origin/main`, falling back to `origin/master` only if main is unavailable. Record the resolved base SHA. If a delivery branch exists, use it and verify checkpoint ancestry; do not restart from main.
- Preserve the user-requested, already-created local branch. This precreated branch is a deliberate exception to new-branch absence requirements, not an existing-PR assumption. Verify it still equals the recorded preparatory SHA or the verified delivery checkpoint. Preserve invoking HEAD/index/content recovery state and all unrelated changes. Detach the invoking checkout at its unchanged HEAD without altering private/untracked files, then create the isolated worktree on the now-unattached delivery branch. Advance it to the selected refreshed base only by fast-forward. Divergence, unexpected commits, other attachments or conflicting artifacts stop; no reset, force checkout or overwrite. Do not touch older task worktrees.
- If the exact execution path is registered but absent, remove only that registration with non-forced `git worktree remove`, verify it is gone, then recreate. Other conflicting/dirty states stop as DRAFT.
- Transfer both approved artifacts byte-for-byte, preserving original content/index/HEAD recovery evidence and verifying SHA-256. Never copy `.env.local`, private config, IDE files or secrets. Preserve the invoking checkout's original branch attachment after the execution worktree is detached at delivery; do not restore over concurrent edits.
- Parent commits all accepted source, allowed business tests, documentation and both artifacts, then non-force pushes to `origin/feat/netatmo-calibration-observations`. Verify remote branch SHA/upstream and artifact bytes. Create a draft PR from that branch to `main` (or reuse an exact matching PR), verify its head SHA equals the delivered commit, and observe final-head CI. The draft PR is the CI trigger: the existing workflow's push filter does not include this branch. PLAN approval authorizes this draft PR creation, not merging. No main merge is authorized. Detach and retain the clean execution worktree using implement's ordinary branch-delivery recovery rules; restore only unchanged transferred origin artifacts/index state. Report retained path and actual cleanup/recovery state.

## Implementation boundary and units

No renewed product/API research is needed. Use only approved artifacts and these named source patterns. Reversible local defaults are a private best-effort observation helper, no persistent history, no new configuration/dependency and no generated tracked output. Serialize source integration, checks and Git effects. All workers preserve others' edits and never branch, create worktrees, commit, push, tag or deploy. Each bounded assignment has a five-minute hard limit; parent retains remaining work and splits successors if needed.

| Unit | Ownership and role | Prerequisites | Completion |
| --- | --- | --- | --- |
| U0 | Parent only: workspace preparation and byte-verified approved artifact transfer | Valid fresh implement entry; safe branch/base/worktree state | Execution workspace contains the exact approved pair; recovery state and artifact hashes recorded before U1 |
| U1 | Developer: `src/application/services/TemperatureSynchronizationService.ts`, `src/shared/logging/StructuredLogger.ts`; `tests/unit/application/TemperatureSynchronizationService.test.ts` only for necessary business regressions | Verified workspace and artifact hashes | Exactly one DEBUG observation on policy evaluation; isolated logging failure; narrow finite-numeric allowlist extensions; unchanged business behavior |
| U2 | Parent coordinates independent code-reviewer and contract-reviewer, then a bounded developer correction batch on U1 paths | Integrated U1 diff and check evidence | Whole diff reviewed; supported findings disposed and affected checks rerun |
| U3 | QA-agent: read-only static acceptance assessment and existing business/build evidence | U2 corrections validated | Full final QA pass within business-only validation rules; no logger/infrastructure probes |
| U4 | Documentation-writer: `docs/operations.md` only | Final accepted semantics and QA evidence | Document DEBUG fields, signed delta example and interpretation limits; parent inspects final documentation |
| U5 | Parent only: Git reconciliation, commit/push, draft PR and release tag | U1–U4 accepted; local checks/reviews/QA/docs complete | Push branch, create/reuse draft PR, verify final-head CI, then tag/push and verify publication; assess terminal Definition of Done afterward |

U1 uses already-resolved source timestamp/raw temperature and already-fetched room temperature. Use existing policy-normalized values, compute signed delta at 0.1°C, and include the policy outcome. Capture one observation time from the injected clock and use it for both explicit ISO `timestamp` and `sourceAgeSeconds`, ensuring the event timestamp and age share the same reference. Emit after policy evaluation and before branch exits, with try/catch isolation. Earlier missing/invalid/stale/unreachable exits keep existing outcome behavior; a final freshness failure can still follow the observation. No setpoint/mode extraction or new calls. Preserve existing info logs and authentication redaction. New numeric allowlist entries reject strings/nonfinite values rather than falling through generic bounded-string handling.

Do not add tests solely asserting logger output or DEBUG filtering. Existing business tests are authoritative; add only a meaningful use-case regression if needed, such as identical calibration decisions and gateway calls despite a throwing logger. Test-first applies only to such permitted business behavior; infrastructure/logging tests and inline substitutes are inapplicable by repository policy.

## Assurance and validation

Profile: **full**. This introduces a structured diagnostic event and payload visible to log consumers, so routine eligibility is not established. One independent integrated code-review wave and contract review are required; contract coverage includes exact field semantics, old log compatibility, DEBUG visibility and no inference of physical application. No security-reviewer is triggered because none was explicitly requested; redaction and safe handling remain code/contract review obligations.

Domain assessment: one business capability, room calibration observation. Logging and documentation are technical layers of that same capability; no interacting business domains. Architect plan assurance is therefore not triggered. Independent plan-readiness review is mandatory before this PLAN is presented for approval.

Use Node 24 and the lockfile; `npm ci` as needed, then `npm run check`, `npm test`, `npm run build`, and parent `git diff --check`. Freeze exact baseline/current diff, artifact hashes, check inputs/results and requirement links for reviewers. Wait for the whole review wave, apply one consolidated supported correction batch, and rerun affected checks. Full final QA uses static review plus permitted check evidence; it does not add infrastructure/logger/runtime tests. Repeat assurance only for confirmed qualifying failures under implement rules. After QA, the required writer synchronizes operations documentation; inspect its diff and run final whitespace checks. No runtime startup, device API call, container probe or physical heating experiment.

## Requirement-to-delivery trace

| SPEC requirement | Units/paths or no-source outcome | Evidence |
| --- | --- | --- |
| R1, A1 | U1 service/logger; U2/U3 | Static DEBUG gating and unchanged existing levels |
| R2, R4 | U1 service; U2/U3 | Single emission placement, shared time reference, correlation and no dispatch claim |
| R3, R5 | U1 service/logger; U2/U3 | Exact approved fields, signed units, finite-number rejection and no raw objects/IDs |
| R6, regression boundaries, A2, A4 | U1/U2/U3 | Diff inspection; existing business suite and any justified business regression; unchanged policy, network and retry paths |
| A3 | U1/U2/U3 | Node version, locked dependencies, check/test/build results and whitespace check |
| A5 | U4 operations documentation | Parent inspection and complete field/interpretation coverage |
| A6, scope/exclusions | U2/U3/U5; no runtime-source change | No live calibration/deployment/physical test; separately authorized tag publication reported independently |
| User branch/beta request | U5 | Exact remote branch/tag SHAs and publisher result/status |

## Release and terminal delivery

Before tagging, reverify exact final source commit, complete local checks, publisher definitions and approved artifacts on that commit. First push the accepted branch and create/reuse its draft PR to main, then verify ordinary CI runs for that exact PR head and passes. Failed required checks block release, and unavailable CI is reported as missing platform evidence with DRAFT status. Keep the PR draft; no main merge is authorized. Inspect remote tags immediately before creation; `1.0.3-beta1` must be absent (or an already-delivered identical target must be verified and never moved). Validate the publisher's Docker tag syntax/suffixed length and expected ARM64 artifact names for that exact commit. No package version bump or workflow change is needed: the existing publisher derives versions from Git tags.

Create an annotated `1.0.3-beta1` pointing to the verified diagnostics commit and non-force push that exact tag to origin. Verify its peeled remote target equals the branch-delivered commit. Observe the existing tag publisher; report whether versioned and moving image receipts/digests were confirmed. Missing/failed publication remains release DRAFT; do not retag, fabricate success or deploy. Never read secret values. This is existing tag-triggered delivery, not a change to deployment behavior.

Definition of Done: approved consistent artifacts; U1–U4 complete; check/test/build and required reviews/QA passed; all supported findings resolved; documentation synchronized; exact accepted paths and artifact bytes committed/pushed to the named branch; requested beta tag verified on the same commit; publication outcome and omitted live evidence explicitly reported; workspace recovery verified. Unit handoffs/checkpoint pushes are intermediate progress, never a continuation gate. For a genuine blocker, finish safe independent work and authorized DRAFT branch delivery where possible, report exact unmet criteria, and withhold release tag until release prerequisites pass. No force push, main merge, deployment, unrelated cleanup or credential effects.

## Plan assurance and approval

Independent plan-readiness review on 2026-11-19 (`netatmo004-readiness`) covered the complete SPEC/PLAN, trace, ownership, test exclusions, assurance, workspace and release sequence. It verified SPEC digest `18fe26168bfe48c6ad5cb906fb0ef283f70831e2f56ef4d6e8cfa4ca0369845d` and initial PLAN digest `b8d2942401ae3592c900a5708fdcc5e89d145580aa156dc6f183dc13e98fa450`. Two supported findings were corrected: U5's circular Definition-of-Done prerequisite is replaced by explicit pre-delivery prerequisites and ordered terminal assessment; the CI trigger gap is resolved by an authorized draft PR before exact-head checks and tagging. Correction review (`netatmo004-readiness-final`, revision `efc9c91d514e33bb963c232becd48458c0ed916280108fc383b07a7b81211b99`) confirmed those fixes and identified artifact-transfer ownership wrongly assigned to late delivery. This is corrected by explicit parent U0 before U1; U5 now owns delivery/release only. Final closure review (`netatmo004-readiness-closure`) verified revision `90aa989023258f45c896daba29d8d7b60aef88ad9eb23c787f95f137f4d443bc`, carried forward prior coverage, rechecked U0/U1/U5 prerequisites and returned no findings. This assurance-record update changes no reviewed execution semantics. Architect trigger absent for the single-domain reason above. Approval of this PLAN will cover the complete delivery lifecycle in a later fresh implementation session, not execution in this planning session.

## Approval record

Approved by the user on 2026-11-19 with "approve" in response to the complete reviewed PLAN. Approval covers isolated implementation, required assurance and validation, documentation, branch commit/push, draft PR checks, and beta tag `1.0.3-beta1` publication on the validated diagnostics commit. Implementation requires a new assistant session; no deployment or live calibration is authorized.
