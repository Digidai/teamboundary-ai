# Open-source readiness design record

- Status: Superseded by the implemented 2026-08-08 minimal architecture

The original planning draft described a broader product surface. Security review showed that the
surface could not support a responsible first open-source and hosted-service claim without
substantial additional isolation, privacy and operations work.

The implemented decision is recorded in ADR-0001 through ADR-0005:

- Access plus pre-provisioned D1 entitlement;
- one Worker, one fresh D1 database, one Workflow and Workers AI;
- atomic mutation/idempotency/audit and D1 hard quotas;
- chat-only runs with no model tools or external side effects; and
- no uploads, search, public streaming, connectors, browser or arbitrary execution in 0.1.

This file is retained only to document that scope reduction. Current operational instructions live
in `docs/DEPLOYMENT.md`; current architecture and risks live in `docs/ARCHITECTURE.md` and
`docs/THREAT_MODEL.md`.
