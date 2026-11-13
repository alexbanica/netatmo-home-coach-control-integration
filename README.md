# Netatmo Home Coach True Temperature service

This Node.js 24 service periodically uses a configured Home Coach reading as a
reference for a configured heating room's **True Temperature calibration**. It
does not change a thermostat setpoint, schedule, mode, or valve pairing. A
successful API response does not prove that a physical heater or valve reacted.

Start with [the operations guide](docs/operations.md) for configuration,
credentials, local use, Docker, CI, and recovery details. The service defaults
to a five-minute cycle and a 15-minute maximum Home Coach reading age. Use
`DRY_RUN=true` to inspect intended adjustments without calibration writes.

Live calibration acceptance is still outstanding: a nonzero live correction
and subsequent physical response have not been verified. Delivery therefore
remains DRAFT; do not infer live acceptance from mocked tests or container
smoke checks.
