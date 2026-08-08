import { ApiError } from '../lib/http.ts';
import { nowIso } from '../lib/ids.ts';
import type { RunKind, RunStatus } from '../types.ts';

export interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  organization_id: string;
  project_id: string;
  requested_by: string;
  kind: RunKind;
  status: RunStatus;
  input: string;
  output: string | null;
  error_code: string | null;
  workflow_instance_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RunSummaryRow {
  id: string;
  project_id: string;
  kind: RunKind;
  status: RunStatus;
  input_preview: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function listProjects(db: D1Database, organizationId: string): Promise<ProjectRow[]> {
  const result = await db
    .prepare(
      `SELECT id, organization_id, name, description, created_at, updated_at
       FROM projects
       WHERE organization_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .bind(organizationId)
    .all<ProjectRow>();
  return result.results;
}

export async function assertProject(
  db: D1Database,
  organizationId: string,
  projectId: string,
): Promise<ProjectRow> {
  const project = await db
    .prepare(
      `SELECT id, organization_id, name, description, created_at, updated_at
       FROM projects WHERE organization_id = ? AND id = ?`,
    )
    .bind(organizationId, projectId)
    .first<ProjectRow>();
  if (!project) throw new ApiError(404, 'project_not_found');
  return project;
}

export async function getRun(
  db: D1Database,
  organizationId: string,
  runId: string,
): Promise<RunRow | null> {
  return db
    .prepare(
      `SELECT id, organization_id, project_id, requested_by, kind, status, input, output,
              error_code, workflow_instance_id,
              created_at, updated_at, completed_at
       FROM runs WHERE organization_id = ? AND id = ?`,
    )
    .bind(organizationId, runId)
    .first<RunRow>();
}

export async function listRuns(
  db: D1Database,
  organizationId: string,
  options: { limit: number; beforeCreatedAt?: string; beforeId?: string },
): Promise<{ runs: RunSummaryRow[]; nextCursor: { createdAt: string; id: string } | null }> {
  const maximum = Math.min(Math.max(Math.trunc(options.limit), 1), 50);
  const hasCursor = Boolean(options.beforeCreatedAt && options.beforeId);
  const result = await db
    .prepare(
      `SELECT id, project_id, kind, status, substr(input, 1, 180) AS input_preview,
              error_code, created_at, updated_at, completed_at
       FROM runs
       WHERE organization_id = ? AND (
         ? = 0 OR created_at < ? OR (created_at = ? AND id < ?)
       )
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(
      organizationId,
      hasCursor ? 1 : 0,
      options.beforeCreatedAt ?? '',
      options.beforeCreatedAt ?? '',
      options.beforeId ?? '',
      maximum + 1,
    )
    .all<RunSummaryRow>();
  const hasMore = result.results.length > maximum;
  const runs = result.results.slice(0, maximum);
  const last = runs.at(-1);
  return {
    runs,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

export async function recordRunWorkflowLaunch(
  db: D1Database,
  organizationId: string,
  runId: string,
  workflowInstanceId: string,
  uncertain: boolean,
): Promise<void> {
  await db
    .prepare(
      `UPDATE runs SET
         workflow_instance_id = ?,
         error_code = ?,
         updated_at = ?
       WHERE organization_id = ? AND id = ? AND status = 'pending'`,
    )
    .bind(
      workflowInstanceId,
      uncertain ? 'workflow_start_uncertain' : 'workflow_waiting_for_claim',
      nowIso(),
      organizationId,
      runId,
    )
    .run();
}

export async function failPendingRunWorkflow(
  db: D1Database,
  organizationId: string,
  runId: string,
  errorCode: string,
): Promise<boolean> {
  const timestamp = nowIso();
  const result = await db
    .prepare(
      `UPDATE runs SET
         status = 'failed',
         error_code = ?,
         updated_at = ?,
         completed_at = ?
       WHERE organization_id = ? AND id = ? AND status = 'pending'`,
    )
    .bind(errorCode, timestamp, timestamp, organizationId, runId)
    .run();
  return result.meta.changes === 1;
}

export async function claimRunForWorkflow(
  db: D1Database,
  organizationId: string,
  runId: string,
  workflowInstanceId: string,
): Promise<boolean> {
  const timestamp = nowIso();
  const claimed = await db
    .prepare(
      `UPDATE runs SET
         status = 'running',
         workflow_instance_id = ?,
         error_code = NULL,
         updated_at = ?
       WHERE organization_id = ? AND id = ? AND status = 'pending'
         AND (workflow_instance_id IS NULL OR workflow_instance_id = ?)`,
    )
    .bind(workflowInstanceId, timestamp, organizationId, runId, workflowInstanceId)
    .run();
  if (claimed.meta.changes === 1) return true;

  const current = await db
    .prepare(
      `SELECT status, workflow_instance_id
       FROM runs WHERE organization_id = ? AND id = ?`,
    )
    .bind(organizationId, runId)
    .first<{ status: RunStatus; workflow_instance_id: string | null }>();
  return current?.status === 'running' && current.workflow_instance_id === workflowInstanceId;
}

export async function finishRunForWorkflow(
  db: D1Database,
  organizationId: string,
  runId: string,
  workflowInstanceId: string,
  values: { status: 'completed'; output: string } | { status: 'failed'; errorCode: string },
): Promise<boolean> {
  const timestamp = nowIso();
  const result = await db
    .prepare(
      `UPDATE runs SET
         status = ?,
         output = CASE WHEN ? = 'completed' THEN ? ELSE output END,
         error_code = ?,
         updated_at = ?,
         completed_at = ?
       WHERE organization_id = ? AND id = ? AND status = 'running'
         AND workflow_instance_id = ?`,
    )
    .bind(
      values.status,
      values.status,
      values.status === 'completed' ? values.output.slice(0, 100_000) : null,
      values.status === 'failed' ? values.errorCode : null,
      timestamp,
      timestamp,
      organizationId,
      runId,
      workflowInstanceId,
    )
    .run();
  return result.meta.changes === 1;
}

export async function failRunningRunWorkflow(
  db: D1Database,
  organizationId: string,
  runId: string,
  workflowInstanceId: string,
  errorCode: string,
): Promise<boolean> {
  const timestamp = nowIso();
  const result = await db
    .prepare(
      `UPDATE runs SET
         status = 'failed',
         error_code = ?,
         updated_at = ?,
         completed_at = ?
       WHERE organization_id = ? AND id = ? AND status = 'running'
         AND workflow_instance_id = ?`,
    )
    .bind(errorCode, timestamp, timestamp, organizationId, runId, workflowInstanceId)
    .run();
  return result.meta.changes === 1;
}
