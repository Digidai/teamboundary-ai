# ADR-0003: D1-enforced tenant, idempotency and cost boundaries

- Status: Accepted
- Date: 2026-08-08

## Context

Application route checks alone are vulnerable to future mistakes, ambiguous responses and concurrent
admission. Rate-limit bindings are not a global accounting system.

## Decision

Every tenant child record carries `organization_id`; relationships use composite organization keys
where applicable. Active membership and role are checked before any tenant read, mutation or receipt
replay. Membership revocation is a retained row with `revoked_at` so historical actor relationships
remain intact.

Create operations require an idempotency key. The resource, audit event and completed receipt commit
in one D1 batch using deterministic IDs. D1 triggers enforce deployment, organization and actor
admission; each real inference attempt claims account and organization budget immediately before the
provider call.

## Consequences

D1 is a critical security and cost boundary. Schema changes require adversarial migration tests and
fresh/upgrade path separation. Retained membership rows require an explicit privacy/offboarding
policy rather than physical deletion that would destroy audit meaning.
