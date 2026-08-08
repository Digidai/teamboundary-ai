import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listRuns } from '../src/data/repository.ts';

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);
  const insert = sqlite.prepare(
    `INSERT INTO runs VALUES (?, 'org_1', 'prj_1', 'chat', 'completed', ?, ?, NULL, ?, ?, ?)`,
  );
  for (let index = 0; index < 100; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    insert.run(
      `run_${String(index).padStart(3, '0')}`,
      `prompt-${index}-` + 'p'.repeat(20_000),
      `secret-output-${index}-` + 's'.repeat(100_000),
      timestamp,
      timestamp,
      timestamp,
    );
  }
});

afterEach(() => sqlite.close());

describe('run list response budget', () => {
  it('returns a bounded summary page without full inputs or any outputs', async () => {
    const result = await listRuns(sqliteD1(sqlite), 'org_1', { limit: 50 });
    const serialized = JSON.stringify(result);
    expect(result.runs).toHaveLength(50);
    expect(result.nextCursor).not.toBeNull();
    expect(Math.max(...result.runs.map((run) => run.input_preview.length))).toBeLessThanOrEqual(
      180,
    );
    expect(serialized).not.toContain('secret-output');
    expect(serialized.length).toBeLessThan(40_000);
  });
});

function sqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...values: SQLInputValue[]) {
          return {
            async all<T>() {
              return { results: database.prepare(sql).all(...values) as T[] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
