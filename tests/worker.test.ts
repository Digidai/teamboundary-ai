import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/worker.ts';
import type { Env } from '../src/types.ts';

let sqlite: DatabaseSync;
let env: Env;
let workflowCreate: ReturnType<typeof vi.fn>;
let background: Promise<unknown>[];

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  workflowCreate = vi.fn(async ({ id }: { id: string }) => ({
    id,
    status: async () => ({ status: 'queued' as const }),
  }));
  const allow = { limit: vi.fn().mockResolvedValue({ success: true }) };
  env = {
    CONTROL_DB: sqliteD1(sqlite),
    AI: { run: vi.fn() },
    ACCOUNT_RATE_LIMITER: allow,
    REQUEST_RATE_LIMITER: allow,
    MUTATION_RATE_LIMITER: allow,
    AI_RATE_LIMITER: allow,
    RUN_WORKFLOW: { create: workflowCreate, get: vi.fn() },
    APP_ENV: 'development',
    AUTH_MODE: 'dev',
    PROVISIONING_MODE: 'personal',
    AI_ENABLED: 'false',
    AI_GATEWAY_ID: 'private-gateway',
  } as unknown as Env;
  background = [];
});

afterEach(() => sqlite.close());

describe('worker mutation boundaries', () => {
  it('writes nothing for a run when the deployment AI switch is off', async () => {
    const { organizationId, projectId } = await bootstrapProject();
    const before = counts();
    const response = await post(`/api/v1/organizations/${organizationId}/runs`, {
      key: '00000000-0000-4000-8000-000000000003',
      body: { kind: 'chat', projectId, input: 'blocked' },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ai_disabled' } });
    expect(counts()).toEqual(before);
    expect(workflowCreate).not.toHaveBeenCalled();
  });

  it('writes nothing when an enabled Worker version has no reviewed AI Gateway', async () => {
    const { organizationId, projectId } = await bootstrapProject();
    env.AI_ENABLED = 'true';
    delete env.AI_GATEWAY_ID;
    sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
    const before = counts();
    const response = await post(`/api/v1/organizations/${organizationId}/runs`, {
      key: crypto.randomUUID(),
      body: { kind: 'chat', projectId, input: 'must not bypass Gateway' },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'ai_gateway_not_configured' },
    });
    expect(counts()).toEqual(before);
    expect(workflowCreate).not.toHaveBeenCalled();
  });

  it('launches one Workflow for concurrent duplicates and none for later replays', async () => {
    const { organizationId, projectId } = await bootstrapProject();
    env.AI_ENABLED = 'true';
    sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
    const options = {
      key: '00000000-0000-4000-8000-000000000004',
      body: { kind: 'chat', projectId, input: 'one operation' },
    };
    const [first, concurrent] = await Promise.all([
      post(`/api/v1/organizations/${organizationId}/runs`, options),
      post(`/api/v1/organizations/${organizationId}/runs`, options),
    ]);
    expect([first.status, concurrent.status]).toEqual([202, 202]);
    await Promise.all(background);
    expect(workflowCreate).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM runs`).get()).toEqual({ count: 1 });

    env.AI_ENABLED = 'false';
    const replay = await post(`/api/v1/organizations/${organizationId}/runs`, options);
    expect(replay.status).toBe(202);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    await Promise.all(background);
    expect(workflowCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects a different body on the same key without another run or launch', async () => {
    const { organizationId, projectId } = await bootstrapProject();
    env.AI_ENABLED = 'true';
    sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
    const key = '00000000-0000-4000-8000-000000000005';
    expect(
      (
        await post(`/api/v1/organizations/${organizationId}/runs`, {
          key,
          body: { kind: 'chat', projectId, input: 'A' },
        })
      ).status,
    ).toBe(202);
    await Promise.all(background);
    const conflict = await post(`/api/v1/organizations/${organizationId}/runs`, {
      key,
      body: { kind: 'chat', projectId, input: 'B' },
    });
    expect(conflict.status).toBe(409);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM runs`).get()).toEqual({ count: 1 });
    expect(workflowCreate).toHaveBeenCalledTimes(1);
  });

  it('immediately denies a still-valid identity after its membership is revoked', async () => {
    const { organizationId } = await bootstrapProject();
    sqlite
      .prepare(`UPDATE memberships SET revoked_at=? WHERE organization_id=?`)
      .run(new Date().toISOString(), organizationId);
    const response = await call('/api/v1/me');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'identity_not_provisioned' },
    });
  });

  it.each(['revoke', 'demote'] as const)(
    'rolls back a mutation when an operator performs a concurrent %s',
    async (change) => {
      const { organizationId, projectId } = await bootstrapProject();
      env.AI_ENABLED = 'true';
      sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
      const before = counts();
      const originalBatch = env.CONTROL_DB.batch.bind(env.CONTROL_DB);
      let intercepted = false;
      env.CONTROL_DB.batch = async (statements) => {
        if (!intercepted) {
          intercepted = true;
          if (change === 'revoke') {
            sqlite
              .prepare(`UPDATE memberships SET revoked_at=? WHERE organization_id=?`)
              .run(new Date().toISOString(), organizationId);
          } else {
            sqlite
              .prepare(`UPDATE memberships SET role='viewer' WHERE organization_id=?`)
              .run(organizationId);
          }
        }
        return originalBatch(statements);
      };

      const response = await post(`/api/v1/organizations/${organizationId}/runs`, {
        key: crypto.randomUUID(),
        body: { kind: 'chat', projectId, input: 'must not commit' },
      });
      expect(response.status).toBe(404);
      expect(counts()).toEqual(before);
      expect(workflowCreate).not.toHaveBeenCalled();
    },
  );

  it('atomically rejects a new run when the dynamic D1 switch closes after authorization', async () => {
    const { organizationId, projectId } = await bootstrapProject();
    env.AI_ENABLED = 'true';
    sqlite.exec(`UPDATE deployment_limits SET ai_enabled=1 WHERE id=1`);
    const before = counts();
    const originalBatch = env.CONTROL_DB.batch.bind(env.CONTROL_DB);
    let intercepted = false;
    env.CONTROL_DB.batch = async (statements) => {
      if (!intercepted) {
        intercepted = true;
        sqlite.exec(`UPDATE deployment_limits SET ai_enabled=0 WHERE id=1`);
      }
      return originalBatch(statements);
    };

    const response = await post(`/api/v1/organizations/${organizationId}/runs`, {
      key: crypto.randomUUID(),
      body: { kind: 'chat', projectId, input: 'must remain disabled' },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ai_disabled' } });
    expect(counts()).toEqual(before);
    expect(workflowCreate).not.toHaveBeenCalled();
  });

  it('denies cross-tenant route and project substitution at the HTTP boundary', async () => {
    const { organizationId } = await bootstrapProject();
    sqlite.exec(`
      INSERT INTO identities VALUES
        ('idn_other', 'issuer', 'other', 'other@example.test', NULL, '2026-01-01', '2026-01-01');
      INSERT INTO organizations
        (id, slug, name, created_at, updated_at)
      VALUES ('org_other', 'other', 'Other', '2026-01-01', '2026-01-01');
      INSERT INTO memberships VALUES
        ('org_other', 'idn_other', 'owner', NULL, '2026-01-01');
      INSERT INTO projects VALUES
        ('prj_other', 'org_other', 'Other project', '', '2026-01-01', '2026-01-01');
      UPDATE deployment_limits SET ai_enabled=1 WHERE id=1;
      INSERT INTO runs
        (id, organization_id, project_id, requested_by, kind, status, input,
         created_at, updated_at)
      VALUES
        ('run_other', 'org_other', 'prj_other', 'idn_other', 'chat', 'completed', 'secret',
         '2026-01-01', '2026-01-01');
      UPDATE deployment_limits SET ai_enabled=0 WHERE id=1;
    `);

    expect((await call('/api/v1/organizations/org_other/projects')).status).toBe(404);
    expect((await call('/api/v1/organizations/org_other/runs/run_other')).status).toBe(404);
    expect((await call(`/api/v1/organizations/${organizationId}/runs/run_other`)).status).toBe(404);
    const create = await post(`/api/v1/organizations/${organizationId}/runs`, {
      key: crypto.randomUUID(),
      body: { kind: 'chat', projectId: 'prj_other', input: 'cross tenant' },
    });
    expect(create.status).toBe(404);
    expect(workflowCreate).not.toHaveBeenCalled();
  });

  it('rejects a cross-site GET before rate limits or D1 provisioning', async () => {
    const limiter = env.REQUEST_RATE_LIMITER.limit as unknown as ReturnType<typeof vi.fn>;
    const beforeCalls = limiter.mock.calls.length;
    const before = counts();
    const response = await call('/api/v1/me', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(403);
    expect(limiter.mock.calls).toHaveLength(beforeCalls);
    expect(counts()).toEqual(before);
  });
});

async function bootstrapProject(): Promise<{ organizationId: string; projectId: string }> {
  const me = await call('/api/v1/me');
  expect(me.status).toBe(200);
  const identity = (await me.json()) as { organizations: Array<{ organizationId: string }> };
  const organizationId = identity.organizations[0]?.organizationId;
  if (!organizationId) throw new Error('missing development organization');
  const response = await post(`/api/v1/organizations/${organizationId}/projects`, {
    key: crypto.randomUUID(),
    body: { name: 'Project', description: '' },
  });
  expect(response.status).toBe(201);
  const result = (await response.json()) as { project: { id: string } };
  return { organizationId, projectId: result.project.id };
}

function counts() {
  return {
    runs: sqlite.prepare(`SELECT COUNT(*) AS value FROM runs`).get()?.value,
    receipts: sqlite.prepare(`SELECT COUNT(*) AS value FROM idempotency_receipts`).get()?.value,
    audits: sqlite.prepare(`SELECT COUNT(*) AS value FROM audit_events`).get()?.value,
    usage: sqlite.prepare(`SELECT COUNT(*) AS value FROM organization_usage_daily`).get()?.value,
  };
}

async function post(path: string, options: { key: string; body: unknown }): Promise<Response> {
  return call(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': options.key,
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(options.body),
  });
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const executionContext = {
    waitUntil(promise: Promise<unknown>) {
      background.push(promise);
    },
    passThroughOnException() {},
  } as ExecutionContext;
  const handler = worker.fetch;
  if (!handler) throw new Error('missing fetch handler');
  const request = new Request(`http://localhost${path}`, init) as unknown as Parameters<
    typeof handler
  >[0];
  return handler(request, env, executionContext);
}

interface SqliteStatement {
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
          const bound = statement as unknown as SqliteStatement;
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
