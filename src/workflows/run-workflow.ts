import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import { claimRunForWorkflow, finishRunForWorkflow, getRun } from '../data/repository.ts';
import { executeSupportedRun } from '../run-policy.ts';
import type { Env, RunPayload } from '../types.ts';
import { claimAiAttemptBudget } from '../usage-budget.ts';

export class RunWorkflow extends WorkflowEntrypoint<Env, RunPayload> {
  override async run(event: WorkflowEvent<RunPayload>, step: WorkflowStep): Promise<void> {
    const { organizationId, runId } = event.payload;

    const claimed = await step.do('claim pending run', async () => {
      try {
        return await claimRunForWorkflow(this.env.CONTROL_DB, organizationId, runId, runId);
      } catch {
        throw new Error('run_claim_failed');
      }
    });
    if (!claimed) return;

    const readinessError =
      this.env.AI_ENABLED !== 'true'
        ? 'ai_disabled'
        : !this.env.AI_GATEWAY_ID
          ? 'ai_gateway_not_configured'
          : null;
    if (readinessError) {
      await step.do('persist disabled run', async () => {
        try {
          await finishRunForWorkflow(this.env.CONTROL_DB, organizationId, runId, runId, {
            status: 'failed',
            errorCode: readinessError,
          });
        } catch {
          throw new Error('failure_persistence_failed');
        }
      });
      return;
    }

    try {
      await step.do(
        'generate and persist bounded run',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' },
        async () => {
          let run;
          try {
            run = await getRun(this.env.CONTROL_DB, organizationId, runId);
          } catch {
            throw new Error('run_state_unavailable');
          }
          if (!run) throw new NonRetryableError('run_not_found');
          if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
            return 'already_terminal';
          }

          let output: string;
          try {
            await claimAiAttemptBudget(this.env.CONTROL_DB, organizationId, run.requested_by);
            output = await executeSupportedRun(this.env, run);
          } catch (error) {
            if (error instanceof Error && error.message === 'unsupported_run_kind') {
              throw new NonRetryableError('unsupported_run_kind');
            }
            if (
              error instanceof Error &&
              [
                'ai_disabled',
                'ai_gateway_not_configured',
                'membership_not_authorized',
                'organization_ai_budget_exhausted',
                'account_ai_budget_exhausted',
              ].includes(error.message)
            ) {
              throw new NonRetryableError(error.message);
            }
            throw new Error('ai_generation_failed');
          }
          try {
            await finishRunForWorkflow(this.env.CONTROL_DB, organizationId, runId, runId, {
              status: 'completed',
              output,
            });
          } catch {
            throw new Error('run_persistence_failed');
          }
          return 'completed';
        },
      );
    } catch (error) {
      await step.do('persist failed run', async () => {
        const code =
          error instanceof Error && error.message === 'unsupported_run_kind'
            ? 'unsupported_run_kind'
            : error instanceof Error &&
                [
                  'ai_disabled',
                  'ai_gateway_not_configured',
                  'membership_not_authorized',
                  'organization_ai_budget_exhausted',
                  'account_ai_budget_exhausted',
                ].includes(error.message)
              ? error.message
              : 'run_failed';
        try {
          await finishRunForWorkflow(this.env.CONTROL_DB, organizationId, runId, runId, {
            status: 'failed',
            errorCode: code,
          });
        } catch {
          throw new Error('failure_persistence_failed');
        }
      });
    }
  }
}
