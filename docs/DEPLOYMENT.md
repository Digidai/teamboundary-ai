# Cloudflare deployment runbook

This is a fail-closed runbook for a new TeamBoundary AI environment. It does not authorize deployment by
itself. A production change requires a protected approval, an explicit target manifest, remote
read-only inventory and recorded rollback/forward-fix evidence.

## Hard stops

Do not deploy or attach a route when any of these is missing:

- a reviewed release commit and green `npm run check`, audit, SBOM and secret-history scan;
- a new empty D1 database created for this TeamBoundary AI environment;
- four unique rate-limit namespace IDs allocated in the exact account;
- a custom hostname already covered by a Cloudflare Access application and a default-deny Access
  account policy;
- exact Access team domain and application audience;
- pre-provisioned owner identity, organization and active membership;
- a reviewed AI Gateway with input/output Guardrails and DLP before any AI-enabled release;
- a least-privilege production API token held by a protected CI environment;
- billing alerts, an operational AI kill switch and an approved spend ceiling; and
- a tested incident path to revoke a membership and disable new runs.

The checked-in configuration is intentionally unusable against real resources. Never replace its
placeholders in Git.

## 1. Verify the source release candidate

Use a clean checkout and Node.js 22 or newer:

```bash
npm ci
npm run check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
npm run sbom:check
git diff --check
git status --short
```

Archive command output, dependency lock hash, generated SBOM, source commit, build hashes and the
review approvals. `npm run build` first removes the exact generated `dist` directory so an obsolete
Worker cannot survive into the release artifact.

## 2. Isolate the Cloudflare environment

Use separate Cloudflare accounts for staging and production where practical. If the same account is
approved, names and IDs must still be disjoint. Create only:

- one empty D1 database named `teamboundary-<environment>-control`;
- one Workflow named `teamboundary-<environment>-run-workflow` (created with the Worker); and
- four rate-limit namespaces reserved for account, principal request, mutation and AI admission.

Do not point TeamBoundary AI at a database that has already applied a different version of the initial
migration. A fresh-database preflight must show no application tables and no migration record before
the first apply.

## 3. Protect the hostname before attaching it

Create the Access self-hosted application for the exact hostname and configure the intended IdP,
MFA/device posture and allow policy. In Zero Trust account settings enable
[Require Access protection](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/require-access-protection/)
so an unlisted hostname is denied rather than exposed. Verify there is no bypass/service-token
policy or exemption that makes the application public.

Record the Access team domain and application AUD. `workers_dev` and preview URLs remain disabled.
The Worker configuration intentionally contains no route; attach the approved hostname only after
Access and Worker-side authentication can both be tested.

## 4. Create a private target manifest

Copy `deploy/target.example.json` outside the repository, set mode `0600`, and replace every
placeholder with values independently read from the target account:

```json
{
  "schemaVersion": 3,
  "environment": "production",
  "hostname": "teamboundary.example.com",
  "accessTeamDomain": "your-team.cloudflareaccess.com",
  "accessAud": "the-exact-application-audience",
  "aiRelease": { "enabled": false, "gatewayId": null, "reviewId": null },
  "routeRelease": { "enabled": false, "reviewId": null },
  "accountId": "32-hex-account-id",
  "d1DatabaseId": "d1-uuid",
  "rateLimitNamespaceIds": {
    "account": "unique-numeric-id",
    "request": "unique-numeric-id",
    "mutation": "unique-numeric-id",
    "ai": "unique-numeric-id"
  }
}
```

Set its absolute path and the separately verified account:

```bash
export TEAMBOUNDARY_DEPLOY_TARGET=/absolute/private/path/teamboundary-production.json
export CLOUDFLARE_ACCOUNT_ID=the-same-approved-account-id
npm run prepare:deploy
npm run verify:deploy
```

Preparation writes `dist/teamboundary_target_control/wrangler.json` with mode `0600`, injects only the
approved account/resource mapping and rejects placeholders, duplicate rate IDs or a mismatched
account. Deployment uses `--autoconfig=false --strict`.

The manifest contains target identifiers and Access configuration but no token or user PII. Keep it
outside the repository, restrict it to the release operators and do not print it in CI logs. The
generator injects the exact Access team domain/audience and retains both AI gates off. A disabled
release omits `AI_GATEWAY_ID`; an enabled release requires the approved, pre-created Gateway ID and
matching protected approval. The reserved `default` ID is rejected because Cloudflare may create it
on first use without the reviewed policy.
Normal preparation also keeps the route absent unless `routeRelease` carries a matching protected
Access-review approval. The command prints environment, account, D1, Worker, hostname and gate state
for operator confirmation without printing the Access AUD or a credential.

## 5. Apply the fresh migration

First prove the remote target is the new empty D1 resource. Then:

```bash
npm run migration:remote:list
npm run migration:remote:apply
npm run migration:remote:list
```

Record the before/after list. Run `PRAGMA foreign_key_check`, confirm the singleton deployment limit
row, and confirm no legacy application table is present. Migration confirmation in CI requires the
same protected manual approval as deployment.

## 6. Provision production identities out of band

Production request handling is read-only for identity and membership. An operator must insert the
stable Access `(issuer, subject)`, current email, organization and owner membership through a
protected, audited D1 administration procedure. Never authorize by email alone. No anonymous,
first-user or request-time bootstrap is supported.

After provisioning, test that:

- the owner receives the expected organization and role;
- a different valid Access subject receives `403 identity_not_provisioned`;
- setting `memberships.revoked_at` blocks the owner's still-valid JWT immediately; and
- reactivation is an explicit, audited operator action.

Provisioning can be verified against the unattached Worker with protected operator tooling. Browser
verification through the exact hostname occurs after the Access-covered route is attached in the
next step.

## 7. Deploy disabled, then canary

Keep `AI_ENABLED=false` in the first production version. Deploy the control Worker only after
reviewing the generated config:

```bash
npm run deploy
```

Record Wrangler version, Worker version ID, generated config hash and binding inventory. Confirm:

- no public development/preview URL, route, service binding or unexpected compatibility flag;
- exactly one D1, one AI, one Workflow and four rate-limit bindings;
- Access configuration is present and a missing/wrong assertion fails closed;
- a run request while AI is disabled returns `503` with zero run, receipt, audit, Workflow and AI
  budget writes; and
- 1% observability sampling contains no prompt, output, assertion or raw provider/database error.

After the unreachable Worker checks pass, independently verify the manifest hostname is covered by
the intended Access application and account-level default deny. Then change the private manifest to
`"routeRelease": {"enabled": true, "reviewId": "<access-review-id>"}`, set
`TEAMBOUNDARY_ROUTE_ENABLE_APPROVAL` to that exact approved ID in the protected release environment, and
deploy again. The generated Wrangler route is the exact manifest hostname with `custom_domain=true`;
without the approval it is absent. Keep both AI gates off. Immediately run exact-host authentication,
unprovisioned, revocation, cross-site and two-tenant negative tests before allowing business users.

Enabling inference is a separately approved two-gate release:

1. Create or select a named AI Gateway in the exact account, enable reviewed input and output
   Guardrails and DLP, and archive a negative/false-positive test plus its logging/retention decision.
   Change the private manifest to `"aiRelease": {"enabled": true, "gatewayId":
"<approved-lower-case-gateway-id>", "reviewId": "<approved-change-id>"}`. The generator refuses
   an AI-enabled Worker without this Gateway ID, rejects `default`, and never prints the ID in its
   summary.
2. In the protected release environment retain the route approval and set
   `TEAMBOUNDARY_AI_ENABLE_APPROVAL` to the exact AI review ID. Without both applicable matches,
   configuration preparation fails.
3. Deploy the new Worker version. The D1 singleton remains `ai_enabled=0`, so new runs still cannot
   commit and version-pinned Workflows cannot call AI.
4. Re-run exact-host negative checks, model/AUP/spend review and binding inspection.
5. Execute `npm run ai:gate:enable`, then `npm run ai:gate:status`, and run one bounded canary.

`ai:gate:enable`, `ai:gate:disable` and `ai:gate:status` each rebuild an account-validated config from
the absolute target manifest; they never trust a leftover fixture or staging artifact. Disable/status
preparation forces a no-route, AI-off local config because it is used only to address the exact D1
binding, not to deploy.

To stop inference, execute `npm run ai:gate:disable` first and verify the D1 result, terminate active
Workflow instances as an incident operation, change the private manifest back to disabled, and
deploy the disabled Worker version. A provider call that already passed the D1 claim is in flight and
must be handled by incident response; no distributed switch can retroactively cancel that request.

## 8. Post-deploy checks

- Validate health, authentication, role denial, idempotent replay and same-key conflict.
- Test one bounded run and confirm one Workflow instance, one AI budget claim and one terminal D1
  row.
- Simulate launch ambiguity and confirm cron reconciliation without duplicate inference.
- Verify an over-age instance is terminated best effort and the D1 state fails conditionally.
- Confirm the run list contains summaries only and the detail response excludes internal handles.
- Inspect Access, WAF, Worker, D1, Workflow, AI usage and billing dashboards.
- Store evidence without prompts, emails, tokens or account credentials.

## 9. Observability and retention

The repository samples logs and traces at 1% and disables invocation logs. Restrict dashboard and
API access, document platform retention, and remember that automatic spans may contain URL paths and
D1 query text. Do not put secrets in query strings or resource names.

Terminal runs default to 90-day retention and are deleted in bounded batches; related run receipt
and audit rows are removed by a trigger. This is not a complete privacy deletion system. Do not host
regulated or customer-confidential production data until project/identity export, deletion,
offboarding, backup/log mapping and verification are implemented and legally approved.

## 10. Rollback and containment

For an application regression, close the D1 AI gate first, keep Access protection in place, and roll
back only to a version whose bindings and migration history are compatible. Never roll back to a
historical version containing removed execution or public-channel surfaces.

If the environment previously ran an older prototype, source deployment alone does not retire it.
Inventory old Worker deployments, traffic percentages, version overrides, Workflow instances,
routes, preview URLs, tunnels, service bindings and retained secrets. Termination/deletion is a
separate destructive change requiring explicit approval and post-action evidence. Until that is
complete, report the new source boundary and legacy remote containment as separate facts.

Prefer forward-fix after a schema change. D1 Time Travel/backup procedures, Access emergency policy,
membership revocation and a no-AI degraded mode must be exercised before commercial traffic.
