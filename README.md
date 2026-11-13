# Netatmo Home Coach True Temperature service

This Node.js 24 service periodically uses a configured Netatmo Home Coach
reading as a reference for a heating room's **True Temperature calibration**.
It does not change a thermostat setpoint, schedule, mode, or valve pairing. An
accepted API response does not prove that a physical heater or valve reacted.

## Source structure

```text
src/
├── AppFactory.ts                         # validates startup and composes concrete services
├── main.ts                               # process startup and shutdown lifecycle
├── domain/
│   ├── models/                           # mapping, samples and calibration decision types
│   └── services/                         # pure mapping and calibration rules
├── application/
│   ├── ports/                            # gateway contract used by the use case
│   └── services/                         # temperature synchronization use case and interface
├── infrastructure/
│   ├── config/                           # environment and JSON configuration loading
│   ├── http/                             # direct HTTP client and typed errors
│   ├── netatmo/                          # OAuth, web session and Netatmo API adapters
│   └── scheduling/                       # serial cycle scheduling
└── shared/
    ├── clock/                            # clock contract and system clock
    ├── config/                           # validated service configuration contract
    └── logging/                          # logger contract and sanitized structured logger
tests/unit/
├── application/                          # synchronization use-case business tests
└── domain/                               # pure mapping and calibration policy tests
```

The domain layer owns deterministic calibration and mapping decisions. The
application layer coordinates a cycle through injected gateway, logger, clock,
and configuration contracts. Infrastructure implements Netatmo communication,
configuration loading, and scheduling. `AppFactory.ts` is the single concrete
composition root; `main.ts` handles process lifecycle. There is no HTTP API,
database, or application framework.

## Development and operation

Use Node.js 24 and the checked-in lockfile:

```sh
npm ci
npm run check
npm test
npm run build
```

`check` runs ESLint and strict TypeScript checking over source and tests without
emitting files. `test` runs the 19 domain and application business-rule cases
with Node's test runner and `tsx`. `build` compiles only `src/` into `dist/`.
For development, `npm run dev` runs `tsx watch src/main.ts` and does not load
`.env.local` automatically. `npm start` runs the compiled `dist/main.js` and
therefore requires a prior build. `npm run start:local` builds and then runs
the compiled service with Node's optional `.env.local` loading; values already
set in the process environment take precedence.

See the [operations guide](docs/operations.md) for safe configuration,
credentials, Docker, CI, Forgejo image publishing, and recovery details.
The service defaults to a five-minute cycle and a 15-minute maximum Home Coach
reading age. Use `DRY_RUN=true` to inspect intended adjustments without
calibration writes.

The automated suite covers business rules only. It does not test infrastructure,
authentication, HTTP, scheduling, or container execution. Live calibration
acceptance is still outstanding: a nonzero live correction and subsequent
physical response have not been verified. Do not infer live acceptance from
unit tests.
