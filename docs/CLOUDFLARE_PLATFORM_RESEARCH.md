# Cloudflare platform research for TeamBoundary AI 0.1

Reviewed: 2026-08-08. Platform behavior, limits, prices and terms can change; production approval
must re-check the linked primary sources against the target account and plan.

## Verified platform facts

| Area                      | Primary source                                                                                                                                          | Architectural consequence                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Access assertions         | [Validate Access tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) | Validate signature, issuer, audience and time claims inside the Worker; do not trust the edge alone.             |
| Default Access coverage   | [Require Access protection](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/require-access-protection/)                | Enable account-level default deny before attaching a custom hostname, then verify no exemption.                  |
| D1 foreign keys           | [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)                                                                           | Use organization-scoped foreign keys and run `foreign_key_check`; migrations need forward upgrade tests.         |
| Workflow step state       | [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)                                                             | Step return values are persisted; never return model content or raw sensitive errors from a step.                |
| Workflow retention/limits | [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)                                                                        | Set explicit minimal instance retention and keep D1 as the durable product-state authority.                      |
| Permanent Workflow errors | [Non-retryable errors](https://developers.cloudflare.com/workflows/build/workers-api/#nonretryableerror)                                                | Budget, configuration and validation failures must not burn retry attempts.                                      |
| Rate-limit semantics      | [Rate Limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)                                                      | Counters are local/permissive and unsuitable for accurate billing; use them for ingress protection only.         |
| AI Gateway logging        | [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)                                                               | Logging can retain prompts/responses; TeamBoundary AI explicitly sends `collectLog: false`.                      |
| AI Gateway Guardrails     | [Guardrails](https://developers.cloudflare.com/ai-gateway/features/guardrails/)                                                                         | Enabled inference must use the reviewed Gateway; test both prompt and response blocking in the target account.   |
| Workers observability     | [Trace attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)                                                | Automatic telemetry can include URL and database attributes; sample conservatively and control access/retention. |
| Vitest integration        | [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)                                                     | Run a real workerd suite in addition to Node state-machine tests.                                                |
| Preview URLs              | [Preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)                                                                       | Disable both `workers.dev` and preview URLs; verify dashboard state after deployment.                            |

## Design inferences

The following are project judgments derived from those platform facts, not Cloudflare guarantees:

- D1 must enforce cost and tenancy rules because edge rate limiting cannot provide a global billing
  ledger.
- A Workflow instance handle is not the product record. D1 stores the deterministic instance ID,
  state, tenant and bounded output so ambiguous API responses can be reconciled.
- A one-hour Workflow retention is sufficient for 0.1 diagnostics because the service is not used as
  the long-term data store.
- The release should use one approved model and fixed request/output limits. A configurable model
  would silently change cost, behavior and policy assumptions.
- Production membership provisioning should be an operator control, not an HTTP side effect. Access
  authentication alone does not establish application entitlement.
- A minimal chat-only surface is safer and more supportable than bundling uploads, search,
  connectors, public streaming or user-controlled execution into the first release.

## Vendor and plan dependence

TeamBoundary AI deliberately uses Cloudflare-specific bindings and lifecycle APIs. A migration to another
provider would require replacements for Access verification, D1 transactions/triggers, Workflow
reconciliation, Workers AI and deployment controls. Open-source licensing does not remove this
operational dependency.

A target account must verify feature availability, plan limits, spend controls, model availability,
regional/data-processing terms and retention at deployment time. The repository does not promise a
free-plan deployment or stable provider pricing.

## Deferred capabilities

File storage, vector search, event ingestion, durable real-time sessions, third-party connectors,
browser automation and arbitrary execution are outside 0.1. Each would introduce a distinct tenant,
privacy, cost, replay and abuse boundary. None should be added merely because the platform offers a
binding; each requires its own ADR, threat model, quotas, tests and rollout approval.
