# Clean-room and provenance policy

## Scope

This repository is a greenfield implementation based on independently written product
requirements and current public Cloudflare documentation. It must not copy or adapt source code,
UI assets, prompts, API schemas, database schemas, documentation prose, tests, fixtures, brand
elements, or non-public behavior from another product.

The release review includes private comparison repositories that are not valid implementation
sources. Awareness of their risks is used only to define negative requirements (for example: do not
store passwords, execute arbitrary host shell commands or render unsanitized HTML). This policy is
a provenance control, not a claim that a formal organizational clean room was certified.

## Permitted inputs

- Public standards and primary vendor documentation.
- General product requirements expressed as capabilities, threats, and outcomes.
- Dependencies whose licenses and notices pass repository policy.
- Independently created code, text, visual design, migrations, tests, and fixtures.

## Prohibited inputs

- Copy/paste, mechanical translation, or close paraphrase from a restricted comparison source.
- Reuse of its file tree, names, endpoints, schema, component structure, prompts, or screenshots as
  an implementation template.
- Dependencies or assets without a verified license and redistribution path.
- Contributions produced under an employer/client agreement that the contributor cannot license.
- confidential material, credentials, customer data, or reverse-engineered non-public protocols.

## Contributor attestation

Every pull request must state:

> I have the right to submit this contribution under Apache-2.0. I did not copy or adapt
> incompatible, confidential, or non-public material. I disclosed all third-party sources and
> generated-code assistance relevant to provenance.

Material changes require review of `package-lock.json`, `THIRD_PARTY_NOTICES.md`, and
`npm run license:check`. A public release requires the release owner to review the exact public
history and archived comparison evidence. Commercial use may require qualified legal review.

## Automated guard

`npm run boundary` rejects selected references to the earlier local repository, unsafe dynamic-code
constructs, enabled public development/preview URLs, production dev authentication, deployable
resource placeholders, stale removed-capability instructions and unexpected release bindings. The
generated artifact check also rejects the obsolete project name and removed runtime surface. These
are narrow regression checks and cannot prove copyright independence.
