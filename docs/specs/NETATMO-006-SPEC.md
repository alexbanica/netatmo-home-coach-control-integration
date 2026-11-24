# NETATMO-006 — Writable container calibration state

Status: Approved

Approval: User approved the presented specification in this conversation on 2026-11-24.

## Purpose

The 1.0.4-beta2 Swarm task starts Node, logs `startup_failed` with
`invalid_configuration`, and exits with code 1. The release initializes a
calibration state file at startup. Its default resolves inside `/app`,
where the image's unprivileged runtime user cannot create the file. A
standard writable container must be able to start without a state mount.

## Behavior

- The production image sets `CALIBRATION_STATE_FILE` to
  `/app/state/calibration-state.json` and supplies the state directory with
  write permission for its existing `node` runtime user. Startup can
  initialize the file and subsequent saves can create and rename a
  temporary file in the same directory. Application code and dependencies
  keep their existing ownership.
- The default stores state in the container's writable layer. It survives
  a restart of that container and is lost when the container is replaced.
  The operator can mount writable storage and override
  `CALIBRATION_STATE_FILE` to choose persistence across replacements.
  An explicit override still follows the existing path validation rules.
- [NETATMO-005-SPEC.md](NETATMO-005-SPEC.md) and
  [NETATMO-005-PLAN.md](NETATMO-005-PLAN.md) define the original state file
  behavior. This changes the image-provided default only. The loader's
  fallback for non-container execution, the state format, the startup
  validation, atomic saves, and calibration policy retain their behavior.
- No Swarm deployment, configuration mutation, or live calibration is
  part of this change.

## Acceptance and delivery

- Verify the production image declares the writable state location and
  continues to use the non-root runtime user. Verify the state directory
  permits file creation and rename at the default location with no mount.
  Apply the repository's documented lint, type, business test, and build
  checks. Keep infrastructure probes within the repository's validation
  constraints.
- Document the container default and the optional persistent storage
  configuration in the operator documentation.
- Commit and push the fix on current remote `main`, merge the resulting
  latest `main` into `feat/netatmo-calibration-observations`, and push the
  updated branch. Tag that merged commit with the next free 1.0.4 beta
  tag and push the tag to trigger the configured publisher. Verify the
  remote refs and distinguish the tag push from image publication.
