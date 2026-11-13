# Alpine ARM64 base image

Status: Approved

Date: 2026-11-13

## Authority, purpose and scope

User instruction: "base image should be alpine arm64 compatible", continuing
explicit super-agent execution. Replace the Docker base while retaining Node 24,
locked dependencies, two-stage build, non-root execution and application behavior.
This supersedes only the Bookworm base and image naming provisions in
../docs/specs/NETATMO-001-SPEC.md and ../docs/specs/NETATMO-001-PLAN.md;
those earlier artifacts remain unchanged.

## Delivered behavior and constraints

Both stages use node:24.21.0-alpine pinned to multi-platform index digest
sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1.
Docker selects the platform manifest; the existing publisher still explicitly
builds linux/arm64 on its native ARM64 runner. Publication suffixes and latest
alias become node24-alpine. Tag-only publication, credentials, guards and
receipt verification remain unchanged. No release, publication or deployment
was performed. Existing application behavior and prior settings work are preserved.

## Evidence, assumptions and documentation

Official Docker registry inspection of node:24.21.0-alpine returned the above
index and linux/arm64/v8 manifest
sha256:38a36422dc7de80f3ced964270f23b3b17f73af816728d21a5fbbf84bf8be46f,
based on Alpine 3.24. Node's official docker-node versions.json also lists ARM64
for Node 24 Alpine. Runtime compatibility with musl is not proven by metadata;
no extra compatibility package is added without demonstrated need.
Updated Dockerfile, publisher workflow, operations guide and AGENTS.md.
Short validation: registry metadata inspection and git whitespace checks.
Container build/run, longer checks, independent QA and code review are skipped
under super-agent. No application source changed; business tests are not needed
for this packaging-only change. Future ARM64 publication/runtime remain unverified.
