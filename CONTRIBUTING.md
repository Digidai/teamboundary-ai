# Contributing

TeamBoundary AI is an independent project licensed under Apache-2.0. Contributions are accepted
only when their authors have the right to submit them under Apache-2.0 and comply with the
provenance, security and conduct rules below.

## Before contributing

Read:

- `LICENSE`, `DCO`, `AUTHORS.md`, and `PROVENANCE.md`;
- `docs/CLEAN_ROOM.md`, `NAME_CLEARANCE.md`, and `TRADEMARKS.md`;
- `SECURITY.md`, `GOVERNANCE.md`, and the applicable architecture decision records.

Do not submit confidential information, credentials, customer data, production identifiers, or
material that an employer, client, contract, license, or law prevents you from licensing to the
public under Apache-2.0.

## Developer Certificate of Origin

Every commit must be signed off under the Developer Certificate of Origin 1.1 in `DCO`. A sign-off
certifies that you have the right to submit that specific contribution; it is not a copyright
assignment and is not a substitute for checking employer or client obligations.

Create a sign-off with:

```text
git commit -s
```

The resulting commit message must contain a trailer in this form:

```text
Signed-off-by: <your name> <your authorized public email>
```

Use your own identity and an email address you are authorized to publish. Git history and DCO
sign-offs are public records that may be retained and redistributed indefinitely. Maintainers must
not add or fabricate another contributor's sign-off.

## Independent-source and clean-room rules

Contributions must be independently authored. Do not copy, translate, adapt, closely paraphrase, or
use as an implementation template any restricted source code, UI, prompt, API contract, schema,
fixture, documentation, design asset, brand element, customer material, or non-public behavior.

In particular, do not copy from a private comparison repository or another source whose license
does not permit the contribution and its intended distribution. Similar product goals and public
ideas do not excuse copying protected expression or using confidential knowledge.

For every pull request, disclose:

- all third-party source material and its license;
- whether an employer or client may own or control the contribution, and the authorization relied
  on;
- any generated-code or AI assistance that materially influenced the contribution;
- the human review, selection, modification, and testing performed;
- any remaining provenance uncertainty.

AI systems and tools are not authors or contributors. The human submitter remains responsible for
the originality, accuracy, security, licensing, and review of every submitted line. Do not add an AI
tool as a commit author or co-author.

## Dependencies and generated artifacts

New or updated dependencies require:

1. an exact version and source review;
2. a compatible license and all required copyright, license, and NOTICE text;
3. an update to `package-lock.json`, `THIRD_PARTY_NOTICES.md`, and the generated
   `THIRD_PARTY_LICENSES.txt` where applicable;
4. verification that browser, Worker, container, and source-distribution obligations are handled
   separately;
5. a model/service terms review when a configured AI model or hosted service changes.

Do not commit generated `dist`, local Wrangler state, secrets, production IDs, or user data.

## Development and verification

Use Node.js 22 or later. Before requesting review, run:

```text
npm ci
npm run format:check
npm run check
npm run sbom:check
```

Run `npm run verify:deploy` only with the documented non-production target configuration and after
following `docs/DEPLOYMENT.md`. A dry run is not evidence of a successful or secure deployment.

Add tests for authorization, tenant boundaries, input limits, idempotency, retries, failure states,
and secure defaults when those areas change. Schema changes use forward-only
expand/migrate/contract migrations.

## Pull-request statement

Every pull request must include the following completed statement:

```text
Rights and provenance
- [ ] Every commit carries my own DCO sign-off.
- [ ] I have the right to submit this work under Apache-2.0.
- [ ] I did not copy or adapt incompatible, confidential, non-public, or restricted material.
- [ ] I disclosed all third-party sources, licenses, employer/client constraints, and material AI
      assistance.
- [ ] I performed and described the human review, modification, and testing of assisted output.

Risk and release impact
- Threat-model impact:
- Tenant-boundary impact:
- Dependency/license impact:
- Data/privacy impact:
- Deployment, migration, and rollback impact:
- Verification commands and results:
```

A change that weakens authentication, authorization, tenant scoping, input/output limits, cost
ceilings, production defaults, auditability, or release controls requires the security maintainer's
explicit approval. No contributor may self-approve a security exception.

## Conduct and support

Use `SUPPORT.md` for support boundaries, `SECURITY.md` for vulnerabilities and
`CODE_OF_CONDUCT.md` for community expectations. Do not disclose a vulnerability or private conduct
report in a public issue.
