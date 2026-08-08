# Changelog

The project follows Keep a Changelog and Semantic Versioning where the public API and deployment
contract permit it.

## [Unreleased]

No unreleased changes.

## [0.1.0] - 2026-08-08

### Added

- A security-first multi-tenant AI workspace built on Cloudflare Access, Workers, D1, Workflows, AI
  Gateway and Workers AI.
- Tenant-scoped projects and bounded chat runs with D1-backed authorization, idempotency, audit and
  cost limits.
- Deterministic Workflow launch and reconciliation with bounded persisted state and retention.
- A static React interface, local loopback development mode and fail-closed deployment generator.
- Apache-2.0 licensing, DCO contribution policy, governance, security reporting, support, provenance,
  name-screening and trademark documentation.
- Dependency notices, CycloneDX SBOM generation, registry-signature checks, workerd integration
  tests, security workflows and deployment-boundary checks.

### Security

- Arbitrary code execution, containers, browser automation, realtime sockets, uploads, object
  storage, queues, embeddings, semantic search and external tools are excluded from 0.1.
- The checked-in release configuration disables Workers AI, `workers.dev`, preview URLs and public
  routes and uses non-deployable resource placeholders.
- Production identity provisioning is closed; every inference attempt re-checks active membership
  and atomically claims D1 cost budgets immediately before the provider call.

[Unreleased]: https://github.com/Digidai/teamboundary-ai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Digidai/teamboundary-ai/releases/tag/v0.1.0
