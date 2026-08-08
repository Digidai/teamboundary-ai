import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/types.ts';
import { RunWorkflow } from '../src/workflows/run-workflow.ts';

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(`
    INSERT INTO identities VALUES
      ('idn_1', 'issuer', 'subject', 'person@example.test', NULL, '2026-01-01', '2026-01-01');
    INSERT INTO organizations VALUES
      ('org_1', 'one', 'One', 50, 10, 50, 100, 90, '2026-01-01', '2026-01-01');
    INSERT INTO memberships VALUES
      ('org_1', 'idn_1', 'owner', NULL, '2026-01-01');
    INSERT INTO projects VALUES
      ('prj_1', 'org_1', 'Project', '', '2026-01-01', '2026-01-01');
    UPDATE deployment_limits SET ai_enabled=1 WHERE id=1;
    INSERT INTO runs
      (id, organization_id, project_id, requested_by, kind, status, input, error_code,
       workflow_instance_id, created_at, updated_at)
    VALUES
      ('run_1', 'org_1', 'prj_1', 'idn_1', 'chat', 'pending', 'private prompt',
       'workflow_launch_pending', 'run_1', '2026-01-01', '2026-01-01');
    UPDATE deployment_limits SET ai_enabled=0 WHERE id=1;
  `);
});

afterEach(() => sqlite.close());

describe('Workflow dynamic AI kill switch', () => {
  it('does not call AI after the D1 switch is disabled and persists a safe terminal code', async () => {
    const aiRun = vi.fn();
    const env = {
      CONTROL_DB: sqliteD1(sqlite),
      AI: { run: aiRun },
      AI_ENABLED: 'true',
      AI_GATEWAY_ID: 'private-gateway',
    } as unknown as Env;
    const workflow = new RunWorkflow({} as ExecutionContext, env);
    (workflow as unknown as { env: Env }).env = env;
    const step = {
      async do(
        _name: string,
        optionsOrCallback: unknown,
        callback?: () => Promise<unknown>,
      ): Promise<unknown> {
        const operation =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as () => Promise<unknown>)
            : callback;
        if (!operation) throw new Error('missing step callback');
        return operation();
      },
    };

    await workflow.run(
      { payload: { organizationId: 'org_1', runId: 'run_1' } } as never,
      step as never,
    );

    expect(aiRun).not.toHaveBeenCalled();
    expect(
      sqlite.prepare(`SELECT status, error_code, output FROM runs WHERE id='run_1'`).get(),
    ).toEqual({ status: 'failed', error_code: 'ai_disabled', output: null });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM organization_usage_daily`).get()).toEqual({
      count: 0,
    });
  });

  it('does not claim budget or call AI when an old enabled version lacks a Gateway binding', async () => {
    sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
    const aiRun = vi.fn();
    const env = {
      CONTROL_DB: sqliteD1(sqlite),
      AI: { run: aiRun },
      AI_ENABLED: 'true',
    } as unknown as Env;
    const workflow = new RunWorkflow({} as ExecutionContext, env);
    (workflow as unknown as { env: Env }).env = env;

    await workflow.run(
      { payload: { organizationId: 'org_1', runId: 'run_1' } } as never,
      immediateStep() as never,
    );

    expect(aiRun).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT status, error_code FROM runs WHERE id='run_1'`).get()).toEqual({
      status: 'failed',
      error_code: 'ai_gateway_not_configured',
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM organization_usage_daily`).get()).toEqual({
      count: 0,
    });
  });

  it.each(['revoked', 'viewer'] as const)(
    'does not call AI when the requester is %s after run admission',
    async (state) => {
      sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
      if (state === 'revoked') {
        sqlite.exec(`UPDATE memberships SET revoked_at='2026-01-02' WHERE identity_id='idn_1'`);
      } else {
        sqlite.exec(`UPDATE memberships SET role='viewer' WHERE identity_id='idn_1'`);
      }
      const aiRun = vi.fn();
      const env = {
        CONTROL_DB: sqliteD1(sqlite),
        AI: { run: aiRun },
        AI_ENABLED: 'true',
        AI_GATEWAY_ID: 'private-gateway',
      } as unknown as Env;
      const workflow = new RunWorkflow({} as ExecutionContext, env);
      (workflow as unknown as { env: Env }).env = env;
      const step = immediateStep();

      await workflow.run(
        { payload: { organizationId: 'org_1', runId: 'run_1' } } as never,
        step as never,
      );

      expect(aiRun).not.toHaveBeenCalled();
      expect(sqlite.prepare(`SELECT status, error_code FROM runs WHERE id='run_1'`).get()).toEqual({
        status: 'failed',
        error_code: 'membership_not_authorized',
      });
      expect(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM organization_usage_daily`).get(),
      ).toEqual({ count: 0 });
    },
  );
});

function immediateStep() {
  return {
    async do(
      _name: string,
      optionsOrCallback: unknown,
      callback?: () => Promise<unknown>,
    ): Promise<unknown> {
      const operation =
        typeof optionsOrCallback === 'function'
          ? (optionsOrCallback as () => Promise<unknown>)
          : callback;
      if (!operation) throw new Error('missing step callback');
      return operation();
    },
  };
}

interface BoundStatement {
  sql: string;
  values: SQLInputValue[];
}

function sqliteD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (...values: SQLInputValue[]) => ({
      sql,
      values,
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
    });
    return { bind, ...bind() };
  };
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => {
          const bound = statement as unknown as BoundStatement;
          const result = database.prepare(bound.sql).run(...bound.values);
          return { meta: { changes: Number(result.changes) } };
        });
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}
