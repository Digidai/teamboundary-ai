# Open-source source-release checklist

This is the reusable gate for publishing source and source-release artifacts. It does not approve a
hosted or commercial service; those releases must also satisfy [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

Each release stores its completed evidence in `docs/releases/` and in the canonical GitHub release.
An unchecked item in a proposed release is a stop condition, not permission to infer success.

## 1. Identity, rights and name

- The canonical owner, repository, release manager and security lead match `MAINTAINERS.md`.
- The release owner has authorized publication under Apache-2.0 and reviewed employer, client,
  confidentiality and third-party obligations.
- `AUTHORS.md`, `NOTICE` and `PROVENANCE.md` identify people and AI assistance accurately without
  treating a tool or project name as a legal person.
- Public Git history uses identities and addresses approved for indefinite publication.
- The exact project name has a dated preliminary screen and makes no registration or
  conflict-free claim.
- The exact release tree has been compared against identified restricted sources, and the scope,
  tool versions and results are archived privately.

## 2. Licensing and supply chain

- `LICENSE` is the canonical Apache-2.0 text and package metadata declares `Apache-2.0`.
- DCO 1.1 is verbatim; contribution guidance requires each contributor's own sign-off.
- The lockfile is reproducible and contains no unexplained source override or removed runtime.
- Dependency-license checks and the generated runtime/browser license bundle pass.
- Source and built browser artifacts contain applicable LICENSE, NOTICE and third-party license
  material.
- Production and complete-tree vulnerability audits pass at the release severity threshold.
- Registry signatures/attestations and a normalized CycloneDX SBOM are archived.
- Hosted services and models have separate terms/data/AUP review; Apache-2.0 is not represented as
  licensing them.

## 3. Security and community controls

- No unresolved critical/high source finding remains.
- `GOVERNANCE.md`, `MAINTAINERS.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`,
  `TRADEMARKS.md` and `CHANGELOG.md` describe real current controls.
- GitHub Private Vulnerability Reporting is enabled and reachable through the documented URL.
- CODEOWNERS, PR/issue templates and DCO checks route sensitive work correctly.
- CI, CodeQL, dependency review, Dependabot, secret scanning and push protection are enabled where
  the host account supports them.
- Default-branch rules prevent force push/deletion and require review and passing checks, with any
  administrator bypass recorded.

## 4. Privacy and source tree

- The complete public history, branches, tags, LFS objects, submodules and release artifacts have
  been scanned for credentials, production IDs, internal paths, customer/personal data and private
  URLs.
- The release contains no real Cloudflare account, database, Access, route or tenant identifier.
- Examples retain non-deployable placeholders and safe defaults.
- The clean public history excludes unsupported private prototypes and private commit addresses.

## 5. Reproducible verification

Run from a clean checkout of the exact release commit:

```bash
npm ci --ignore-scripts
npm run format:check
npm run check
npm run sbom:check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
npm audit signatures
npm pack --dry-run --json
git diff --check
```

Also run an independent full-history secret scan, action-workflow lint where available, an exact
source manifest comparison and the documented non-production deployment dry run. A missing tool is
not a passing result; record a justified exception and compensating control.

## 6. Publication evidence

- The tag points to the reviewed commit and the worktree is clean.
- The source archive, CycloneDX SBOM and SHA-256 checksum manifest are attached to the release.
- Release notes describe scope, limitations, name status and residual risk without claiming zero
  risk, commercial readiness, legal clearance or Cloudflare endorsement.
- An unauthenticated client can read the repository, LICENSE, SECURITY policy, source archive and
  release notes.
- A fresh clone reproduces dependency installation, format, tests, build and SBOM validation.
- The release owner records final acceptance in the release evidence document.
