import { beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';

beforeAll(async () => {
  const bindings = env as unknown as {
    CONTROL_DB: D1Database;
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  await applyD1Migrations(bindings.CONTROL_DB, bindings.TEST_MIGRATIONS);
});
