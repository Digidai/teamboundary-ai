# ADR-0002: Access authentication with pre-provisioned entitlement

- Status: Accepted
- Date: 2026-08-08

## Context

Password/session recovery would add sensitive state and a large operations surface. The initial
product serves known organization members, not anonymous consumers. Access authentication does not
by itself prove entitlement to a TeamBoundary AI organization.

## Decision

Protect the exact hostname with Cloudflare Access and independently verify the assertion in the
Worker using RS256, exact issuer/audience and required time/identity claims. Map `(issuer, subject)`
to an internal identity; never authorize by mutable email.

Production only reads identities and active memberships that an operator provisioned out of band.
An unknown or revoked subject fails closed. Local auto-provisioning is allowed only in exact
development mode on a loopback hostname.

All non-health browser API traffic checks same-site Fetch Metadata. Mutations additionally require
same-origin validation and a non-simple marker.

## Consequences

MFA, IdP lifecycle and sessions depend on Access. TeamBoundary AI still needs an audited membership
provision/revoke procedure. Consumer signup requires a new ADR. An Access or IdP outage can block all
users, so the commercial runbook needs an emergency, least-privilege policy process.
