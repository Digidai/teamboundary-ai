# ADR-0005: Remove arbitrary execution from version 0.1

- Status: Accepted; supersedes and rejects the earlier prototype decision
- Date: 2026-08-08

## Context

User-controlled execution creates a separate isolation, privilege, egress, persistence, abuse and
cost boundary. The earlier prototype approach did not provide sufficient defense in depth for a
commercial multi-tenant claim.

## Decision

Version 0.1 has no execution route, interpreter, container dependency, service binding or deploy
script. The only run kind is `chat`, the model has no tools, and legacy execution history is not a
supported release.

## Consequences

The known source-level execution boundary is closed in the new snapshot. Any previously deployed
prototype remains a separate remote-retirement task, including old versions and already-created
durable instances. Reintroducing execution requires a new architecture, independent penetration
test and explicit commercial approval; it is not a routine feature flag.
