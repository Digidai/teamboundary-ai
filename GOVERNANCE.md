# Governance

TeamBoundary AI is currently governed by the single maintainer identified in
[MAINTAINERS.md](MAINTAINERS.md). Governance applies to the open-source project; it does not create a
commercial operator, cloud-account owner, support contract or legal entity.

## Priorities

Project decisions follow these priorities, in order:

1. protect users, tenants, contributors and their data;
2. preserve accurate licensing, provenance and independent-source boundaries;
3. keep authentication, authorization, cost and deployment behavior fail-closed;
4. record material decisions and residual risk honestly; and
5. keep the Cloudflare-native reference implementation small and reviewable.

Apache-2.0 governs copyright and applicable patent permissions in the code. It does not license
project or vendor marks, hosted services, models, data or support.

## Roles

The project owner controls the canonical repository and appoints maintainers. Maintainers review
contributions, enforce the DCO and clean-room policy, operate release controls and disclose material
conflicts. The security lead coordinates private vulnerability reports. The release manager verifies
the exact source and artifacts against the source-release checklist.

One person may hold multiple roles during bootstrap. The resulting bus-factor and independent-review
limits must remain visible. An AI system, bot or fictional identity cannot hold a governance role.

## Contributions and merging

- Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and carry the contributor's own DCO 1.1
  sign-off.
- Pull requests must pass required CI and receive maintainer review.
- Security-boundary, tenant-isolation, authentication, authorization, migration, dependency,
  license or release-control changes require explicit maintainer attention.
- Unresolved provenance, secret, customer-data, cross-tenant or high-severity security risk blocks a
  merge.
- Emergency fixes may be reviewed privately, but affected versions and the decision should be
  disclosed when safe.

Repository rules provide technical enforcement; this document does not claim a setting is active
unless the canonical repository verifies it.

## Material decisions

Routine choices are decided in pull-request review. Record material choices in an issue, design
document or ADR with alternatives, security/license impact, migration or rollback and the decision
owner.

The project owner must approve:

- license or contribution-term changes;
- project-name, trademark-policy or governance changes;
- any weakening of a documented security boundary or safe default;
- a new release channel or official hosted/commercial service claim; and
- transfer of the canonical repository or critical project infrastructure.

A governance decision cannot relicense work the project does not own.

## Releases

Source releases follow [docs/OPEN_SOURCE_RELEASE_CHECKLIST.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.md).
Hosted or commercial releases must additionally satisfy
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). No release may be described as risk-free,
fully secure, legally cleared or Cloudflare-endorsed.

## Conflicts and succession

Reviewers disclose material employment, investment, customer, vendor, competitive or personal
interests. When the sole maintainer has a material conflict, non-urgent approval waits for an
independent reviewer where practical.

The owner may appoint or remove maintainers through a recorded decision. If repository ownership or
the private security channel cannot be lawfully recovered, releases stop until control is
re-established. Project infrastructure must not be seized through informal governance claims.

## Amendments

Governance changes use the material-decision process and are recorded in the changelog. No amendment
can retroactively remove Apache-2.0 rights already granted for a released version.
