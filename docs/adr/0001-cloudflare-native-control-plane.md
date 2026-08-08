# ADR-0001: Minimal Cloudflare-native control plane

- Status: Accepted; supersedes the broader prototype architecture
- Date: 2026-08-08

## Context

The first release needs tenant authorization, durable bounded AI work and a deployable browser UI.
Adding every available platform service would multiply authorization, privacy, retry, cost and
recovery boundaries before the core model is proven.

## Decision

Use one Worker with Static Assets, one fresh D1 database, Cloudflare Access, one Workflow binding,
Workers AI and four ingress rate-limit bindings. D1 is authoritative for identity, membership,
projects, run state, audits, idempotency and hard quotas.

Exclude file ingestion, external connectors, search, public streaming, browser automation and
arbitrary execution from 0.1.

## Consequences

The design is platform-specific but small enough to audit and test in workerd. It cannot claim to be
a general agent platform. A deferred capability needs a new ADR and must not weaken current tenant,
cost or privacy invariants.
