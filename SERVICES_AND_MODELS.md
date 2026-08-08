# Services and models

Reviewed: 2026-08-08. Re-check all terms, availability and prices immediately before a hosted
release.

TeamBoundary AI source is licensed under Apache-2.0. That license does not grant rights to Cloudflare
services, hosted model weights, model outputs, customer data or third-party datasets.

## Cloudflare services used by version 0.1

- Cloudflare Workers and Static Assets
- Cloudflare Access
- D1
- Workflows
- Workers AI
- mandatory AI Gateway configuration for any AI-enabled release
- Workers rate-limit bindings and observability

Operators must accept the applicable Cloudflare terms, Data Processing Addendum and acceptable-use
rules, verify the chosen account plan and region, and document telemetry/retention and subprocessors.

## Approved model boundary

Version 0.1 hard-codes `@cf/openai/gpt-oss-120b`. The repository does not redistribute its weights.
Before enabling inference, review the current Cloudflare model catalog entry, model/provider license,
usage policy, safety limitations, geographic availability, token pricing and data handling. The
application fixes the model, caps input and output, exposes no tools and disables AI Gateway prompt
logging with `collectLog: false`.

The system prompt is not a content-safety control. A hosted operator must configure independently
reviewed input/output guardrails and DLP in the target account, test bypasses and false positives,
verify the interaction between Guardrail evaluation events and raw-payload logging/retention,
publish user/content policies and operate an abuse/appeal process before commercial traffic.

Changing the model identifier, input/output ceiling, provider route or logging behavior is a release
review event. It must update the threat model, cost ceiling, tests, this file and the dated legal/AUP
evidence.
