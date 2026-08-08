# Threat model

## Scope and assets

This model covers TeamBoundary AI 0.1: Access-authenticated project and bounded chat-run APIs, the browser
application, D1, Workflows, AI Gateway, Workers AI and rate-limit bindings.

Protected assets include tenant membership and role data, prompts and outputs, identity email,
audit/idempotency evidence, spend ceilings, availability and Cloudflare account configuration.

## Adversaries

- an unauthenticated Internet client;
- a malicious website targeting a logged-in browser;
- an authenticated but unprovisioned Access subject;
- a viewer or member attempting privilege escalation or cross-tenant substitution;
- a compromised authorized identity attempting denial of wallet;
- duplicate, delayed or ambiguous platform delivery;
- a maintainer or CI job targeting the wrong account or stale resource; and
- accidental disclosure through logs, build output, Git history or release artifacts.

Cloudflare account administrators and the configured identity provider are privileged operators, not
untrusted tenants. Their compromise is addressed by operator security and incident response rather
than application authorization alone.

## Security invariants

1. Production accepts only a valid Access RS256 assertion for the exact issuer and audience.
2. Production never provisions an identity or membership during an HTTP request.
3. Authorization is re-evaluated before every tenant read, write and idempotent replay.
4. Tenant SQL and foreign keys include the organization boundary; opaque IDs are not authorization.
5. Membership revocation takes effect at the application layer even while an Access token remains
   cryptographically valid.
6. Every create mutation is idempotent and its resource, audit event and receipt commit atomically.
7. A receipt replay never launches a second Workflow.
8. Expensive actions require atomic D1 admission and actual inference-attempt claims.
9. Terminal run states do not regress, and a stale Workflow cannot keep a D1 run active forever.
10. Prompt/output text is not returned as Workflow step state; enabled inference requires the
    approved AI Gateway while per-request payload logging is disabled.
11. The checked-in deployment cannot reach a public preview, a real D1 database or enabled AI.
12. The release bundle contains only the documented runtime and required license notices.

## Controls and residual risk

| Threat                       | Current control                                                   | Residual requirement                                      |
| ---------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| JWT forgery or confusion     | RS256, exact issuer/audience, required claims, size limit         | Access/IdP policy and key-rotation drill                  |
| Cross-site requests          | fail-fast Fetch Metadata; mutation Origin and marker              | exact-host deployed browser test                          |
| Cross-tenant ID substitution | active membership, role checks, composite D1 keys/FKs             | deployed two-tenant adversarial canary                    |
| Revoked member reuse         | soft revocation filtered on every request/replay                  | protected operator revoke procedure                       |
| Duplicate mutation           | deterministic IDs and atomic completed receipt                    | monitor conflicts and client retry UX                     |
| Ingress or spend abuse       | principal then deployment rate limits; D1 account/org/actor caps  | WAF, billing alerts and incident kill switch              |
| Workflow ambiguity           | deterministic ID, D1 launch marker, reconciler and wall-clock cap | deployed failure-injection exercise                       |
| Sensitive error persistence  | fixed Workflow error classes; no raw provider/database error      | inspect real instance API in staging                      |
| Prompt/output telemetry      | mandatory Gateway; `collectLog=false`; 1% Worker sampling         | verify Guardrail event retention and payload redaction    |
| Unsafe model content         | no tools/actions; enabled release requires reviewed Gateway ID    | deployed Guardrails/DLP canary, policy and abuse process  |
| Wrong-account deploy         | absolute private target, account check, strict Wrangler flags     | remote resource identity preflight and protected approval |
| Supply-chain compromise      | lockfile, audit, license/SBOM checks, pinned CI actions           | continuous dependency review and signed releases          |
| Data over-retention          | bounded terminal-run deletion                                     | full project/identity export and deletion workflow        |

## Deliberately absent attack surfaces

The release does not accept files, execute user code, expose a shell, call user-selected tools,
connect to third-party systems, perform browser automation or provide a public streaming channel.
These are exclusions, not hidden future features. A contribution that adds one must first update this
model and pass an independent security review.

## Mandatory adversarial tests

- forged, expired, wrong-audience, wrong-issuer and oversized Access assertions;
- cross-site GET and mutation requests that must touch neither D1 nor rate counters;
- two organizations substituting every organization, project and run identifier;
- viewer/member role violations and membership revocation with an otherwise valid token;
- concurrent same-key requests, same-key/different-body conflicts and response-loss replay;
- AI-disabled or missing-Gateway admission with zero resource, receipt, audit, Workflow and budget
  writes;
- account/organization/actor quota boundary plus one under concurrent insertion;
- Workflow create-response loss, queued/active over-age, unknown/terminal states and late completion;
- run list response-size ceiling and public response-shape snapshots; and
- generated bundle/config inspection for removed capabilities, old names, dynamic code and notices.

Node tests model adversarial state transitions, and the workerd suite imports the real migration and
invokes the actual Worker. A production claim still requires exact-host staging and post-deploy
evidence; local tests do not prove dashboard policy or account state.

## Commercial gaps

The source can be reviewed as an open-source preview, but a general hosted service remains blocked
until it has full tenant export/deletion/offboarding, privacy and content policies, incident intake,
input/output guardrails, recovery exercises, contractual controls, spending alerts, independent
penetration testing and legal approval. “No known open blocker in source” must never be restated as
“zero risk.”
