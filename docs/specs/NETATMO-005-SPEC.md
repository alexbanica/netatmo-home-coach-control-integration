# NETATMO-005 — Room calibration guard and correction cap

Status: Approved

## Purpose and scope

The user observed that Netatmo applies a correction based on the difference
between the submitted current and corrected temperatures. If a subsequent room
status still reports the old value, sending another correction can apply the
adjustment twice. Give the room time to report a change and allow another
correction if the reading stays unchanged for a configured number of cycles.
Apply a bounded correction when the reference is farther
away than the allowed per-write adjustment.

Research baseline is `6dadf16fa03833368ba7c39ea21000b4e3a82f14` on
`feat/netatmo-calibration-observations`. The current code uses a hard-coded
5°C skip threshold and has no cross-cycle room guard. Provider behavior and
propagation delay are based on the user's observation.

This changes the correction threshold and later-cycle write eligibility from
[NETATMO-001 SPEC](NETATMO-001-SPEC.md) and [PLAN](NETATMO-001-PLAN.md).
It uses the pre-write recovery boundary from
[NETATMO-003 SPEC](NETATMO-003-SPEC.md) and [PLAN](NETATMO-003-PLAN.md).
It extends the calibration policy observed under
[NETATMO-004 SPEC](NETATMO-004-SPEC.md) and [PLAN](NETATMO-004-PLAN.md).
Existing health, scheduling, authentication, discovery, source freshness,
rate limiting, dry-run and web request contracts continue to apply. The work
covers calibration only. Setpoints, schedules, heating modes, deployment,
release publication and live calibration experiments are outside scope.

## Behavior

1. Read `MAX_CORRECTION_C` at startup. When unset, use 5°C. Accept positive,
   finite decimal Celsius values in 0.1°C increments and reject invalid
   configured values at startup. Keep the existing one-decimal normalization
   of the source and room temperatures used for the request. Cap the absolute
   difference symmetrically and submit the normalized room temperature plus
   the bounded signed difference. With a limit of 5°C, 18°C toward 25°C sends
   23°C, and 25°C toward 18°C sends 20°C. At exactly the cap the full correction
   is eligible. Equal normalized temperatures remain a no-op. Calculate each
   new correction from the latest valid readings.
2. Track pending corrections independently by resolved home ID and room ID.
   The stored comparison value is the normalized room temperature observed
   before the write. Read `CALIBRATION_RETRY_UNCHANGED_CYCLES` at startup
   as a positive integer with a default of 2. Starting in the cycle after
   success, count at most one valid unchanged room reading per cycle, even
   if the Home Coach reference changes. Hold writes before the count reaches
   the configured threshold. On the cycle that reaches it, allow a new
   correction from the current readings if the usual checks pass. If those
   checks prevent a write, subsequent eligible cycles may still try. A
   successful new correction resets the count for that room. A changed
   valid room temperature releases the guard and allows normal eligibility
   checks in the same cycle. Cycles without a valid reachable room reading
   neither advance the count nor release the guard. Other rooms continue
   independently.

   At the default five-minute synchronization interval, the first unchanged
   reading is held and the second can trigger a write, roughly ten minutes
   after the first write, subject to cycle duration and scheduling. This
   leaves time for the reported propagation window of up to five minutes.
   An unchanged reading at the threshold permits another attempt and does
   not prove the original correction failed.
3. On receipt of a successful write outcome, arm the in-memory guard and
   immediately save that room's pre-write temperature to the state file
   before processing another calibration. Preserve other rooms' entries.
   A confirmed no-op, a definitive rejection, a dry-run decision and a
   failure before the POST create no entry. After a timed-out POST, retain
   the pre-write room temperature in memory for comparison on the next
   ordinary cycle with a valid room status. If it still matches, allow
   another write if the current readings pass the normal eligibility
   checks. Recalculate from the current readings, including the current
   Home Coach reference. If the room temperature has changed, discard the
   timed-out attempt and evaluate the room normally from the changed reading.
   A second timeout follows the same next-cycle rule. An unchanged reading
   can be delayed, so a later write may apply an additional correction even
   if the timed-out POST already took effect. Other indeterminate POST
   outcomes retain ordinary next-cycle reevaluation. All uncertain attempts
   are excluded from the state file.
4. Use `CALIBRATION_STATE_FILE` with default
   `./calibration-state.json` relative to the working directory. Load and
   validate existing state at startup. Create an empty file if absent.
   The file contains only room identifiers and their last successful
   write's normalized pre-write temperature. Keep the last successful
   entry on disk when an observation releases the in-memory guard. A
   restart reloads that entry and starts its cycle count at zero, even if a
   change was previously seen. The first valid unchanged reading after
   startup counts toward the threshold. The comparison record for a
   timed-out attempt lasts only within the running process. A changed reading
   releases the guard without proving that Netatmo applied the previous write.
5. Replace the state file atomically. If existing state cannot be read or
   validated, or missing state cannot be created, fail startup with a
   sanitized error. If saving fails after Netatmo accepts a write, retain
   the in-memory guard, surface the save failure and stop further writes
   until the pending state can be saved. Preserve the last valid file.
   A crash between provider acceptance and successful local save can leave
   the newest write absent from the file. This service continues to require
   one running instance per configuration.
6. Report an otherwise eligible write held by the guard as a skipped mapping
   with a distinct reason. Keep one existing DEBUG observation per eligible
   policy evaluation. Its source temperature remains the Home Coach value,
   its corrected temperature is the bounded candidate, and its difference
   describes the candidate relative to the room reading. The final mapping
   outcome records whether the guard held the write.

## Acceptance and documentation

- Cover upward and downward capping, the exact limit, equality, a custom
  limit, and default 5°C behavior in business tests.
- Cover suppression before the threshold, retry eligibility on the threshold
  cycle, counter reset after success and restart, custom cycle limits, and
  invalid or missing room status. Cover changes in the Home Coach reference
  during the wait, resumption on a changed room reading, and independent
  rooms. Cover next-cycle retry eligibility after a timeout
  with an equal reading, fresh evaluation with a changed reading, and
  demonstrate that definitive failures and dry-run do not create pending
  state. Use injected state and gateway fakes to cover startup-restored
  state, successful saves and safe behavior after a failed save. Review
  file creation, validation and atomic replacement in source. Run the
  repository's `npm run check`, `npm test` and `npm run build`.
- Update maintained operations instructions and the environment example.
  Document the unit and default of the cap, the retained pre-write value,
  the retry cycle setting and its interaction with the scheduler interval,
  the timeout and restart rules, save failure recovery, and the need for a
  writable persistent location for container replacement. Keep the runtime
  file out of version control. The planned checks establish local behavior
  without live provider or physical heating evidence.

## Approval

The user explicitly approved the complete specification on 2026-11-23
with “approve” following presentation of the revised cycle threshold.
