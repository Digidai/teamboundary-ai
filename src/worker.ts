import { Hono } from 'hono';

import { provisionActor, requireOrganization, verifyIdentity } from './auth/access.ts';
import { assertProject, getRun, listProjects, listRuns } from './data/repository.ts';
import {
  commitIdempotentMutation,
  deterministicMutationId,
  prepareMutation,
  replayIdempotentMutation,
} from './idempotency.ts';
import {
  ApiError,
  ensureMutationRequest,
  ensureSameSiteRequest,
  errorResponse,
  readJson,
  securityHeaders,
} from './lib/http.ts';
import { nowIso } from './lib/ids.ts';
import { publicProject, publicRunDetail } from './public-shapes.ts';
import { enforceRequestRateLimits } from './rate-limit.ts';
import { validateRunInput } from './run-policy.ts';
import type { Actor, AppBindings, Env } from './types.ts';
import {
  launchRunWorkflow,
  reconcileStaleRunningWorkflows,
  reconcileUncertainRunWorkflows,
} from './workflow-launch.ts';
import { RunWorkflow } from './workflows/run-workflow.ts';

export { RunWorkflow };

interface ProjectInput {
  name: string;
  description: string;
}

const app = new Hono<AppBindings>();

app.use('/api/*', async (context, next) => {
  const requestId = context.req.header('cf-ray') || crypto.randomUUID();
  context.set('requestId', requestId);
  try {
    await next();
  } catch (error) {
    context.res = errorResponse(error, requestId);
  }
  securityHeaders(context.res.headers);
  context.res.headers.set('X-Request-Id', requestId);
});

app.onError((error, context) => {
  const requestId = context.get('requestId') || crypto.randomUUID();
  const response = errorResponse(error, requestId);
  securityHeaders(response.headers);
  response.headers.set('X-Request-Id', requestId);
  return response;
});

app.get('/api/v1/health', (context) =>
  context.json({ status: 'ok', service: 'teamboundary-control', version: '0.1.0' }),
);

app.use('/api/v1/*', async (context, next) => {
  if (context.req.path === '/api/v1/health') return next();
  ensureSameSiteRequest(context.req.raw);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    ensureMutationRequest(context.req.raw);
  }
  const claims = await verifyIdentity(context.req.raw, context.env);
  await enforceRequestRateLimits(context.env, claims, context.req.method, context.req.path);
  context.set('actor', await provisionActor(context.env, claims));
  await next();
});

app.get('/api/v1/me', (context) => {
  const actor = context.get('actor');
  return context.json({
    identity: {
      id: actor.identityId,
      email: actor.email,
      displayName: actor.displayName,
    },
    organizations: actor.memberships,
  });
});

app.get('/api/v1/organizations', (context) => {
  return context.json({ organizations: context.get('actor').memberships });
});

app.get('/api/v1/organizations/:organizationId/projects', async (context) => {
  const organizationId = context.req.param('organizationId');
  requireOrganization(context.get('actor'), organizationId);
  const projects = await listProjects(context.env.CONTROL_DB, organizationId);
  return context.json({ projects: projects.map(publicProject) });
});

app.post('/api/v1/organizations/:organizationId/projects', async (context) => {
  const actor = context.get('actor');
  const organizationId = context.req.param('organizationId');
  requireOrganization(actor, organizationId, ['owner', 'admin', 'member']);
  const mutation = await prepareMutation(context.req.raw);
  const input = await readJson(context.req.raw, validateProjectInput);
  const projectId = await deterministicMutationId('prj', actor, organizationId, mutation);
  const auditId = await deterministicMutationId('aud', actor, organizationId, mutation);
  const timestamp = nowIso();
  const project = {
    id: projectId,
    organization_id: organizationId,
    name: input.name,
    description: input.description,
    created_at: timestamp,
    updated_at: timestamp,
  };

  try {
    const result = await commitIdempotentMutation(
      context.env.CONTROL_DB,
      actor,
      organizationId,
      mutation,
      { type: 'project', id: projectId },
      [
        context.env.CONTROL_DB.prepare(
          `INSERT INTO projects
             (id, organization_id, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(projectId, organizationId, input.name, input.description, timestamp, timestamp),
        auditStatement(
          context.env.CONTROL_DB,
          actor,
          organizationId,
          auditId,
          context.get('requestId'),
          'project.create',
          'project',
          projectId,
          {},
          timestamp,
        ),
      ],
      201,
      { project: publicProject(project) },
    );
    return result.response;
  } catch (error) {
    if (error instanceof Error && error.message.includes('membership_not_authorized')) {
      throw new ApiError(404, 'organization_not_found');
    }
    if (error instanceof Error && error.message.includes('organization_project_limit_exceeded')) {
      throw new ApiError(429, 'organization_project_limit_exceeded');
    }
    throw error;
  }
});

app.get('/api/v1/organizations/:organizationId/runs', async (context) => {
  const organizationId = context.req.param('organizationId');
  requireOrganization(context.get('actor'), organizationId);
  const limitValue = context.req.query('limit');
  const limit = limitValue === undefined ? 25 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ApiError(400, 'invalid_run_list_limit');
  }
  const cursor = decodeRunCursor(context.req.query('cursor'));
  const result = await listRuns(context.env.CONTROL_DB, organizationId, {
    limit,
    ...(cursor ? { beforeCreatedAt: cursor.createdAt, beforeId: cursor.id } : {}),
  });
  return context.json({
    runs: result.runs,
    nextCursor: result.nextCursor ? encodeRunCursor(result.nextCursor) : null,
  });
});

app.get('/api/v1/organizations/:organizationId/runs/:runId', async (context) => {
  const organizationId = context.req.param('organizationId');
  requireOrganization(context.get('actor'), organizationId);
  const run = await getRun(context.env.CONTROL_DB, organizationId, context.req.param('runId'));
  if (!run) throw new ApiError(404, 'run_not_found');
  return context.json({ run: publicRunDetail(run) });
});

app.post('/api/v1/organizations/:organizationId/runs', async (context) => {
  const actor = context.get('actor');
  const organizationId = context.req.param('organizationId');
  requireOrganization(actor, organizationId, ['owner', 'admin', 'member']);
  const mutation = await prepareMutation(context.req.raw);
  const input = await readJson(context.req.raw, validateRunInput);
  await assertProject(context.env.CONTROL_DB, organizationId, input.projectId);
  const replay = await replayIdempotentMutation(
    context.env.CONTROL_DB,
    actor,
    organizationId,
    mutation,
  );
  if (replay) return replay;
  if (context.env.AI_ENABLED !== 'true') throw new ApiError(503, 'ai_disabled');
  if (!context.env.AI_GATEWAY_ID) throw new ApiError(503, 'ai_gateway_not_configured');
  const runId = await deterministicMutationId('run', actor, organizationId, mutation);
  const auditId = await deterministicMutationId('aud', actor, organizationId, mutation);
  const timestamp = nowIso();
  const created = {
    id: runId,
    project_id: input.projectId,
    kind: 'chat' as const,
    status: 'pending' as const,
    created_at: timestamp,
  };

  let response: Response;
  try {
    const result = await commitIdempotentMutation(
      context.env.CONTROL_DB,
      actor,
      organizationId,
      mutation,
      { type: 'run', id: runId },
      [
        context.env.CONTROL_DB.prepare(
          `INSERT INTO runs
             (id, organization_id, project_id, requested_by, kind, status, input,
              error_code, workflow_instance_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'chat', 'pending', ?, 'workflow_launch_pending', ?, ?, ?)`,
        ).bind(
          runId,
          organizationId,
          input.projectId,
          actor.identityId,
          input.input,
          runId,
          timestamp,
          timestamp,
        ),
        auditStatement(
          context.env.CONTROL_DB,
          actor,
          organizationId,
          auditId,
          context.get('requestId'),
          'run.create',
          'run',
          runId,
          { kind: 'chat' },
          timestamp,
        ),
      ],
      202,
      { run: created },
    );
    response = result.response;
    if (result.committed) {
      context.executionCtx.waitUntil(
        launchRunWorkflow(context.env, organizationId, runId).catch((error: unknown) => {
          console.error('workflow_launch_deferred', {
            runId,
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }),
      );
    }
  } catch (error) {
    throw mapRunAdmissionError(error);
  }
  return response;
});

app.notFound((context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json({ error: { code: 'not_found', requestId: context.get('requestId') } }, 404);
  }
  return new Response('Not Found', { status: 404 });
});

function validateProjectInput(value: unknown): ProjectInput {
  if (!isExactRecord(value, ['name', 'description'])) throw new ApiError(400, 'invalid_request');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (name.length < 2 || name.length > 120 || description.length > 2_000) {
    throw new ApiError(400, 'invalid_request');
  }
  return { name, description };
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function auditStatement(
  db: D1Database,
  actor: Actor,
  organizationId: string,
  auditId: string,
  requestId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, string | number | boolean>,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events
         (id, organization_id, actor_identity_id, action, resource_type, resource_id,
          request_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      auditId,
      organizationId,
      actor.identityId,
      action,
      resourceType,
      resourceId,
      requestId,
      JSON.stringify(metadata),
      timestamp,
    );
}

function mapRunAdmissionError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message.includes('ai_disabled')) return new ApiError(503, 'ai_disabled');
  const mappings: Record<string, string> = {
    account_active_run_limit_exceeded: 'account_active_run_limit_exceeded',
    organization_active_run_limit_exceeded: 'organization_active_run_limit_exceeded',
    account_daily_run_limit_exceeded: 'account_daily_run_limit_exceeded',
    organization_daily_run_limit_exceeded: 'organization_daily_run_limit_exceeded',
    actor_daily_run_limit_exceeded: 'actor_daily_run_limit_exceeded',
  };
  if (error.message.includes('membership_not_authorized')) {
    return new ApiError(404, 'organization_not_found');
  }
  const match = Object.keys(mappings).find((code) => error.message.includes(code));
  return match ? new ApiError(429, match) : error;
}

function encodeRunCursor(cursor: { createdAt: string; id: string }): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeRunCursor(value: string | undefined): { createdAt: string; id: string } | null {
  if (value === undefined) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new ApiError(400, 'invalid_run_list_cursor');
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as unknown;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof (decoded as Record<string, unknown>).createdAt !== 'string' ||
      typeof (decoded as Record<string, unknown>).id !== 'string'
    ) {
      throw new Error('invalid_cursor');
    }
    const cursor = decoded as { createdAt: string; id: string };
    if (!/^\d{4}-\d{2}-\d{2}T/.test(cursor.createdAt) || !/^run_[a-zA-Z0-9_-]+$/.test(cursor.id)) {
      throw new Error('invalid_cursor');
    }
    return cursor;
  } catch {
    throw new ApiError(400, 'invalid_run_list_cursor');
  }
}

async function pruneExpiredData(db: D1Database): Promise<void> {
  const expired = await db
    .prepare(
      `SELECT runs.id, runs.organization_id
       FROM runs
       JOIN organizations ON organizations.id = runs.organization_id
       WHERE runs.status IN ('completed', 'failed', 'cancelled')
         AND runs.completed_at IS NOT NULL
         AND runs.completed_at < strftime(
           '%Y-%m-%dT%H:%M:%fZ',
           'now',
           '-' || organizations.run_retention_days || ' days'
         )
       ORDER BY runs.completed_at ASC
       LIMIT 100`,
    )
    .all<{ id: string; organization_id: string }>();
  const deletes = expired.results.map((run) =>
    db
      .prepare(
        `DELETE FROM runs
         WHERE id = ? AND organization_id = ?
           AND status IN ('completed', 'failed', 'cancelled')`,
      )
      .bind(run.id, run.organization_id),
  );
  if (deletes.length) await db.batch(deletes);
  await db.batch([
    db.prepare(`DELETE FROM organization_usage_daily WHERE usage_day < date('now', '-8 days')`),
    db.prepare(`DELETE FROM account_usage_daily WHERE usage_day < date('now', '-8 days')`),
  ]);
}

const worker: ExportedHandler<Env> = {
  fetch: app.fetch,
  scheduled(_controller, env, context) {
    context.waitUntil(
      Promise.all([
        pruneExpiredData(env.CONTROL_DB),
        reconcileUncertainRunWorkflows(env),
        reconcileStaleRunningWorkflows(env),
      ]).then(() => undefined),
    );
  },
};

export default worker;
