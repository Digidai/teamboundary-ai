# Hosted commercial release checklist

This checklist is stricter than publishing source code. Every item requires dated evidence and an
accountable approver. An unchecked item means the hosted service is a no-go.

## Legal and product

- [ ] Trademark counsel has cleared the final name in each target market/class.
- [ ] Initial code provenance and rights are signed by the actual rights holder.
- [ ] Terms, privacy notice, acceptable-use/content policy, DPA and subprocessor list are approved.
- [ ] Input/output safety policy, user notice, appeal and abuse-report processes are live.
- [ ] Claims, pricing, limits, support and incident obligations match the deployed product.
- [ ] Workers AI model, Cloudflare terms/AUP and data-handling terms have a dated review.

## Identity and tenant security

- [ ] Exact hostname is default-deny under Access with intended MFA/posture and no bypass.
- [ ] Production request-time provisioning is closed; owner/member records were provisioned through
      the protected operator procedure.
- [ ] Two-tenant ID-substitution and role tests pass on the deployed hostname.
- [ ] Membership revocation blocks an existing valid token and receipt replay immediately.
- [ ] Cross-site GET/mutation tests fail before rate counters, D1 and Workflow access.

## Cost and abuse

- [ ] Fixed model, input/output bounds and deployment/org/actor quotas match the approved budget.
- [ ] Account-wide run and actual inference-attempt caps pass concurrent boundary tests.
- [ ] WAF rules, billing alerts and operational kill switch have been tested.
- [ ] Load/abuse testing proves acceptable Worker, D1 and Workflow cost at configured limits.
- [ ] Monitoring detects quota pressure, Workflow age/failure, authentication rejects and spend
      anomalies without logging sensitive content.
- [ ] Target-account input/output guardrails and DLP are configured, and bypass/false-positive
      canaries pass for the approved model and policy version.
- [ ] The AI Gateway ID in the private release manifest matches that reviewed policy, and removing
      it makes HTTP admission and Workflow execution fail before an inference budget claim.
- [ ] The AI Gateway is pre-created and named; the reserved auto-creating `default` ID is absent.

## Privacy and lifecycle

- [ ] Tenant export, deletion, offboarding and DSAR workflows cover D1, Workflows, observability,
      backups and vendor logs.
- [ ] Retention is implemented, documented, legally approved and verified after deletion.
- [ ] Operator access is least privilege, logged and periodically reviewed.
- [ ] No production prompt/output is retained in AI Gateway logs or Workflow step output/errors.
- [ ] Data residency, transfer and breach-notification obligations are approved.

## Reliability and incident response

- [ ] D1 backup/restore and forward-fix exercises meet approved RPO/RTO.
- [ ] Workflow ambiguity, over-age and provider-outage exercises have passed.
- [ ] Access outage, AI-disabled degraded mode, revocation and rollback procedures are exercised.
- [ ] A monitored private vulnerability intake and on-call incident contacts are live.
- [ ] Independent penetration test findings are closed or formally accepted by the risk owner.

## Supply chain and release

- [ ] Protected CI is least privilege; actions are SHA-pinned; branch/release approvals are enforced.
- [ ] Tests, workerd integration, migration, build, boundary, format, audit, license and SBOM gates pass.
- [ ] Full Git history and release artifact secret/PII scans pass.
- [ ] Browser and Worker artifacts contain accurate LICENSE/NOTICE/third-party license files.
- [ ] Commit, tag, SBOM, provenance attestation and release artifact hashes are archived.

## Cloudflare target evidence

- [ ] Account, Worker version, D1 UUID, Workflow, AI Gateway and rate namespaces match the approved
      manifest.
- [ ] Staging and production resources are disjoint; no old traffic override or uncovered route exists.
- [ ] Fresh D1 migration list, foreign-key check and deployment limit singleton are recorded.
- [ ] `workers.dev` and preview URLs are disabled; generated bindings match the minimal architecture.
- [ ] Exact-host post-deploy canary and observability/privacy inspection pass.

## Approval

- [ ] Engineering owner
- [ ] Security owner
- [ ] Privacy/legal owner
- [ ] Cloudflare operations owner
- [ ] Commercial/product owner

Open-source maintainers must not mark placeholders as complete or approve on behalf of an unnamed
owner. “All checks passed locally” is not a production approval.
