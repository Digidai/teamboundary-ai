# Product scope

TeamBoundary AI 0.1 is a narrow, multi-tenant AI workspace reference implementation. It demonstrates
how to combine Cloudflare Access, D1, Workflows, AI Gateway and Workers AI with explicit
authorization, idempotency, cost ceilings and retention.

## User journey

1. An operator pre-provisions an Access identity and organization membership in D1.
2. Access authenticates the user; the Worker independently validates the JWT.
3. The member creates a project with an idempotency key.
4. An owner, admin or member submits a bounded chat run with an idempotency key.
5. D1 atomically records the run, audit event, receipt and admission counters.
6. A deterministic Workflow instance claims the run, claims an AI-attempt budget, calls one approved
   model and stores the bounded response in the tenant run record.
7. The UI polls only while a run is active and fetches full content only from the authorized detail
   endpoint.

## Non-goals for 0.1

- anonymous or self-service signup;
- model selection, agent tools or autonomous side effects;
- arbitrary code, browser or desktop execution;
- uploads, knowledge bases, embeddings or search;
- model marketplace, visual workflow builder or connector ecosystem;
- promises of compliance, uptime, recovery time or support SLA.

## Product claims allowed today

- independent Apache-2.0 source project;
- Cloudflare-native reference architecture;
- tenant authorization and cost limits enforced in D1;
- automated Node and workerd regression tests;
- production configuration defaults fail closed.

Do not claim `zero risk`, `commercial ready`, `legally cleared`, `compliant`, `fully isolated` or
`official Cloudflare product`. Those conclusions require deployment evidence and external legal,
privacy and security approval.

## Before a hosted commercial launch

The operator must complete the hosted-service checklist, including data export/deletion, privacy and
content policies, incident response, recovery drills, spend controls, penetration testing, legal
terms, DPA/subprocessor review and a supported vulnerability intake. Open-source publication alone
does not satisfy those obligations.
