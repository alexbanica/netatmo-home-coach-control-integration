# NETATMO-001 — Implementation plan

Status: Approved
Date: 2026-11-13
Approval: Explicit user PLAN approval on 2026-11-13 ("approve") for the complete independently reviewed plan.

## Authority and approved inputs

Approved SPEC: `docs/specs/NETATMO-001-SPEC.md`, approved 2026-11-13 by user reply “approve”. SHA-256: `7c772dd9657e0594a7a6c1b7ddaade26741e2301808eab48aba41d3f06ef0474`.

Implement exactly that complete specification. No previous approved plan exists. This PLAN introduces execution choices only; the approved SPEC remains unchanged. User requires a feature branch and separate worktree. This human-invoked spec-plan session remains planning-only: after PLAN approval, implementation must begin in a new assistant conversation using implement with both exact artifact paths.

## Verified baseline and workspace/delivery

- Invoking checkout: `/home/alexbanica/workspace/netatmo-home-coach-control-integration`, branch `main`, HEAD `853f3ce692e3c4d1053f5361cb593c8c1c45f4a2` at planning time. Remote origin: `https://github.com/alexbanica/netatmo-home-coach-control-integration`.
- Existing unrelated untracked `.idea/` is preserved. `.env.local` is ignored and private. Planning adds only this pair of documents.
- Exact delivery branch: `feature/netatmo-homecoach-true-temperature`.
- Exact worktree: `/tmp/agent-worktrees/netatmo-home-coach-control-integration/netatmo-001`.
- Planning does not create that branch/worktree. At implement entry, refresh origin. Prefer the verified existing remote delivery branch for continuation; otherwise use refreshed `origin/main`, with `origin/master` fallback only if main is unavailable. Record selected ref and resolved SHA before source edits. Planning-time HEAD is orientation, not a frozen implementation base.
- For a new branch, create a detached isolated worktree at the refreshed base; immediately before the first commit, verify the branch is absent locally and unattached, then create the exact branch at the verified detached HEAD. Do not reuse a conflicting local branch. Subsequent checkpoints resume the verified delivery branch and preserve ancestry. Use implement's guarded reconciliation, detach and recovery procedure.
- An absent target path is expected. If the exact path is registered but missing, remove only that registration via non-forced `git worktree remove`, verify removal and recreate. Any conflicting, dirty or unsafe present state stops as DRAFT; never force cleanup or change unrelated worktrees.
- Before transferring artifacts, capture their exact content, invoking HEAD and index states. Copy the approved files byte-for-byte to the isolated worktree and verify hashes. Preserve unchanged recoverable invoking state until verified delivery. Restore only unchanged transferred artifact content/index per implement; never remove unrelated edits or credentials.
- No credentials are copied automatically. Mocked development/CI uses no account secrets. Any separately authorized live check may load the existing `.env.local` by absolute path without copying it to tracked content or build context.
- Following PLAN approval and valid implement entry, parent commits all accepted source, tests, docs and artifact paths in the feature worktree and pushes non-force to `origin/feature/netatmo-homecoach-true-temperature`; verify remote SHA, configured upstream and accepted artifacts. No main merge, PR mutation, registry publish or deployment is authorized. After a verified ordinary push, follow implement's clean detach/retention and unchanged-transfer restoration rules. If incomplete, deliver an explicitly labeled DRAFT checkpoint where possible, never claim completion.

## Implementation decisions and no-research boundary

Use JavaScript ES modules on Node.js 24 LTS, built-in `node:test` and strict assertions. Commit `package-lock.json`; use `npm ci`. Use a minimal standards-compliant cookie-jar dependency (`tough-cookie`) for direct web-login HTTP, not the unofficial Netatmo client. Application HTTP uses Node fetch with manual redirects, verified HTTPS Netatmo host allowlists, bounded request timeouts and test-injected transport/clock. The cookie adapter must obey domain/path/secure rules, follow redirect limits and browser POST-to-GET semantics, and never forward credentials or Bearer headers across unintended origins. Use maintained ESLint for static checks. Record exact resolved dependency versions in the lockfile; validate engine compatibility.

`npm start` launches `src/index.js`; local `npm run start:local` uses Node `--env-file-if-exists=.env.local`; existing process variables retain precedence. `npm run check` runs lint and JavaScript syntax checks; `npm test` runs deterministic unit/contract/integration tests; `npm run test:container` exercises container acceptance with fake credentials/fixtures only. Example JSON uses generic names and documents exact-name Unicode handling.

Runtime consists of validated config, bounded HTTP transport, separate OAuth and web authentication, Netatmo read/write adapters, mapping/sync logic and serial scheduler. Use one active cycle and sequential room writes. Authentication/session state and rotated refresh credentials stay in memory; no secret persistence. Canonical endpoint paths and fields come from approved SPEC plus this session's observations. Developer assignments use these inputs and narrowly named source patterns; do not reopen broad API research or add alternative control strategies. A changed API contract or missing required behavioral fact pauses the affected work for an implement amendment or a genuine missing-input blocker; do not guess success schemas.

The JSON config has `mappings` only, with each record containing the three SPEC keys. Validate environment/config strictly before network work. Unknown config keys fail to expose typos. Store no personal IDs in examples. Dry-run must not obtain a web session merely to simulate a write; it can use OAuth read discovery and calculate intended operations without using the password.

Success parsing for True Temperature must validate the expected top-level successful status (e.g. `status: "ok"`); HTTP status alone is insufficient. Until live success is observed, fixtures represent an explicitly assumed parser contract, not measured server output. Unexpected formats are indeterminate per SPEC and keep live acceptance pending.

## Sanitized protocol handoff for clean-context implementation

The following details are retained from the parent's actual probes in this conversation (2026-11-13), not credentials or account-specific IDs. Request shapes and the named fields were consumed successfully by the probes. Arrays shown are structural excerpts, not full vendor schemas. Extra response fields are ignored; absent required fields fail safely per SPEC. No developer needs access to the earlier conversational transcript or `/tmp` scripts.

### OAuth reads and refresh

All reads use `Authorization: Bearer <ACCESS_TOKEN>` over HTTPS. `GET https://api.netatmo.com/api/gethomecoachsdata` returns `body.devices[]`; each device has `module_name` (probe fallback: `station_name`), `dashboard_data.Temperature` and `dashboard_data.time_utc` (Unix seconds). Resolve a source against `module_name` when present, otherwise `station_name`; reject ambiguity. This exact probe extracted named devices, numeric temperatures and timestamps successfully.

`GET https://api.netatmo.com/api/homesdata` returns `body.homes[]`, with each home `id`, `name`, and `rooms[]` containing `id` and `name`. `GET https://api.netatmo.com/api/homestatus?home_id=<resolved id>` returns `body.home.rooms[]`, with `id` and `therm_measured_temperature`. Match status records by resolved room ID, never by array order. Query encoding must use URLSearchParams. Missing room/status/temperature and explicit unreachable indicators skip that target; do not invent an offline flag when none is present. Read data has no proven per-room observation timestamp; document that a fresh HTTP response is not proof of a fresh physical measurement.

OAuth refresh uses the documented standard token operation `POST https://api.netatmo.com/oauth2/token`, form encoded `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`. Expected JSON has `access_token`, `expires_in` and optional rotated `refresh_token`; retain the previous refresh token only when a replacement is absent. This refresh operation was not live-tested in planning. Contract fixtures test it without real credentials; authentication rejection never permits a password-grant fallback. Scopes for provisioning: `read_homecoach`, `read_thermostat`, `write_thermostat`. The latter does not establish True Temperature compatibility; the tested token was rejected there.

### Web authentication: observed successful sequence

Use a dedicated in-memory cookie jar with User-Agent `netatmo-home` and auth base `https://auth.netatmo.com`:

1. GET `/en-us/access/login`; initial response was HTTP 200. Follow permitted HTTPS Netatmo redirects, retaining cookies according to domain/path rules.
2. Set cookie `netatmocomlast_app_used=app_thermostat` with domain `.netatmo.com`.
3. GET `/access/csrf`; observed HTTP 200 JSON containing `token`. Retain that CSRF value only in memory.
4. POST `/access/postlogin` as form data: `email=<NETATMO_USERNAME>`, `password=<NETATMO_PASSWORD>`, `stay_logged=on`, `_token=<CSRF token>`. Observed final HTTP 200. Do not treat that status alone as successful authentication.
5. GET `/access/keychain?next_url=https%3A%2F%2Fmy.netatmo.com`; observed final HTTP 200. Extract the resulting `netatmocomaccess_token` cookie and percent-decode its value. Token/cookies never go to logs or disk.
6. No cookie, challenge page or unexpected login response means no valid session. Confirm usable access through app `homesdata`/`homestatus` reads; HTTP 200 on the login page is insufficient.

Redirect limits and host verification apply before every request. Credentials are submitted only to `auth.netatmo.com`; the extracted Bearer token is explicitly sent only to `https://app.netatmo.net/api/` operations. Retain cookies within their original domains rather than copying all cookies across hosts. The successful probe did not need cookie persistence or a browser. It did not encounter MFA/CAPTCHA; such responses are stop conditions, not supported bypass flows. The sequence is based on directly tested requests, also corroborated by these research-only sources:
- https://github.com/py-netatmo-unofficial/py-netatmo-truetemp/blob/main/src/py_netatmo_truetemp/auth_manager.py
- https://github.com/py-netatmo-unofficial/py-netatmo-truetemp/blob/main/src/py_netatmo_truetemp/constants.py

### App reads and calibration: observed behavior

With the web-session Bearer token, `GET https://app.netatmo.net/api/homesdata` and `GET https://app.netatmo.net/api/homestatus?home_id=...` returned HTTP 200 with the same discovery/room fields described above. The service can use OAuth for all normal reads; these app reads serve authentication verification and protocol fixtures.

Calibration is `POST https://app.netatmo.net/api/truetemperature` with `Authorization: Bearer <web token>`, `Content-Type: application/json`, and JSON `{home_id: <resolved home ID>, room_id: <resolved room ID>, current_temperature: <fresh target number>, corrected_temperature: <source number>}`. One equal-value request using the OAuth token returned HTTP 403 and `{error: {code: 13, message: "Operation is forbidden"}}`; one equal-value request using the web token returned HTTP 406 and `{error: {code: 7, message: "Nothing to modify"}}`. That exact combination is the only observed non-error-like calibration result and must be classified as a no-op, not a successful changed calibration. A code 13 forbidden result must not trigger repeated logins as though proven expiry. HTTP 401 or explicit invalid/expired token errors may invalidate a session once per cycle; unknown failures do not silently cause write replay.

The actual server success body for a changed calibration is unobserved. A `status: "ok"` success fixture is an explicit conservative assumption, not live evidence. Unknown response formats yield indeterminate and preserve the live acceptance gap. Do not infer physical control, accumulated calibration limits, refresh lifetime or hardware measurement freshness from these observations. Only a separately authorized live test can close A5; no protocol research or fixture can substitute for it.

## Assurance profile and domain assessment

Select **full assurance**: executable authentication, secrets and third-party API interactions disqualify routine. One business domain is involved: room-temperature reference calibration. Source sensor reads, OAuth/web authentication, scheduling, packaging and CI are technical parts of that domain; no independent interacting business domains are introduced. Architect planning assurance is therefore not triggered.

Required: independent plan-readiness-reviewer before approval; bounded developer assignments; one integrated independent code-review wave; contract-reviewer covering new external API requests/authentication/response semantics and fixtures; one consolidated accepted correction batch and affected checks; final independent qa-agent; documentation-writer once after final QA; parent acceptance and Git verification. Security-reviewer is not selected because the user has not explicitly requested a security review; credential/redirection/redaction checks remain mandatory development, code-review and QA criteria. Parent retains integration, requirements and delivery authority.

All assignments use fresh contexts, stable unit IDs and exact artifact/source hashes. Children never branch, commit, push, create worktrees or deploy; preserve others' work. Each final/partial report is exactly one JSON object with expected unit_id, status complete/partial/blocked and relevant coverage/evidence/findings/changes/validation/blockers. Aim three minutes and interrupt at five minutes; split bounded successors with verified evidence, never extend an unchanged timeout. Parent reconciles ownership before reassignment. Serialize shared package/config/lockfile changes and repository-wide checks.

## Delivery units and ownership

Execute U1 → U2 → U3 → U4 → integrated assurance → U5 → final reconciliation. Developer tasks may be subdivided only along these ownership boundaries; no parallel overlapping writers. Tests stay with their production units and are written first where practical. No existing policy forbids test-first work. Every child handoff leaves parent obligations active.

| Unit | Owner and exclusive paths | Prerequisites | Work and completion evidence |
| --- | --- | --- | --- |
| U1 Foundation/config | developer; `package.json`, `package-lock.json`, `eslint.config.js`, `src/config.js`, `src/logging.js`, `test/config.test.js`, `test/logging.test.js`, `.env.example`, `config.example.json`, `.gitignore` | parent prepared workspace/artifact hashes | Strict env/JSON validation, config defaults, duplicate-target checks, sanitized logging and local launch commands; syntax/lint and focused config/redaction tests pass. Preserve existing ignore content. |
| U2 Transport/auth/API | developer; `src/http.js`, `src/oauth.js`, `src/web-session.js`, `src/netatmo.js`, `test/http.test.js`, `test/oauth.test.js`, `test/web-session.test.js`, `test/netatmo.test.js`, `test/fixtures/**` | U1 accepted | Direct OAuth reads and optional refresh; direct CSRF/login/keychain cookie flow; timeout/redirect/rate-limit controls; strict temperature-write classification and no replay; adversarial mocked protocol tests pass without credentials. Package changes, if needed, return to serialized U1 ownership. |
| U3 Sync/runtime | developer; `src/sync.js`, `src/scheduler.js`, `src/index.js`, `test/sync.test.js`, `test/scheduler.test.js`, `test/service.test.js` | U1,U2 accepted | Mapping uniqueness, fresh data, offline skips, rounding/5°C guard, no-op/dry-run, serial scheduling, signal behavior and failure isolation; fake-clock and mocked end-to-end service tests pass. |
| U4 Container/CI | developer; `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `scripts/test-container.mjs`, `test/fixtures-container/**` | U1–U3 accepted | Locked Node 24 image build, non-root process, no secrets in image/context, correct signal propagation; CI runs npm ci/check/test and build/container smoke with no secrets. `scripts/test-container.mjs` uses image argument or fixed local test tag; no registry operations. |
| U5 Final documentation | documentation-writer; `README.md`, `docs/operations.md` | integrated reviews, corrections and final QA assessed | Document all A6 items against final behavior; author exact config/env and container commands; expose pending live acceptance. No production edits. Parent checks commands against scripts and verified validation. |

Parent alone owns `docs/specs/NETATMO-001-SPEC.md`, this PLAN and final acceptance evidence. Evidence may be recorded in PR/delivery report; no persistent approval sidecars or extra workflow state files. Parent reruns only checks affected by documentation or correction changes.

## Requirement-to-delivery trace

References below are precise anchors in the approved SPEC; numbered behavior references mean its numbered synchronization invariants.

| SPEC anchor | Units / paths | Validation or terminal evidence |
| --- | --- | --- |
| Purpose; Scope/exclusions; Regression/preserved behavior | U1–U5; all owned paths, parent artifact/Git boundary | Integrated diff inspection; no setpoint endpoints/unofficial client/live deployment; private files and LICENSE preserved. |
| Configuration and definitions: mapping/schema/startup validation; A1 | U1 config/examples; U3 resolution | Invalid and duplicate config, Unicode/ambiguous names, missing sources and target identity tests; invalid startup has zero POSTs. |
| Configuration: OAuth/web credentials, config path, env precedence; behavior 8–9; A2 | U1,U2; config/auth tests | Token-only vs refresh mode, rotated in-memory refresh, expired tokens, challenge/no-cookie failure, one login per cycle, no secret persistence; inherited env wins over local file. |
| Configuration: interval/max age/dry-run/restart; behavior 1–4; A3 | U1,U3; sync/scheduler tests | Startup cycle, configurable delay, invalid settings, source freshness/future skew, offline data, rounding and >5°C skip; fresh target for every candidate write; no stale-cycle fallback. |
| Behavior 5–7; A2,A3 | U2,U3; netatmo/sync tests | Exact payload and correct token, specific 406 no-op, real errors/malformed success indeterminate, no POST replay on timeout/server/auth failures, no write in dry-run. |
| Behavior 10; A3 | U2,U3; HTTP/scheduler tests | HTTPS/host/redirect credential restrictions, 25-second timeouts, sequential writes and rate-limit cycle halt; valid Retry-After respected beyond normal delay. |
| Behavior 11; A4 | U3,U4; scheduler/service and container smoke | SIGINT/SIGTERM, pending timer cancellation, in-flight bounded shutdown, no subsequent POST; one instance operating instruction. |
| Behavior 12; A2,A3 | U1–U3; logging/auth/service tests | Structured per-mapping results and redaction across auth/HTTP/exception cases; no raw bodies or credentials in errors. |
| Docker and GitHub Actions; A4 | U4; Dockerfile/workflow/container script | Build and run no-secret fixtures; inspect effective UID and image contents/history; invalid-config exit and signal smoke; workflow read-only permissions and no live calls/push. |
| Evidence/limits; A5 | parent live boundary; U5 docs | Prior test evidence preserved; controlled nonzero write requires separate authority; missing live acceptance makes delivery DRAFT, not fabricated success. No source-only test satisfies physical response. |
| A6 documentation | U1 examples,U5 README/operations | Full env/config schema, provisioning, refresh restart limits, direct web login risks, dry-run, Docker/CI and recovery; command parity check. |

## Validation and integrated lifecycle

Development executes focused tests per unit, then parent serializes `npm ci`, `npm run check`, `npm test`, `git diff --check`, `docker build -t netatmo-homecoach:netatmo-001 .`, `npm run test:container -- --image netatmo-homecoach:netatmo-001`. Tests use in-memory/in-process mock transport and fake clocks rather than the user's Netatmo account; no private environment file is loaded by npm test or CI. Container fixtures are explicitly synthetic and exercise actual production startup and signal handling. Check image configuration/history and build context exclusions without printing private files. Tests include secret canaries that must never appear in captured logs.

U4 CI triggers on pull requests, pushes to main, and pushes to the exact delivery branch `feature/netatmo-homecoach-true-temperature` so feature delivery gets exact-head checks without creating a PR. The extra feature trigger preserves the SPEC-required main and pull-request events. CI runs the same checks and container smoke on GitHub Ubuntu runners with Node 24 and Docker; no hosted result is claimed from local YAML inspection. Network/dependency/Docker unavailability is an evidenced check blocker, not grounds to delete checks. After push inspect exact-head GitHub checks with available GitHub capability/gh; pending or failed required CI keeps DRAFT. Avoid unbounded waits and report the exact unresolved check if external capability is missing.

At integrated review freeze source SHA/diff against the recorded base and provide artifacts/hashes, trace, all tests and unresolved criteria to code-reviewer and contract-reviewer. Wait for both, dispose supported findings together, give bounded corrections to the owning developer and rerun affected validation. Run independent QA on the integrated result, including credential-safety, scheduler/container behavior and trace coverage. QA must not use credentials or issue calibration writes. Qualifying acceptance failures/regressions require another bounded correction cycle; speculation alone does not. After QA, documentation-writer synchronizes U5; parent verifies no semantic mismatch and performs final diff/checks.

Live A5 is currently unmet. This PLAN grants no nonzero test authority. Continue all safe implementation, deterministic assurance and documentation, then commit/push DRAFT if live authority/evidence remains unavailable. Do not request routine permission at unit or assurance boundaries. A subsequent separately authorized live test must identify room, reference/correction, allowed effect and observation; it must not be inferred from the earlier zero-adjustment test. The service's automated behavior can be implemented, but must not be run against live credentials during development without specific authority.

## Completion, checkpoints and recovery

At each reached checkpoint parent reports sequential Checkpoint XX, completed/upcoming work and verified commit/push state. A child result, test pass or checkpoint commit is intermediate; next ready work continues. No continuation prompt is needed after valid implement entry.

Completion requires every approved SPEC criterion, required reviews/corrections, independent QA, documentation, local/container checks, exact-head CI and verified accepted commit/push to the feature branch. A5 cannot be claimed until authorized live evidence exists. Without it, report blocked DRAFT with exact remaining criterion and completed source assurance, while preserving all authorized delivery evidence. No merge or deployment follows.

Stop only affected work for incompatible/missing API behavior, unsafe state, missing external authority, unavailable dependencies/check capability or failed workspace/Git verification. Complete independent safe work first. Preserve evidence and use implement's in-session amendment procedure where required; no silent behavior change, scope expansion or downgrade of acceptance. Temporary specialist capacity saturation means queue and continue/wait, not a terminal blocker. All child assignments retain bounded deadlines and JSON evidence.

## Plan assurance record

Independent readiness review `netatmo-001-readiness` completed against SPEC hash `7c772dd9657e0594a7a6c1b7ddaade26741e2301808eab48aba41d3f06ef0474` and initial PLAN hash `8ee426f0eb50196085d762059c05ccb4a074bee2695c37aafc704c43fa2c31e2`. Coverage: full artifact consistency/trace, workspace/base/branch, ownership/sequencing, assurance/validation/delivery and live DRAFT scope. Two high-severity findings: missing durable clean-context protocol details and absent feature-push hosted CI trigger. Both are corrected above with a provenance-labeled protocol handoff and exact delivery-branch trigger preserving required PR/main events. Follow-up `netatmo-001-readiness-followup` reviewed corrected PLAN hash `0d951ee4e6050bbd087dd11350072f9540652fe7031d43c81afae8d17d18fb55` against the unchanged approved SPEC; both findings were resolved and no residual readiness inconsistency was found. This final change records that review only. Prior complete coverage was retained with focused verification of protocol and CI interactions; observed protocol evidence was not independently reproduced and live A5 remains unmet. Architect: inapplicable, single business domain as assessed above. User approval remains separate from advisory review.

## Approval record

Approved by the user on 2026-11-13 with "approve" in response to the complete reviewed PLAN presentation (pre-approval SHA-256 `e407fc42ed08be0e2b05e8b28e84c05f4b68ab6e132a13d076b7ef4232196658`). Approval plus a new-session implement invocation authorizes the planned implementation/review/QA/docs/feature-branch commit and push lifecycle, not deployment or live calibration writes.

## Amendment 1 — 2026-11-13 — DRAFT pull request delivery

- Amendment ID: NETATMO-001-PLAN-A1
- Previous version: original approved PLAN
- Approval: Approved under originating implement request and explicit user direction
- Request and purpose: User replied "create a draft pr" during implement entry to resolve the delivery conflict.

### Changes against the previous version

| Section / requirement | Before | After | Reason |
| --- | --- | --- | --- |
| Workspace/delivery and CI | No PR mutation; feature push checks without a PR | After verified feature push, create and verify one DRAFT PR targeting main with the exact published feature head; retain feature-push CI | Explicit user authorization and implement delivery requirement |

### Preserved behavior and impact

SPEC is unchanged. Feature branch, separate worktree, scope, full assurance, checks and live A5 boundary remain unchanged. No merge, deployment or live calibration is authorized. One business domain remains; architect planning assurance is inapplicable. Independent readiness review of this complete effective PLAN is required before source assignment.

### Approval record

On 2026-11-13 the user explicitly instructed "create a draft pr". The originating implement request automatically authorizes this required implementation amendment; approval covers the complete effective PLAN with only this delivery delta. Readiness evidence will be appended after review.

### A1 readiness dispositions and delivery guards

Independent readiness `NETATMO-001-PLAN-A1-readiness` reviewed complete PLAN SHA-256 `9f03d15f341ac96f92334f4a71b096a335f52e8e7b96ec889da13a7fb41572d3` and unchanged SPEC. Two medium contingency gaps are resolved here: verify remote main exists before PR creation; if absent, retain blocked DRAFT and never silently retarget. Reconcile existing PRs read-only before creating one: reuse only a matching draft with base main, exact feature branch and verified published head; an incompatible existing PR blocks mutation rather than authorizing retarget/conversion. Inspect exact-head required checks after PR creation as well as feature push; pending, failed or unavailable checks retain DRAFT. Review was advisory; user and automatic amendment authority are recorded above. This disposition adds delivery guards only and preserves all prior scope.

## Amendment 2 — 2026-11-13 — Business-only tests and Forgejo publisher

- Amendment ID: NETATMO-001-PLAN-A2
- Previous version: NETATMO-001-PLAN-A1
- Approval: Automatically approved after independent readiness assurance and supported-finding disposition under the active implement request
- Request and purpose: Implement the user's exact instructions "should not have infrastructure tests - containers. unit tests should be done only on business logic" and "should use forgejo integration as other nodejs projects to publish the docker image".
- Effective SPEC: NETATMO-001-SPEC-A1, automatically approved; complete file SHA-256 e3d4e82fd0832da9acbc26ff8c82c071a123dbb1face2d40e908e06bc5cda66b.

### Changes against the previous version

| Section / requirement | Before | After | Reason |
| --- | --- | --- | --- |
| Validation and U1–U4 test ownership | Broad infrastructure/integration/container tests and CI image build/smoke | Business-only test/sync.test.js with injected client/clock; remove other test modules, container fixtures/helper and test:container script. Static lint/syntax remains. Remove CI image build/smoke; publisher owns functional image build | Explicit named user exclusion; prior evidence is historical, not mandatory or newly claimed |
| Docker and CI/release boundary | Image publication excluded | New .github/workflows/publish-docker-images.yml follows sibling tag-push publisher conventions for Forgejo ARM64 images; existing Dockerfile/base unchanged | Explicit publishing request |
| Delivery workspace | Published, clean detached worktree at eac4abc1bdc68040ef21a23d850e2d34a4dbb2b3 | Refresh origin/feature/netatmo-homecoach-true-temperature, verify ancestry/equality and clean retained worktree, then reattach exact branch and append a non-force correction commit to existing DRAFT PR #1 | Continue verified existing delivery; no new branch, PR, worktree or main mutation |

### Preserved behavior and impact

Keep all production src/** files and Dockerfile unchanged. Preserve runtime safety fixes; deleting their infrastructure tests does not revert the fixes or claim current infrastructure validation. Keep existing SPEC/PLAN bodies/status/history and append-only amendments. Preserve private/IDE content in invoking main. Continue full assurance: one independent code review, external publication-contract review, a consolidated supported correction batch, independent QA restricted to business tests/static checks, then documentation-writer and parent Git/PR verification. No security-reviewer trigger exists; no explicit security review was requested. Architect planning assurance is inapplicable: publication is a technical delivery stage, not a second interacting business domain.

### Evidence and publishing decisions

Read-only explorer NETATMO-001-FORGEJO-PATTERN inspected current local sibling workflows: still-good-api HEAD fc70af7c32d76ded3c11d78fded091b9e9050a06, .github/workflows/publish-docker-images.yml:4–123, and service-availability-scheduler HEAD b67ce59aebec46d6515b1fa6e3d36259d177c519, matching workflow:13–86. Reuse registry forgejo.alexlab.nl, namespace alexlab, native ubuntu-24.04-arm, read-only contents permission, exact tagged checkout, lowercase tag validation/128-character suffix bound, secrets FORGEJO_REGISTRY_USERNAME and FORGEJO_REGISTRY_TOKEN, matching release/latest push digests and unconditional credential cleanup. The explorer's initial Homebridge-target inference was explicitly withdrawn; this target is netatmo-home-coach-control-integration with its existing bookworm-slim Dockerfile.

Use a single publishing job. Trigger only non-deleted tag pushes (tags: ['*']); never PR/feature/main branch publication. Check out github.sha with persist-credentials:false, pin the sibling checkout action 3d3c42e5aac5ba805825da76410c181273ba90b1 and registry login action dbcb813823bdd20940b903addbd779551569679f. Before login, validate ^[a-z0-9_][a-z0-9._-]*$ and the complete image-tag length, run npm ci/check/test, and check native runner architecture. Build Dockerfile at repository root for linux/arm64 with tags forgejo.alexlab.nl/alexlab/netatmo-home-coach-control-integration:<tag>-node24-bookworm-slim and :latest-node24-bookworm-slim. Add OCI version/revision labels directly to docker build; no unused build args or package-version equality gate. Do not change the existing pinned runtime base.

Use isolated temporary DOCKER_CONFIG, login-action secrets, shell fail-fast/pipefail, two docker pushes and captured digest receipt checks. Require valid matching sha256 digests in both push receipts and write image references/digests to GitHub job summary. Inspect built image architecture as delivery metadata only; never run a container or smoke/infrastructure test. Always logout and remove temporary credential material without printing credentials. No registry credentials on ordinary CI or pre-validation steps. No secret provisioning, tag creation, registry mutation from this assistant session or deployment follows from source implementation. Actual tag-triggered publication is pending release authority/version and registry credentials; current repository-level secret-name inspection returned none, and no secret value was read. This pending evidence must be explicit in final delivery.

### Delivery units and ownership

| Unit | Exclusive ownership | Prerequisites | Evidence |
| --- | --- | --- | --- |
| T — business test correction | developer; package.json, optional lock metadata, .gitignore, test/**, deleted scripts/test-container.mjs | Explicit named user test-scope exclusion; no amendment prerequisite required for this exclusion | Already completed eight injected-client business cases and static check; parent verifies test scope and removed infrastructure assets |
| F — publisher and CI | developer; .github/workflows/ci.yml and .github/workflows/publish-docker-images.yml | Effective SPEC approval and PLAN readiness assurance | Tag guard, image/secret naming, exact source/ARM64 publication, bounded receipt checks/cleanup; CI only locked install/check/business tests; static source inspection without container tests or registry effects |
| D — final docs | documentation-writer; README.md and docs/operations.md | Integrated review corrections and reduced-scope QA | Remove obsolete container-test commands/claims; explain business tests, Forgejo tags/platform/secrets/trigger and pending actual publication/A5 |

Parent owns SPEC/PLAN, interpretation, source integration, commits/pushes, DRAFT PR #1 metadata and exact-head checks. Workers preserve other edits, never Git/delivery mutations; five-minute bounded assignments and exact JSON evidence remain mandatory. Review/QA handoffs include eac4abc baseline, full actual diff, effective hashes and the named exclusions. No additional infrastructure test or container execution is authorized under the reduced scope.

### Requirement-to-delivery trace

| Effective requirement | Unit / paths | Validation or terminal evidence |
| --- | --- | --- |
| User business-only tests; revised A1–A4 evidence scope | T; test/sync.test.js, package.json, deletions | Only business-rule imports and injected client/clock; mapping/freshness/rounding/no-op/5°C/dry-run/failure/no-replay/abort cases; npm test and npm run check |
| Runtime invariants and prior accepted safety fixes | Parent source boundary src/** | No production source diff; code review checks preservation, not replacement infrastructure tests |
| SPEC-A1 Docker publication contract and event/auth/tag boundaries | F; publisher workflow | Independent static code/contract review of exact trigger/source/tag/namespace/platform/secrets/cleanup and receipt handling; actual publication pending tag/credentials, not fabricated by unit tests |
| CI scope and exclusions | F; ci.yml, T deletions | Existing PR/main/exact-feature triggers retained; static checks and business units only; no container build/smoke in ordinary CI |
| A6 | D; README/operations | Parent command and workflow parity check; excluded evidence and publication prerequisites disclosed |
| A5 and delivery | Parent; existing feature branch/DRAFT PR | No live calls; A5 remains unmet; verify appended commit/upstream, PR head and final-head CI, clean detached retained worktree |

### Approval record

Originating implement plus the two exact user instructions automatically authorize this complete effective PLAN revision after independent readiness review and disposition of supported findings. The test exclusion itself is already authoritative and is not blocked on amended artifacts. Registry publication configuration expands the original exclusion under explicit user authority; no new tag, credential or deployment authority is inferred. Readiness evidence and final automatic approval are recorded below after review.

### A2 readiness disposition and complete effective approval

Independent NETATMO-001-PUBLISH-READINESS reviewed SPEC SHA-256 e3d4e82fd0832da9acbc26ff8c82c071a123dbb1face2d40e908e06bc5cda66b and proposed PLAN SHA-256 18e73e4b4cf5cb4505956d44c97e5656a47b90399a93a9ed52e7fec2a170e6c5 across consistency, trace, publisher boundaries, sequencing, assurance and delivery. One medium workspace-sequencing finding is resolved: refresh/equality/clean-detached verification and branch reattachment were already completed before T edits. The current valid state is the exact feature branch attached at eac4abc with matching upstream, intentionally dirty only for authorized T changes and append-only artifacts. Before F assignment, verify this branch/upstream and reconcile the expected changed paths; preserve those changes. Do not repeat worktree preparation or demand a clean state after authorized edits. This supersedes any future-tense wording in the workspace row above.

Parent verified eight business tests/static checks and unchanged production source. Additional existing business-rule cases may be preserved in test/sync.test.js without adding infrastructure imports, real timers, network or container tests. This is business coverage within T, not a new validation category. The complete effective PLAN through NETATMO-001-PLAN-A2 is automatically approved on 2026-11-13 under the originating implement request and explicit user instructions, following readiness review and this supported finding disposition. Original document status and prior content/approvals are preserved. No manual user review of this generated revision is claimed.

## Amendment 3 — 2026-11-13 — Reject the reserved release alias

- Amendment ID: NETATMO-001-PLAN-A3
- Previous version: NETATMO-001-PLAN-A2
- Approval: Automatically approved after independent readiness assurance under the active implement request
- Effective SPEC: NETATMO-001-SPEC-A2, automatically approved; file SHA-256 f55e3c60e7e5ea512bec3b035ee9f9a1505e2f85993a7e83401a7dc7c90779bf.
- Request and purpose: Resolve the supported medium reserved-tag collision reported by independent NETATMO-001-REVISED-CONTRACT. NETATMO-001-REVISED-CODE found no other correctness defects in the complete changed boundary.

### Changes against the previous version

| Section / requirement | Before | After | Reason |
| --- | --- | --- | --- |
| F tag pre-validation | Syntax/length checks allow Git tag latest | Also fail when the Git tag is latest, before dependency installation, credentials, build or push | Keep release and moving aliases distinct |

### Preserved behavior and impact

All PLAN-A2 decisions, source ownership, full assurance, user business-test exclusion, exact image/platform, secret names, cleanup and delivery remain. src/** and Dockerfile stay unchanged; no infrastructure tests or container execution are added. One business domain remains; architect planning assurance is inapplicable. No published tag/image exists for this delivery, so no migration or retag action is required.

### Requirement-to-delivery trace and correction unit

The publisher owner makes one bounded change to .github/workflows/publish-docker-images.yml only: reject reserved tag latest in the existing pre-validation step, with a fixed credential-free diagnostic. Evidence is static code/contract review disposition, YAML parsing/bash syntax, unchanged business suite and restricted final QA; no infrastructure test harness is introduced. The prior full code/contract reviews covered the complete staged boundary at tree b5a6bd8d5e849e96e1d78db9f2a8439a7a5bcaee, SPEC-A1 and PLAN-A2. Only this accepted correction follows that wave; final independent QA assesses it and the existing reduced scope, followed by documentation synchronization and verified non-force push to existing PR #1. Actual publication and A5 stay pending their stated external prerequisites.

### Approval record

The complete effective PLAN through NETATMO-001-PLAN-A3 is automatically authorized after mandatory independent readiness review and supported-finding disposition under the originating implement request. This is a correction inside the current consolidated review cycle, not a new routine approval or continuation gate. Readiness outcome and final automatic approval follow below.

### A3 readiness and complete effective approval

Independent NETATMO-001-ALIAS-READINESS reviewed complete effective SPEC SHA-256 f55e3c60e7e5ea512bec3b035ee9f9a1505e2f85993a7e83401a7dc7c90779bf and proposed PLAN SHA-256 f920223f26754e901effd87c9a6eaacc22da2d8193224b6e28b5fcac400ac5cc for consistency, scope, trace, correction boundary, assurance, exclusions and delivery. No readiness findings were reported. The complete effective PLAN through NETATMO-001-PLAN-A3 is automatically approved on 2026-11-13 under the originating implement request, with only the reserved-tag correction added to the already authorized publisher and business-test scope. Prior document status/content and user authority boundaries remain unchanged.
