import { describe, expect, it } from 'vitest';

import type { ProjectRow, RunRow } from '../src/data/repository.ts';
import { publicProject, publicRunDetail } from '../src/public-shapes.ts';

describe('public response minimization', () => {
  it('does not expose the project tenant key through the public shape', () => {
    const project = publicProject({
      id: 'prj_1',
      organization_id: 'org_private',
      name: 'Example',
      description: 'Synthetic project',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    } satisfies ProjectRow);
    expect(project).toEqual({
      id: 'prj_1',
      name: 'Example',
      description: 'Synthetic project',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(JSON.stringify(project)).not.toContain('org_private');
  });

  it('does not expose tenant, requester, or Workflow internals in run detail', () => {
    const detail = publicRunDetail({
      id: 'run_1',
      organization_id: 'org_private',
      project_id: 'prj_1',
      requested_by: 'idn_private',
      kind: 'chat',
      status: 'completed',
      input: 'prompt',
      output: 'answer',
      error_code: null,
      workflow_instance_id: 'workflow_private',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      completed_at: '2026-01-01',
    } satisfies RunRow);
    expect(detail).toEqual({
      id: 'run_1',
      project_id: 'prj_1',
      kind: 'chat',
      status: 'completed',
      input: 'prompt',
      output: 'answer',
      error_code: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      completed_at: '2026-01-01',
    });
    expect(JSON.stringify(detail)).not.toMatch(/org_private|idn_private|workflow_private/);
  });
});
