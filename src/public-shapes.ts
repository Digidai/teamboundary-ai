import type { ProjectRow, RunRow } from './data/repository.ts';

export function publicProject(project: ProjectRow) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

export function publicRunDetail(run: RunRow) {
  return {
    id: run.id,
    project_id: run.project_id,
    kind: run.kind,
    status: run.status,
    input: run.input,
    output: run.output,
    error_code: run.error_code,
    created_at: run.created_at,
    updated_at: run.updated_at,
    completed_at: run.completed_at,
  };
}
