# NETATMO-006 — Writable container calibration state delivery

Status: Approved

Approval: User approved the presented implementation plan in this conversation on 2026-11-24.

## Scope and ownership

[NETATMO-006-SPEC.md](NETATMO-006-SPEC.md) is approved. The image provides a
writable default while preserving the state and override behavior in
[NETATMO-005-SPEC.md](NETATMO-005-SPEC.md) and
[NETATMO-005-PLAN.md](NETATMO-005-PLAN.md). Keep both predecessor files intact.

- U1 owns the runtime stage of `Dockerfile`. Create `/app/state` with
  `node:node` ownership and owner write/search permissions before `USER node`.
  Set the image environment default to `/app/state/calibration-state.json`.
  Retain the current entrypoint and application file ownership.
- U2 owns `docs/operations.md` after U1. Describe both defaults, state lifetime
  and the optional writable directory mount and override. Parent owns this
  approved artifact pair.
- U3 is parent-owned Git delivery after U1/U2 and accepted checks. Refresh
  `origin/main`, `origin/feat/netatmo-calibration-observations` and release tags.
  Observed bases were `af525c848f7bdb173983d5d65314b12cafbd5b71` and
  `87f380cf057845e1ec480699aa76a9b4dea486a3` respectively. Use fresh remote tips.
  Use `/tmp/agent-worktrees/netatmo-home-coach-control-integration/netatmo-006`
  for `main`. Require the local main ref to be unattached and equal to or a
  strict ancestor of remote main before using it. Fast-forward only.
  Record origin checkout identity, untracked artifact bytes/digests, index
  and HEAD state before byte-verified transfer. Commit the accepted change
  and both approved artifacts on main. Verify the local commit and safely
  remove only the byte-identical untracked origin transfer copies following
  guarded two-path preflight. Record the commit and cleanup outcome before
  non-force pushing directly to `origin/main`.
- U4 is parent-owned integration after verified main push. In the invoking
  calibration checkout preserve private files and require its tracked state
  to be clean and local history to match or fast-forward to its remote tip.
  Refresh main and merge its latest verified remote tip into
  `feat/netatmo-calibration-observations`. Validate the merged result before
  non-force pushing it to its remote. After verifying branch SHA and main
  ancestry, tag that exact SHA with `1.0.4-beta3` if still free locally and
  remotely, otherwise the next unused 1.0.4 beta number above the highest
  published beta. Push only that new tag to origin and verify its peeled
  commit. Check publisher results separately from the Git tag and report the
  image tag and publication evidence or blocker. Remove the clean main
  worktree without force after successful delivery.

## Assurance and recovery

Full assurance applies because the runtime image changes filesystem permissions
and deployment startup behavior. No interaction
between business domains and no API or event change. An independent
code-reviewer checks ownership, default and runtime permissions, and regression
scope. A developer implements U1 and runs the documented checks on the main
worktree. After integrated review and any corrections, the QA agent verifies
the proposed main tree using Node 24, `npm ci`, `npm run check`, `npm test` and
`npm run build`. QA builds the candidate image from each delivery tree and
starts its normal entrypoint in a disposable network-disabled container with
placeholder credentials, `DRY_RUN=true`, `CONFIG_FILE=/app/config.json`, and
the example mappings copied to that path in
the container before start. Attach no mounts and leave the state path unset in
the container command. Verify initialization by copying the created state file
out with `docker cp`, and inspect the actual image directory uid, gid and mode
from the disposable container filesystem export to verify same-directory
create/rename permissions for the runtime UID. Remove the disposable container
and temporary files. No real credentials or Netatmo calls. The
documentation-writer synchronizes U2 after main QA. Parent
serializes source, review, checks and Git mutations, validates final staged
content with `git diff --check`, and runs the documented checks again on the
merged feature tree. This image acceptance check uses the ordinary entrypoint without adding
infrastructure tests or inline probes. Verify the
push-triggered CI run on the exact main SHA. The calibration branch is outside
the CI push filter. Verify the tag publisher run on the merged SHA. Parent
reconciles supported findings and reruns affected checks before tagging.
No contract review is triggered and no security review was requested. Each
specialist assignment has a five-minute limit.
Swarm deployment and live calibration are outside the request.

If refresh, protected branch policy, worktree transfer, merge, validation,
publication, or remote verification blocks delivery, preserve verified progress,
record the exact unmet step and retain recoverable work as DRAFT. Do not force
updates, reuse existing tags, or override protection. Report local and remote
SHAs for every step reached.

## Requirement-to-delivery trace

| SPEC requirement | Unit and ownership | Evidence |
| --- | --- | --- |
| Behavior 1 and acceptance 1 | U1, Dockerfile | Ordinary image startup and state-file creation without mounts, effective directory permission inspection, documented checks |
| Behavior 2 and acceptance 2 | U1/U2, Dockerfile and operations guide | Image default and override review, operator guidance |
| Behavior 3 | U1/U2, no app or predecessor edits | Path-limited diff and business suite |
| Behavior 4 | U3/U4, no runtime mutation | Git-only delivery |
| Acceptance 3 | U3/U4, parent | Verified main/branch SHAs, ancestry, peeled beta tag, publisher evidence |

## Plan readiness evidence

Independent readiness review covered the complete approved SPEC and proposed
execution plan, including ownership, traceability, validation, branch order,
tagging and recovery. The first review identified insufficient built-image
evidence and ambiguous hosted CI coverage. The reviewed revision added normal
container startup without mounts and effective filesystem permission inspection,
and distinguished main CI, local calibration checks and tag publication.
The follow-up verified both corrections with no remaining findings.
