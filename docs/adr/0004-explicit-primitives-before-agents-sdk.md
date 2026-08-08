# ADR-0004: Explicit state machine before an agent SDK

- Status: Accepted
- Date: 2026-08-08

## Context

TeamBoundary AI needs a small auditable run lifecycle, not a broad agent abstraction. Framework defaults can
obscure retry, persistence, identity and cost semantics.

## Decision

Implement chat runs directly with D1 conditional transitions, a deterministic Workflow instance and
one reviewed Workers AI call. The model has no tools and cannot claim external actions. Keep
provider/framework adoption behind the same run, tenancy, error, retention and budget contracts.

## Consequences

There is more project-owned orchestration code, but its state and side effects are explicit. A future
SDK migration must prove equivalent idempotency, privacy, revocation and cost behavior before it can
replace this path.
