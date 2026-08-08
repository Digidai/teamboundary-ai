import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('workerd integration boundary', () => {
  it('runs the actual Worker health route in workerd', async () => {
    const response = await SELF.fetch('http://localhost/api/v1/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'teamboundary-control',
      version: '0.1.0',
    });
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('applies the real D1 migration and fails before run writes while AI is disabled', async () => {
    const me = await SELF.fetch('http://localhost/api/v1/me');
    expect(me.status).toBe(200);
    const mePayload = (await me.json()) as { organizations: Array<{ organizationId: string }> };
    const organizationId = mePayload.organizations[0]?.organizationId;
    expect(organizationId).toMatch(/^org_/);

    const bindings = env as unknown as { CONTROL_DB: D1Database };
    const projectId = 'prj_workerd';
    const now = new Date().toISOString();
    await bindings.CONTROL_DB.prepare(
      `INSERT INTO projects (id, organization_id, name, description, created_at, updated_at)
       VALUES (?, ?, 'Workerd', '', ?, ?)`,
    )
      .bind(projectId, organizationId, now, now)
      .run();

    const response = await SELF.fetch(
      `http://localhost/api/v1/organizations/${organizationId}/runs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': '00000000-0000-4000-8000-000000000002',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ kind: 'chat', projectId, input: 'must remain disabled' }),
      },
    );
    expect(response.status).toBe(503);
    const counts = await bindings.CONTROL_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM runs) AS runs,
        (SELECT COUNT(*) FROM idempotency_receipts) AS receipts,
        (SELECT COUNT(*) FROM audit_events) AS audits,
        (SELECT COUNT(*) FROM organization_usage_daily) AS usage`,
    ).first<{ runs: number; receipts: number; audits: number; usage: number }>();
    expect(counts).toEqual({ runs: 0, receipts: 0, audits: 0, usage: 0 });
  });
});
