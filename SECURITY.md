# Security policy

## Supported versions

| Version                                    | Security fixes |
| ------------------------------------------ | -------------- |
| `0.1.x`                                    | Best effort    |
| Unreleased `main`                          | Best effort    |
| Pre-public prototypes or untagged archives | Not supported  |

The open-source project does not operate a hosted service or promise an SLA.

## Report a vulnerability privately

Use [GitHub Private Vulnerability Reporting](https://github.com/Digidai/teamboundary-ai/security/advisories/new).
Do not put vulnerability details, credentials, prompts, tenant data or production identifiers in a
public issue, discussion, pull request, commit or social post.

The security lead is Gene Dai ([@Digidai](https://github.com/Digidai)). The project currently has no
separate public security mailbox. If GitHub's private reporting form is unavailable, wait for it to
return or contact the repository owner through an already trusted private channel; do not disclose
sensitive details publicly.

Please include the affected commit/version, impact, prerequisites, a minimal synthetic-data
reproduction, observed behavior and any suggested mitigation. Do not include live secrets or more
personal/customer data than is strictly necessary.

## Response targets

These are best-effort targets, not contractual commitments:

- acknowledge a complete report within three business days;
- provide an initial severity and coordination decision within seven business days;
- share material status changes at least every fourteen days while remediation is active; and
- coordinate public disclosure after a fix or mitigation is available when practical.

The maintainer may request more time for complex platform or dependency issues. Credit is offered
when requested and safe, unless the reporter prefers anonymity.

## Testing authorization

Publication of source code does not authorize testing any deployment. Without prior written
authorization, do not access another tenant, persist in a system, exfiltrate data, disclose
credentials, bypass account controls, cause denial of service, generate unexpected cloud spend or
perform social engineering.

Testing a deployment you own with synthetic data is encouraged when it follows the deployment
runbook and vendor terms. Stop immediately if testing reaches data, accounts or infrastructure you
do not own.

## Security boundary

Version 0.1 excludes arbitrary code execution, containers, browser automation, uploads, embeddings
and external tools. The checked-in configuration is fail-closed and non-deployable. A downstream
operator is responsible for Cloudflare Access, routes, resource identity, Gateway guardrails,
secrets, monitoring, backups, incident response and all changes from the published source.

Commercial or production use requires the additional controls in
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). The absence of a published advisory is not a
statement that a deployment is secure or risk-free.
