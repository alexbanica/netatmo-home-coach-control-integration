# Project guide

This is a private Node.js 24 service that uses a configured Netatmo Home Coach
reading as a reference for a heating room's True Temperature calibration. True
Temperature is sensor calibration: it does not change a setpoint, schedule,
heating mode, or valve pairing. An accepted API response does not prove physical
heating behavior. See [NETATMO-001-SPEC.md](docs/specs/NETATMO-001-SPEC.md)
and [operations.md](docs/operations.md) for authoritative behavior and caveats.

## Source layout and boundaries

- `src/domain/models/` and `src/domain/services/` hold calibration types and
  deterministic mapping/calibration policy. Keep domain rules pure: no process,
  filesystem, network, timer, logging, or concrete configuration access.
- `src/application/` holds the synchronization use case and its service and
  gateway contracts. Depend on domain and shared contracts; inject external
  access, clock, logger, and configuration needed by the use case.
- `src/infrastructure/` implements Netatmo/OAuth and web-session access, HTTP,
  environment/JSON configuration loading, and serial scheduling.
- `src/shared/` holds the clock, logger, and validated configuration contracts
  and their shared implementations.
- `src/AppFactory.ts` is the sole concrete composition root. It validates
  startup configuration and wires adapters, use case, and scheduler.
  `src/main.ts` owns process startup, signal handling, and shutdown lifecycle.
- `tests/unit/domain/` covers pure policy. `tests/unit/application/` covers
  synchronization business behavior through injected gateway and fake clock.

Keep dependencies directed inward: domain has no outer-layer imports;
application uses contracts rather than concrete infrastructure; infrastructure
implements those contracts; only `AppFactory` composes concrete components.
Keep one class per PascalCase-named file and put shared contracts in their own
files with the `Interface` suffix. The package is private and has no public
module API.

## TypeScript and module conventions

Use strict TypeScript and the repository's NodeNext module settings. Relative
ES module imports in TypeScript source use the emitted `.js` specifier, for
example `import { AppFactory } from "./AppFactory.js";`. Keep filename casing
consistent. Do not weaken checking with `any`, `@ts-nocheck`, or broad compiler
suppression; accept external data as `unknown` and narrow it at runtime.

Preserve runtime validation at network and configuration boundaries. TypeScript
types do not validate Netatmo responses. Avoid adding abstractions or layers
without a concrete need, and keep changes within the approved behavior and
contracts in the current SPEC/PLAN.

## Business tests and checks

The permitted automated suite is business-only. Add domain tests under
`tests/unit/domain/` and use-case tests under
`tests/unit/application/`, naming each file after its business service. Exercise
the application service with injected gateway/fake clock; keep pure policy
tests independent of I/O. Do not add tests for authentication, HTTP, logging,
configuration loading, scheduling, startup/composition, containers, or other
infrastructure, and do not use inline probes as a substitute.

With Node.js 24 and the checked-in lockfile, the documented checks are:

```sh
npm ci
npm run check
npm test
npm run build
```

`check` runs lint and strict type-checking over source and tests without emit;
`test` runs the domain/application business suite; `build` compiles `src/` into
ignored `dist/`. `npm start` runs `node dist/main.js` and expects a prior build.
`npm run dev` watches `src/main.ts` but does not load `.env.local`.
`npm run start:local` builds and starts `dist/main.js` with optional
`.env.local` loading; already-set process environment values take precedence.

## Configuration and private data

Configuration is read at startup. `CONFIG_FILE` selects the JSON mappings file
(default `./config.json`); credentials and runtime settings come from the
environment. Use `.env.example` and `config.example.json` as placeholder
templates only. Preserve existing private `.env.local`, `config.json`, and
`.idea/` content; never overwrite them with examples or copy secrets into
source, tracked configuration, shell commands, logs, images, or CI. Keep
credentials redacted in reports and narrow unknown data before using it.
Consult `docs/operations.md` for the current variable set, credential limits,
recovery behavior, and safe local operation.

## Docker, CI, and publication

The root `Dockerfile` builds with the pinned Node 24 Alpine image and
locked dependencies, then runs compiled `dist/` with production dependencies
as the non-root `node` user. `.dockerignore` is an allowlist: preserve required
package manifests, `tsconfig.json`, and `src/`; do not send tests, local config,
environment files, credentials, IDE data, or `dist/` as build context.

Ordinary GitHub Actions CI validates pull requests and pushes to `main` and the
feature branch; it installs locked dependencies and runs `check`, `test`, and
`build`. The separate Forgejo publisher is tag-push-only, guarded, and targets
native ARM64. It validates the tag, runs the same checks/build before registry
login, pushes versioned and `latest-node24-alpine` images, checks matching
push receipts/digests, and removes temporary Docker credentials. Repository
secret names are `FORGEJO_REGISTRY_USERNAME` and
`FORGEJO_REGISTRY_TOKEN`; never read, print, or record their values.

Source changes and ordinary CI do not authorize creating a release tag,
publishing an image, deploying, or live calibration. A publisher workflow or
passing CI is not evidence that publication or live/physical acceptance
occurred. Follow the explicit current user/workflow instructions and approved
SPEC/PLAN; do not invent additional approval gates, roles, skills, or worktree
requirements. Preserve unrelated edits and existing Git state.
