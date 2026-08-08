import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commitIdempotentMutation,
  deterministicMutationId,
  prepareMutation,
} from '../src/idempotency.ts';
import type { Actor } from '../src/types.ts';

const actor = { identityId: 'idn_1' } as Actor;
const key = '00000000-0000-4000-8000-000000000001';
let sqlite: DatabaseSync;
let d1: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE idempotency_receipts (
      organization_id TEXT NOT NULL,
      identity_id TEXT NOT NULL,
      route TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, identity_id, route, idempotency_key)
    );
  `);
  d1 = sqliteD1(sqlite);
});

afterEach(() => sqlite.close());

describe('atomic idempotent mutation', () => {
  it('commits the resource and completed receipt once, then replays', async () => {
    const mutation = await prepareMutation(request(key, '{"name":"Project"}'));
    const projectId = await deterministicMutationId('prj', actor, 'org_1', mutation);
    const first = await commitIdempotentMutation(
      d1,
      actor,
      'org_1',
      mutation,
      { type: 'project', id: projectId },
      [d1.prepare(`INSERT INTO projects VALUES (?, 'org_1', 'Project')`).bind(projectId)],
      201,
      { project: { id: projectId } },
    );
    expect(first.committed).toBe(true);

    const replay = await commitIdempotentMutation(
      d1,
      actor,
      'org_1',
      mutation,
      { type: 'project', id: projectId },
      [d1.prepare(`INSERT INTO projects VALUES (?, 'org_1', 'Project')`).bind(projectId)],
      201,
      { project: { id: projectId } },
    );
    expect(replay.committed).toBe(false);
    expect(replay.response.headers.get('Idempotency-Replayed')).toBe('true');
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM projects`).get()).toEqual({ count: 1 });
  });

  it('rejects the same key with a different body and keeps one resource', async () => {
    const first = await prepareMutation(request(key, '{"name":"A"}'));
    const projectId = await deterministicMutationId('prj', actor, 'org_1', first);
    await commitIdempotentMutation(
      d1,
      actor,
      'org_1',
      first,
      { type: 'project', id: projectId },
      [d1.prepare(`INSERT INTO projects VALUES (?, 'org_1', 'A')`).bind(projectId)],
      201,
      { project: { id: projectId } },
    );
    const conflicting = await prepareMutation(request(key, '{"name":"B"}'));
    expect(await deterministicMutationId('prj', actor, 'org_1', conflicting)).toBe(projectId);
    await expect(
      commitIdempotentMutation(
        d1,
        actor,
        'org_1',
        conflicting,
        { type: 'project', id: projectId },
        [d1.prepare(`INSERT INTO projects VALUES (?, 'org_1', 'B')`).bind(projectId)],
        201,
        { project: { id: projectId } },
      ),
    ).rejects.toMatchObject({ status: 409, code: 'idempotency_key_conflict' });
    expect(sqlite.prepare(`SELECT name FROM projects`).get()).toEqual({ name: 'A' });
  });

  it('serializes concurrent duplicates into one commit and one replay', async () => {
    const mutation = await prepareMutation(request(key, '{"name":"A"}'));
    const projectId = await deterministicMutationId('prj', actor, 'org_1', mutation);
    const execute = () =>
      commitIdempotentMutation(
        d1,
        actor,
        'org_1',
        mutation,
        { type: 'project', id: projectId },
        [d1.prepare(`INSERT INTO projects VALUES (?, 'org_1', 'A')`).bind(projectId)],
        201,
        { project: { id: projectId } },
      );
    const results = await Promise.all([execute(), execute()]);
    expect(results.map((result) => result.committed).sort()).toEqual([false, true]);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM projects`).get()).toEqual({ count: 1 });
  });

  it('rolls back the receipt when the resource statement fails', async () => {
    const mutation = await prepareMutation(request(key, '{"name":"A"}'));
    await expect(
      commitIdempotentMutation(
        d1,
        actor,
        'org_1',
        mutation,
        { type: 'project', id: 'prj_broken' },
        [d1.prepare(`INSERT INTO missing_table VALUES (1)`)],
        201,
        { project: { id: 'prj_broken' } },
      ),
    ).rejects.toThrow();
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM idempotency_receipts`).get()).toEqual({
      count: 0,
    });
  });
});

function request(idempotencyKey: string, body: string): Request {
  return new Request('https://app.example/api/v1/organizations/org_1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body,
  });
}

interface SqliteStatement {
  sql: string;
  values: SQLInputValue[];
}

function sqliteD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => ({
    bind(...values: SQLInputValue[]) {
      const statement = {
        sql,
        values,
        async run() {
          const result = database.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return (database.prepare(sql).get(...values) as T | undefined) ?? null;
        },
      };
      return statement;
    },
  });
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
