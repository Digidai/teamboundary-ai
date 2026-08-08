import {
  failPendingRunWorkflow,
  failRunningRunWorkflow,
  recordRunWorkflowLaunch,
} from './data/repository.ts';
import { nowIso } from './lib/ids.ts';
import type { Env } from './types.ts';

const RETENTION = { successRetention: '1 hour', errorRetention: '1 hour' } as const;

export async function launchRunWorkflow(
  env: Env,
  organizationId: string,
  runId: string,
): Promise<'started' | 'uncertain'> {
  try {
    const workflow = await env.RUN_WORKFLOW.create({
      id: runId,
      params: { runId, organizationId },
      retention: RETENTION,
    });
    await recordRunWorkflowLaunch(env.CONTROL_DB, organizationId, runId, workflow.id, false);
    return 'started';
  } catch {
    await recordRunWorkflowLaunch(env.CONTROL_DB, organizationId, runId, runId, true);
    return 'uncertain';
  }
}

export async function reconcileUncertainRunWorkflows(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 60 * 1_000).toISOString();
  const result = await env.CONTROL_DB.prepare(
    `SELECT id, organization_id, created_at
     FROM runs
     WHERE status = 'pending'
       AND error_code IN (
         'workflow_launch_pending',
         'workflow_start_uncertain',
         'workflow_waiting_for_claim'
       )
       AND updated_at <= ?
     ORDER BY updated_at ASC
     LIMIT 100`,
  )
    .bind(cutoff)
    .all<{ id: string; organization_id: string; created_at: string }>();

  for (const run of result.results) {
    try {
      const instance = await env.RUN_WORKFLOW.get(run.id);
      const { status } = await instance.status();
      if (['queued', 'running', 'paused', 'waiting', 'waitingForPause'].includes(status)) {
        if (Date.parse(run.created_at) <= Date.now() - 60 * 60 * 1_000) {
          try {
            await instance.terminate?.({ rollback: false });
          } catch {
            console.error('workflow_claim_timeout_termination_failed', { runId: run.id });
          }
          await failPendingRunWorkflow(
            env.CONTROL_DB,
            run.organization_id,
            run.id,
            'workflow_claim_timeout',
          );
          continue;
        }
        await recordRunWorkflowLaunch(
          env.CONTROL_DB,
          run.organization_id,
          run.id,
          instance.id,
          false,
        );
        continue;
      }
      if (['errored', 'terminated', 'complete'].includes(status)) {
        await failPendingRunWorkflow(
          env.CONTROL_DB,
          run.organization_id,
          run.id,
          'workflow_terminal_without_run_result',
        );
        continue;
      }
    } catch {
      // A missing instance and a transient lookup failure are both reconciled by the deterministic ID.
    }

    if (Date.parse(run.created_at) <= Date.now() - 15 * 60 * 1_000) {
      const failed = await failPendingRunWorkflow(
        env.CONTROL_DB,
        run.organization_id,
        run.id,
        'workflow_start_reconciliation_exhausted',
      );
      if (failed) console.error('workflow_launch_reconciliation_exhausted', { runId: run.id });
      continue;
    }
    await launchRunWorkflow(env, run.organization_id, run.id);
  }
}

export async function reconcileStaleRunningWorkflows(env: Env): Promise<void> {
  const staleCutoff = new Date(Date.now() - 20 * 60 * 1_000).toISOString();
  const wallClockCutoff = Date.now() - 2 * 60 * 60 * 1_000;
  const result = await env.CONTROL_DB.prepare(
    `SELECT id, organization_id, workflow_instance_id, created_at
     FROM runs
     WHERE status = 'running' AND workflow_instance_id IS NOT NULL AND updated_at <= ?
     ORDER BY updated_at ASC
     LIMIT 100`,
  )
    .bind(staleCutoff)
    .all<{
      id: string;
      organization_id: string;
      workflow_instance_id: string;
      created_at: string;
    }>();

  for (const run of result.results) {
    if (Date.parse(run.created_at) <= wallClockCutoff) {
      try {
        const instance = await env.RUN_WORKFLOW.get(run.workflow_instance_id);
        await instance.terminate?.({ rollback: false });
      } catch {
        // The D1 state still fails closed; operators inspect/terminate a missing control-plane handle.
      }
      const failed = await failRunningRunWorkflow(
        env.CONTROL_DB,
        run.organization_id,
        run.id,
        run.workflow_instance_id,
        'workflow_wall_clock_exceeded',
      );
      if (failed) console.error('workflow_wall_clock_exceeded', { runId: run.id });
      continue;
    }

    try {
      const instance = await env.RUN_WORKFLOW.get(run.workflow_instance_id);
      const { status } = await instance.status();
      if (['errored', 'terminated', 'complete'].includes(status)) {
        const failed = await failRunningRunWorkflow(
          env.CONTROL_DB,
          run.organization_id,
          run.id,
          run.workflow_instance_id,
          'workflow_terminal_without_run_result',
        );
        if (failed) console.error('workflow_terminal_without_run_result', { runId: run.id });
      }
      if (status === 'unknown') throw new Error('workflow_status_unknown');
      continue;
    } catch {
      continue;
    }
  }
}
