import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claimRunForWorkflow, finishRunForWorkflow } from '../src/data/repository.ts';
import {
  launchRunWorkflow,
  reconcileStaleRunningWorkflows,
  reconcileUncertainRunWorkflows,
} from '../src/workflow-launch.ts';
import type { Env } from '../src/types.ts';

let sqlite: DatabaseSync;
let d1: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error_code TEXT,
      workflow_instance_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    INSERT INTO runs VALUES
      ('run_pending', 'org_1', 'pending', NULL, NULL, NULL, '2026-01-01', '2026-01-01', NULL),
      ('run_failed', 'org_1', 'failed', NULL, 'workflow_start_failed', NULL, '2026-01-01', '2026-01-01', '2026-01-01'),
      ('run_running', 'org_1', 'running', NULL, NULL, 'run_running', '2026-01-01', '2026-01-01', NULL);
  `);
  d1 = sqliteD1(sqlite);
});

afterEach(() => sqlite.close());

describe('run workflow state machine', () => {
  it('never revives a failed run', async () => {
    expect(await claimRunForWorkflow(d1, 'org_1', 'run_failed', 'run_failed')).toBe(false);
    expect(sqlite.prepare(`SELECT status FROM runs WHERE id = 'run_failed'`).get()).toEqual({
      status: 'failed',
    });
  });

  it('makes claiming idempotent only for the same workflow instance', async () => {
    expect(await claimRunForWorkflow(d1, 'org_1', 'run_pending', 'run_pending')).toBe(true);
    expect(await claimRunForWorkflow(d1, 'org_1', 'run_pending', 'run_pending')).toBe(true);
    expect(await claimRunForWorkflow(d1, 'org_1', 'run_pending', 'other_workflow')).toBe(false);
    expect(
      await finishRunForWorkflow(d1, 'org_1', 'run_pending', 'run_pending', {
        status: 'completed',
        output: 'private result',
      }),
    ).toBe(true);
    expect(
      await finishRunForWorkflow(d1, 'org_1', 'run_pending', 'run_pending', {
        status: 'failed',
        errorCode: 'late_failure',
      }),
    ).toBe(false);
  });

  it('keeps an ambiguous create pending for deterministic reconciliation', async () => {
    const create = vi.fn().mockRejectedValue(new Error('connection_lost_after_commit'));
    const env = { CONTROL_DB: d1, RUN_WORKFLOW: { create } } as unknown as Env;
    await expect(launchRunWorkflow(env, 'org_1', 'run_pending')).resolves.toBe('uncertain');
    expect(
      sqlite
        .prepare(
          `SELECT status, error_code, workflow_instance_id FROM runs WHERE id = 'run_pending'`,
        )
        .get(),
    ).toEqual({
      status: 'pending',
      error_code: 'workflow_start_uncertain',
      workflow_instance_id: 'run_pending',
    });
  });

  it('reconciles a response-lost create through the deterministic instance handle', async () => {
    sqlite
      .prepare(
        `UPDATE runs SET error_code = 'workflow_start_uncertain',
         workflow_instance_id = 'run_pending', created_at = ?, updated_at = '2026-01-01'
         WHERE id = 'run_pending'`,
      )
      .run(new Date().toISOString());
    const get = vi.fn().mockResolvedValue({
      id: 'run_pending',
      status: vi.fn().mockResolvedValue({ status: 'queued' }),
    });
    const env = { CONTROL_DB: d1, RUN_WORKFLOW: { get } } as unknown as Env;
    await reconcileUncertainRunWorkflows(env);
    expect(get).toHaveBeenCalledWith('run_pending');
    expect(
      sqlite.prepare(`SELECT status, error_code FROM runs WHERE id = 'run_pending'`).get(),
    ).toEqual({ status: 'pending', error_code: 'workflow_waiting_for_claim' });
  });

  it('fails a stale running row when its Workflow is terminal', async () => {
    sqlite
      .prepare(`UPDATE runs SET created_at=?, updated_at='2026-01-01' WHERE id='run_running'`)
      .run(new Date().toISOString());
    const get = vi.fn().mockResolvedValue({
      id: 'run_running',
      status: vi.fn().mockResolvedValue({ status: 'errored' }),
    });
    const env = { CONTROL_DB: d1, RUN_WORKFLOW: { get } } as unknown as Env;
    await reconcileStaleRunningWorkflows(env);
    expect(sqlite.prepare(`SELECT status FROM runs WHERE id = 'run_running'`).get()).toEqual({
      status: 'failed',
    });
    expect(
      await finishRunForWorkflow(d1, 'org_1', 'run_running', 'run_running', {
        status: 'completed',
        output: 'late result',
      }),
    ).toBe(false);
  });

  it('fails a two-hour stale run after a status lookup outage', async () => {
    const get = vi.fn().mockRejectedValue(new Error('status_api_unavailable'));
    const env = { CONTROL_DB: d1, RUN_WORKFLOW: { get } } as unknown as Env;
    await reconcileStaleRunningWorkflows(env);
    expect(sqlite.prepare(`SELECT status FROM runs WHERE id = 'run_running'`).get()).toEqual({
      status: 'failed',
    });
  });

  it('treats an old unknown Workflow status as unavailable', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'run_running',
      status: vi.fn().mockResolvedValue({ status: 'unknown' }),
    });
    const env = { CONTROL_DB: d1, RUN_WORKFLOW: { get } } as unknown as Env;
    await reconcileStaleRunningWorkflows(env);
    expect(sqlite.prepare(`SELECT status FROM runs WHERE id = 'run_running'`).get()).toEqual({
      status: 'failed',
    });
  });

  it('terminates an active Workflow at the absolute two-hour wall-clock limit', async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockResolvedValue({ status: 'running' });
    const get = vi.fn().mockResolvedValue({ id: 'run_running', status, terminate });
    const env = { CONTROL_DB: d1, RUN_WORKFLOW: { get } } as unknown as Env;
    await reconcileStaleRunningWorkflows(env);
    expect(terminate).toHaveBeenCalledWith({ rollback: false });
    expect(status).not.toHaveBeenCalled();
    expect(
      sqlite.prepare(`SELECT status, error_code FROM runs WHERE id='run_running'`).get(),
    ).toEqual({
      status: 'failed',
      error_code: 'workflow_wall_clock_exceeded',
    });
  });
});

function sqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...values: SQLInputValue[]) {
          return {
            async run() {
              const result = database.prepare(sql).run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
            async first<T>() {
              return (database.prepare(sql).get(...values) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: database.prepare(sql).all(...values) as T[] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
