import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const migrations = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort();
if (migrations.join(',') !== '0001_initial.sql') {
  throw new Error(
    `Fresh TeamBoundary AI schema must have exactly 0001_initial.sql; got ${migrations}`,
  );
}

const database = new DatabaseSync(':memory:');
database.exec(await readFile(new URL('0001_initial.sql', migrationsDirectory), 'utf8'));
const timestamp = '2026-08-02T00:00:00.000Z';

database.exec(`
  INSERT INTO identities VALUES
    ('idn_a', 'issuer', 'a', 'a@example.test', NULL, '${timestamp}', '${timestamp}'),
    ('idn_b', 'issuer', 'b', 'b@example.test', NULL, '${timestamp}', '${timestamp}');
  INSERT INTO organizations
    (id, slug, name, project_limit, active_run_limit, daily_run_limit,
     daily_ai_attempt_limit, run_retention_days, created_at, updated_at)
  VALUES
    ('org_a', 'org-a', 'A', 1, 1, 2, 2, 90, '${timestamp}', '${timestamp}'),
    ('org_b', 'org-b', 'B', 1, 1, 2, 2, 90, '${timestamp}', '${timestamp}');
  INSERT INTO memberships VALUES
    ('org_a', 'idn_a', 'owner', NULL, '${timestamp}'),
    ('org_b', 'idn_b', 'owner', NULL, '${timestamp}');
  INSERT INTO projects VALUES ('prj_a', 'org_a', 'Project A', '', '${timestamp}', '${timestamp}');
  INSERT INTO projects VALUES ('prj_b', 'org_b', 'Project B', '', '${timestamp}', '${timestamp}');
  UPDATE deployment_limits SET ai_enabled=1 WHERE id=1;
`);

expectConstraint(
  () => database.exec(`DELETE FROM deployment_limits WHERE id=1`),
  'deployment limit singleton deletion',
);

expectConstraint(
  () =>
    database.exec(
      `INSERT INTO projects VALUES ('prj_over', 'org_a', 'Too many', '', '${timestamp}', '${timestamp}')`,
    ),
  'organization project limit',
);
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO runs
        (id, organization_id, project_id, requested_by, kind, status, input, created_at, updated_at)
      VALUES ('run_code', 'org_a', 'prj_a', 'idn_a', 'code', 'pending', 'x', '${timestamp}', '${timestamp}')
    `),
  'non-chat run kind',
);
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO runs
        (id, organization_id, project_id, requested_by, kind, status, input, created_at, updated_at)
      VALUES ('run_cross_actor', 'org_a', 'prj_a', 'idn_b', 'chat', 'pending', 'x', '${timestamp}', '${timestamp}')
    `),
  'cross-tenant run requester',
);
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO audit_events
        (id, organization_id, actor_identity_id, action, resource_type, resource_id, request_id, created_at)
      VALUES ('aud_cross', 'org_a', 'idn_b', 'test', 'run', 'run_x', 'req', '${timestamp}')
    `),
  'cross-tenant audit actor',
);

database.exec(`
  INSERT INTO runs
    (id, organization_id, project_id, requested_by, kind, status, input,
     error_code, workflow_instance_id, created_at, updated_at)
  VALUES
    ('run_a', 'org_a', 'prj_a', 'idn_a', 'chat', 'pending', 'x',
     'workflow_launch_pending', 'run_a', '${timestamp}', '${timestamp}');
`);
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO runs
        (id, organization_id, project_id, requested_by, kind, status, input, created_at, updated_at)
      VALUES ('run_active_over', 'org_a', 'prj_a', 'idn_a', 'chat', 'pending', 'x', '${timestamp}', '${timestamp}')
    `),
  'organization active run limit',
);

database.exec(`
  UPDATE runs SET status='completed', completed_at='${timestamp}' WHERE id='run_a';
  INSERT INTO audit_events
    (id, organization_id, actor_identity_id, action, resource_type, resource_id, request_id, created_at)
  VALUES ('aud_run_a', 'org_a', 'idn_a', 'run.create', 'run', 'run_a', 'req', '${timestamp}');
  INSERT INTO idempotency_receipts
    (organization_id, identity_id, route, idempotency_key, request_hash,
     resource_type, resource_id, response_status, response_body, created_at)
  VALUES
    ('org_a', 'idn_a', 'POST /runs', '00000000-0000-4000-8000-000000000006',
     'hash', 'run', 'run_a', 202, '{}', '${timestamp}');
  DELETE FROM runs WHERE id='run_a';
`);
if (database.prepare(`SELECT 1 FROM audit_events WHERE resource_id='run_a'`).get()) {
  throw new Error('run deletion left an audit row');
}
if (database.prepare(`SELECT 1 FROM idempotency_receipts WHERE resource_id='run_a'`).get()) {
  throw new Error('run deletion left an idempotency receipt');
}

database.exec(`
  UPDATE deployment_limits SET account_daily_ai_attempt_limit=1, ai_enabled=1 WHERE id=1;
  INSERT INTO organization_usage_daily VALUES ('org_a', '2026-08-02', 0);
  INSERT INTO organization_usage_daily VALUES ('org_b', '2026-08-02', 0);
  UPDATE organization_usage_daily SET ai_attempts=1
    WHERE organization_id='org_a' AND usage_day='2026-08-02';
`);
expectConstraint(
  () =>
    database.exec(`
      UPDATE organization_usage_daily SET ai_attempts=1
        WHERE organization_id='org_b' AND usage_day='2026-08-02'
    `),
  'account AI attempt limit',
);
if (
  database
    .prepare(`SELECT ai_attempts FROM organization_usage_daily WHERE organization_id='org_b'`)
    .get()?.ai_attempts !== 0
) {
  throw new Error('account budget failure partially incremented organization usage');
}

database.exec(`UPDATE deployment_limits SET ai_enabled=0 WHERE id=1`);
expectConstraint(
  () =>
    database.exec(`
      UPDATE organization_usage_daily SET ai_attempts=2
        WHERE organization_id='org_a' AND usage_day='2026-08-02'
    `),
  'dynamic AI kill switch',
);

database.exec(`UPDATE memberships SET revoked_at='${timestamp}' WHERE organization_id='org_a'`);
if (
  database
    .prepare(`SELECT 1 FROM memberships WHERE identity_id='idn_a' AND revoked_at IS NULL`)
    .get()
) {
  throw new Error('revoked membership remained active');
}
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO runs
        (id, organization_id, project_id, requested_by, kind, status, input, created_at, updated_at)
      VALUES ('run_revoked', 'org_a', 'prj_a', 'idn_a', 'chat', 'pending', 'x', '${timestamp}', '${timestamp}')
    `),
  'revoked membership run admission',
);
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO idempotency_receipts
        (organization_id, identity_id, route, idempotency_key, request_hash,
         resource_type, resource_id, response_status, response_body, created_at)
      VALUES ('org_a', 'idn_a', 'POST /runs', '00000000-0000-4000-8000-000000000007',
        'hash', 'run', 'run_revoked', 202, '{}', '${timestamp}')
    `),
  'revoked membership receipt admission',
);
expectConstraint(
  () =>
    database.exec(`
      INSERT INTO audit_events
        (id, organization_id, actor_identity_id, action, resource_type, resource_id,
         request_id, metadata_json, created_at)
      VALUES ('aud_revoked', 'org_a', 'idn_a', 'run.create', 'run', 'run_revoked',
        'req', '{}', '${timestamp}')
    `),
  'revoked membership audit admission',
);

const foreignKeyProblems = database.prepare('PRAGMA foreign_key_check').all();
if (foreignKeyProblems.length) throw new Error('foreign key check failed');
const schema = database
  .prepare(`SELECT group_concat(sql, '\n') AS sql FROM sqlite_schema WHERE sql IS NOT NULL`)
  .get()?.sql;
if (/artifacts|index_jobs|vector|sandbox|conversationhub/i.test(String(schema))) {
  throw new Error('removed capability survived in the fresh D1 schema');
}
const queryPlan = database
  .prepare(
    `EXPLAIN QUERY PLAN SELECT id FROM runs
     WHERE status='completed' AND completed_at < ? ORDER BY completed_at LIMIT 100`,
  )
  .all('2026-09-01');
if (!JSON.stringify(queryPlan).includes('idx_runs_status_completed')) {
  throw new Error('retention query does not use idx_runs_status_completed');
}

database.close();
console.log(
  'Fresh TeamBoundary AI D1 schema, isolation, quotas, revocation, cleanup, and indexes passed.',
);

function expectConstraint(operation, label) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`Expected database constraint failure: ${label}`);
}
