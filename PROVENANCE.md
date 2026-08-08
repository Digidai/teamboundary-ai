# Provenance record

## Release status

This document records the source boundary and review process for the TeamBoundary AI 0.1.0 public
source release. It is evidence of engineering process, not a copyright registration, legal opinion,
trademark clearance or guarantee of non-infringement.

The repository publisher, Gene Dai ([@Digidai](https://github.com/Digidai)), instructed publication
of the reviewed snapshot under Apache-2.0 on 2026-08-08. The clean public root commit intentionally
does not preserve pre-public experimental Git ancestry.

## Independent-source boundary

The public implementation is based on:

- public standards and primary Cloudflare documentation;
- independently expressed product, security and operational requirements;
- dependencies with reviewed licenses and redistribution notices; and
- independently created code, schemas, tests, fixtures, documentation and visual design.

Contributors must not copy, translate, closely paraphrase or use as an implementation template any
restricted source code, UI, prompt, schema, documentation, fixture, brand asset, customer data,
confidential material or non-public behavior. The complete policy is in
[docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).

Pre-public experimental history was retained only in a private audit archive. It was excluded from
the public repository because it contained unsupported runtime experiments and private Git
metadata. No tag or release points to that archive, and the public source does not claim Git ancestry
from it.

## Engineering evidence

Release preparation includes:

- exact-file SHA-256 comparison against identified restricted local comparison trees;
- token/line clone screening for source and documentation where the comparison tools support it;
- a repository boundary check that rejects removed runtime capabilities and obsolete identifiers;
- full-tree and full-public-history secret scanning;
- dependency-license, registry-signature, vulnerability and CycloneDX SBOM checks; and
- clean-checkout reproduction of tests, build, package contents and deployment-config fixtures.

These checks reduce uncertainty but cannot prove originality, patent freedom, trademark
availability, absence of trade secrets, or compliance with every contract and jurisdiction.
Release evidence and residual limitations are recorded with the GitHub v0.1.0 release.

## AI-assisted work

OpenAI Codex and an Agent Team were used during design, implementation, adversarial review,
documentation and release preparation. No Grok output is included in the release evidence because
no independently auditable Grok run was obtained. The human publisher reviewed, selected and
accepted the released changes.

AI systems are not listed as authors or co-authors. Contributors remain responsible for ensuring
that assisted material contains no restricted third-party source, confidential data or unlicensed
content, and for disclosing material AI assistance in a pull request.

## Third-party materials and services

The root work is offered under Apache-2.0. Dependencies and redistributed content retain their own
licenses and notices. Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt), the lockfile and the release SBOM together.

Cloud services, hosted models, model weights, model output and third-party data are not licensed by
the repository's Apache-2.0 license. Their service terms, acceptable-use rules, data handling and
retention require a separate operator review.
