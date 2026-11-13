# Netatmo Home Coach True Temperature service

This Node.js 24 service periodically uses a configured Home Coach reading as a
reference for a configured heating room's **True Temperature calibration**. It
does not change a thermostat setpoint, schedule, mode, or valve pairing. A
successful API response does not prove that a physical heater or valve reacted.

Start with [the operations guide](docs/operations.md) for configuration,
credentials, local use, Docker, CI, Forgejo image publishing, and recovery
details. The service defaults to a five-minute cycle and a 15-minute maximum
Home Coach reading age. Use `DRY_RUN=true` to inspect intended adjustments
without calibration writes.

The current automated suite contains 12 business-rule unit cases, alongside
the source check. It does not test infrastructure, authentication, HTTP,
scheduling, or container execution. Live calibration acceptance is still
outstanding: a nonzero live correction and subsequent physical response have
not been verified. Do not infer live acceptance from unit tests.
