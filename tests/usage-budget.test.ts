import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claimAiAttemptBudget } from '../src/usage-budget.ts';

let sqlite: DatabaseSync;
let d1: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(`
    UPDATE deployment_limits SET account_daily_ai_attempt_limit = 3, ai_enabled = 1 WHERE id = 1;
    INSERT INTO identities VALUES
      ('idn_1', 'issuer', 'one', 'one@example.test', NULL, '2026-01-01', '2026-01-01'),
      ('idn_2', 'issuer', 'two', 'two@example.test', NULL, '2026-01-01', '2026-01-01');
    INSERT INTO organizations
      (id, slug, name, daily_ai_attempt_limit, created_at, updated_at)
    VALUES
      ('org_1', 'one', 'One', 2, '2026-01-01', '2026-01-01'),
      ('org_2', 'two', 'Two', 2, '2026-01-01', '2026-01-01');
    INSERT INTO memberships VALUES
      ('org_1', 'idn_1', 'owner', NULL, '2026-01-01'),
      ('org_2', 'idn_2', 'owner', NULL, '2026-01-01');
  `);
  d1 = sqliteD1(sqlite);
});

afterEach(() => sqlite.close());

describe('strong organization and account AI budgets', () => {
  it('atomically caps actual attempts for one organization', async () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => claimAiAttemptBudget(d1, 'org_1', 'idn_1', date)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(3);
    expect(sqlite.prepare(`SELECT ai_attempts FROM organization_usage_daily`).get()).toEqual({
      ai_attempts: 2,
    });
  });

  it('enforces the account ceiling across organizations without partial org increments', async () => {
    const date = new Date('2026-01-01T00:00:00Z');
    await claimAiAttemptBudget(d1, 'org_1', 'idn_1', date);
    await claimAiAttemptBudget(d1, 'org_1', 'idn_1', date);
    await claimAiAttemptBudget(d1, 'org_2', 'idn_2', date);
    await expect(claimAiAttemptBudget(d1, 'org_2', 'idn_2', date)).rejects.toMatchObject({
      status: 429,
      code: 'account_ai_budget_exhausted',
    });
    expect(
      sqlite
        .prepare(`SELECT ai_attempts FROM organization_usage_daily WHERE organization_id='org_2'`)
        .get(),
    ).toEqual({ ai_attempts: 1 });
    expect(sqlite.prepare(`SELECT ai_attempts FROM account_usage_daily`).get()).toEqual({
      ai_attempts: 3,
    });
  });

  it('fails closed without writing usage when the dynamic D1 switch is disabled', async () => {
    sqlite.exec(`UPDATE deployment_limits SET ai_enabled = 0 WHERE id = 1`);
    await expect(
      claimAiAttemptBudget(d1, 'org_1', 'idn_1', new Date('2026-01-01T00:00:00Z')),
    ).rejects.toMatchObject({ status: 503, code: 'ai_disabled' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM organization_usage_daily`).get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM account_usage_daily`).get()).toEqual({
      count: 0,
    });
  });

  it.each(['revoked', 'viewer'] as const)(
    'rejects an actual attempt after the requester becomes %s',
    async (state) => {
      if (state === 'revoked') {
        sqlite.exec(`UPDATE memberships SET revoked_at='2026-01-01' WHERE identity_id='idn_1'`);
      } else {
        sqlite.exec(`UPDATE memberships SET role='viewer' WHERE identity_id='idn_1'`);
      }
      await expect(
        claimAiAttemptBudget(d1, 'org_1', 'idn_1', new Date('2026-01-01T00:00:00Z')),
      ).rejects.toMatchObject({ status: 403, code: 'membership_not_authorized' });
      expect(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM organization_usage_daily`).get(),
      ).toEqual({ count: 0 });
    },
  );
});

function sqliteD1(database: DatabaseSync): D1Database {
  interface BoundStatement {
    sql: string;
    values: SQLInputValue[];
  }
  return {
    prepare(sql: string) {
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
      });
      return { bind, ...bind() };
    },
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
