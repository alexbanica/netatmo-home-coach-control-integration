# NETATMO-003 — Same-cycle recovery before calibration writes

Status: Approved
Date: 2026-11-18

## Purpose and authority

Recover a rejected cached web session during the affected mapping's current cycle, before any calibration POST is sent. Avoid losing that mapping's update solely because authentication recovery otherwise waits for another mapping or the next scheduled cycle.

Origin: the user requested `$spec-plan a fix for the retry` after the running service showed recurring HTTP 403 calibration-path failures. The user selected the recommended boundary with `do the recommendation`: recover before the write, retain the existing one-password-login-per-cycle limit, and do not replay calibration POSTs. This selection resolves the behavior boundary; it is not approval of this complete specification or authority to implement, deploy, create a release tag, or perform live calibration.

## Baseline and predecessor artifacts

Research baseline: `main` at `d80fdabd37e488eb57391dd5e0e850207f5dc33a` (release 1.0.1). Preserve unrelated `.idea/` content and private configuration.

Read-only predecessors: [NETATMO-001-SPEC.md](NETATMO-001-SPEC.md), including amendments through SPEC-A2, [NETATMO-001-PLAN.md](NETATMO-001-PLAN.md), including its effective amendments, and the [NETATMO-002-SPEC.md](NETATMO-002-SPEC.md)/[NETATMO-002-PLAN.md](NETATMO-002-PLAN.md) health feature. Their content and approval remain unchanged.

The current calibration adapter obtains a web token and verifies it through a read-only app `homesdata` GET before issuing a True Temperature POST. A verification rejection invalidates the token on HTTP 401 or an explicit invalid/expired token/session message, but exits the affected calibration call without recovering it. A later mapping can already log in during the same cycle if the shared login budget is unused. A plain HTTP 403 does not establish session expiry. The current implementation permits only one password-login attempt per synchronization cycle, including initial login.

Live logs reviewed on 2026-11-18 contained 13 HTTP 403 calibration-path outcomes at roughly three-hour intervals, with later-cycle recovery. Debug diagnostics were disabled, so these records do not identify whether verification or the POST failed, the API error body, the number of logins, or the cause of the connection emails. This feature must not be described as a proven remedy for all those incidents.

## Scope and exclusions

Change only pre-write web-session recovery and its sanitized debug diagnostics, plus operational documentation. Keep concrete networking/authentication in infrastructure and preserve the existing application gateway and calibration policy behavior.

Exclude calibration POST replay, retry of generic HTTP 403/forbidden responses, OAuth changes, discovery/status-read retry changes, transport/server-error retry, new configuration settings or dependencies, persistent sessions, scheduler/health changes, Docker/CI/publisher changes, cross-repository changes, automatic deployment, and live login/calibration probes. Existing scheduled recovery remains available outside the narrow recovery boundary.

## Definitions and confirmed decisions

- A cycle is one synchronization-use-case execution. Its login budget is shared by all mappings; it is not reset when recovering a mapping.
- A password-login attempt consumes the existing budget when it starts, whether it succeeds or fails. The initial login and any recovery login share the same maximum of one per cycle.
- Verification is the read-only app `homesdata` request and validation performed before a calibration POST. Recovery never resends a POST already attempted.
- A recoverable session rejection is a completed verification response with successfully parsed JSON that fails verification and either has HTTP 401 or contains the existing explicit invalid/expired token/session message recognized by the adapter. Numeric error codes 2/3 alone do not add a new trigger in this feature.
- A numeric API error code 13 (`Operation is forbidden`) takes precedence and prevents same-cycle recovery, even when the HTTP status or message would otherwise qualify. A generic HTTP 403 without an explicit invalid/expired token/session message is not recoverable.
- HTTP 429, HTTP 5xx, redirects, transport failures, malformed JSON, and structural verification failures without a qualifying authentication signal do not enter recovery. These exclusions take precedence over message matching.
- Recovery is bounded to one restart of the token-acquisition/verification sequence per cycle, and can perform a password login only if the existing shared login budget is unused. No new delay, retry setting, or login budget is introduced.

## Behavior and invariants

R1. Continue reusing the in-memory web token across cycles. Verify it using the existing read-only request before the first candidate write that requires verification in each cycle. Successful verification remains reusable for later mappings with that token. Do not preemptively log in or retry a valid session.

R2. When verification returns a recoverable session rejection before any POST for the affected mapping, clear the rejected token and its verification cache. If the recovery and password-login budgets are both available, consume the recovery opportunity, perform the existing web-login flow once, and verify the resulting token. Do not call `beginCycle` or otherwise reset either budget inside recovery. Login/verification failure terminates this recovery attempt; do not loop.

R3. If a password login has already been attempted in the cycle, do not perform another login. If the replacement token is rejected or login fails, return a sanitized failure for the affected mapping and allow independent mappings to continue under existing rules. No later mapping can reset or bypass the consumed budgets. A qualifying session rejection still invalidates the token when recovery is unavailable, preserving later scheduled recovery.

R4. After successful recovery, resume the affected calibration call before its first POST. Recheck cancellation and invoke the existing source-freshness `beforeWrite` guard after authentication work, immediately before dispatch. If aborted or stale, do not send the POST; preserve the existing skipped/aborted result handling. The normal target-status lookup, rounding, equality no-op, maximum correction, reachability and dry-run rules remain unchanged. No target reread is added because no calibration POST has been attempted during this recovery path.

R5. There is at most one True Temperature POST attempt per mapping per cycle. A failure after POST dispatch never enters this recovery path, including HTTP 401/403, explicit expiry responses, timeout, connection loss, HTTP 5xx, malformed JSON and unexpected success bodies. Preserve existing POST outcome classification, invalidation behavior and the requirement that a later ordinary cycle rereads target status before considering a new write. Recovery introduced here does not change the existing behavior whereby a later independent mapping may authenticate using an unused shared login budget.

R6. Do not infer expiry from a generic HTTP 403 or numeric forbidden code 13. Such verification responses fail without triggering a recovery login. Preserve failure reporting without claiming that permissions were repaired. Neither this feature nor its logs may claim that a successful calibration response proves physical heating behavior.

R7. Preserve HTTP 429 propagation and Retry-After handling from every stage, including recovery login and replacement verification. Rate limits and cancellation stop processing under the existing use-case rules; recovery must not swallow them, restart discovery, bypass the serial scheduler, reset OAuth refresh limits, or create concurrent work. Preserve existing request timeouts and redirect/credential protections.

R8. Add bounded structured DEBUG diagnostics for pre-write recovery started, succeeded and failed. Started means that a recovery login is actually being attempted within the available budgets; succeeded means replacement-token verification succeeded, not that calibration succeeded. Failed means that this started recovery attempt did not complete successfully. Existing verification/login failure diagnostics cover responses for which no recovery starts. Use only fixed event names, bounded outcome/error categories, and permitted HTTP/API codes; do not log bodies, messages, credentials, cookies, tokens, account identifiers, URLs, mapping identifiers or temperatures in recovery diagnostics. Logging failure must not affect synchronization. Default `info` continues to hide these events; `LOG_LEVEL=debug` enables them.

## Delta and regression boundaries

This specification changes NETATMO-001 behavior 9 only by allowing the affected mapping to recover pre-write verification immediately when a confirmed session rejection occurs and its shared login budget is unused. It makes numeric forbidden code 13 an explicit veto for that new verification recovery. It preserves NETATMO-001 behavior 7's prohibition on calibration POST replay, all POST outcome semantics, existing OAuth recovery, in-memory-only credentials/session state, business calibration limits, ordinary scheduling and logging redaction.

NETATMO-002 health meaning and endpoint remain unchanged. Additional bounded authentication work belongs to the same active cycle; it does not reset the health deadline or establish calibration health. No changes to earlier approved artifacts, domain rules, application contracts, private files or unrelated source are required by this specification.

## Acceptance and validation

- A1: Static source inspection and independent review establish that a cached token rejected during verification by a qualifying HTTP 401 or explicit expiry message can cause one login and one replacement verification within the same mapping call, followed by at most its first POST. Successful recovery is not reported as an intermediate failed mapping; the mapping retains one final business outcome.
- A2: Review covers budget sharing across mappings, initial-login budget exhaustion, failed login, repeated rejection of a replacement token, cached successful verification, and next-cycle reset. No path permits more than one password login or recovery restart per cycle, or more than one calibration POST per mapping per cycle.
- A3: Review confirms no recovery for plain 403, numeric code 13 even with HTTP 401/expiry wording, standalone numeric codes 2/3, HTTP 429/5xx, redirects, transport failure, malformed JSON or unrelated structural rejection. POST failures never enter recovery. Current failure/indeterminate semantics remain unchanged.
- A4: Review confirms cancellation and the source-age guard after recovery, unchanged dry-run/no-op/correction limits, preserved rate-limit propagation and request protections, and sanitized DEBUG diagnostics with default suppression.
- A5: With Node.js 24 and the checked-in lockfile, run `npm ci`, `npm run check`, `npm test`, and `npm run build`. Retain the permitted business-only domain/application suite. Do not add authentication, HTTP, logging, configuration, scheduler, startup or container tests, fixtures, or inline runtime probes as substitutes. No new infrastructure test category is authorized.
- A6: Update `docs/operations.md` to explain the exact pre-write triggers and exclusions, shared budget, lack of POST replay, debug diagnostics, and that the previously observed generic 403 incidents cannot be attributed or declared fixed from existing logs alone.
- A7: Change review confirms preserved predecessor artifacts, `.idea/`, private `.env.local`/`config.json`, Docker/CI/publisher definitions, and no new environment setting, persistence, external endpoint, or release/deployment effect.

Static checks and existing business tests do not establish real Netatmo session-recovery behavior, email frequency, or physical heating response. Authentication/HTTP infrastructure tests and live login/calibration validation are excluded from this deliverable's acceptance scope, consistent with repository instructions. Record these omitted results explicitly; do not claim them as passed or import prior physical acceptance as a new prerequisite. Any subsequent operational observation requires separately authorized deployment and read-only investigation.

## Documentation and approval

The later PLAN must map R1–R8 and A1–A7 to bounded ownership, independent code and external-contract review, permitted validation, and operational documentation. Implementation and delivery details remain for the separate PLAN gate.

Approved by the user on 2026-11-18 with `approve` in response to presentation of this complete specification. Approval covers R1–R8 and A1–A7, including the pre-write-only recovery boundary and excluded infrastructure/live validation. PLAN approval remains separate; no implementation, commit, push, tag or deployment is authorized in this human-invoked planning session.
