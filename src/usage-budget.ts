import { ApiError } from './lib/http.ts';

export async function claimAiAttemptBudget(
  db: D1Database,
  organizationId: string,
  identityId: string,
  date = new Date(),
): Promise<void> {
  const usageDay = date.toISOString().slice(0, 10);
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO organization_usage_daily
             (organization_id, usage_day, ai_attempts)
           SELECT ?, ?, 0
           WHERE EXISTS (
             SELECT 1 FROM deployment_limits WHERE id = 1 AND ai_enabled = 1
           )
           AND EXISTS (
             SELECT 1 FROM memberships
             WHERE organization_id = ? AND identity_id = ?
               AND revoked_at IS NULL
               AND role IN ('owner', 'admin', 'member')
           )`,
        )
        .bind(organizationId, usageDay, organizationId, identityId),
      db
        .prepare(
          `UPDATE organization_usage_daily
         SET ai_attempts = ai_attempts + 1
           WHERE organization_id = ? AND usage_day = ?
           AND EXISTS (
             SELECT 1 FROM deployment_limits WHERE id = 1 AND ai_enabled = 1
           )
           AND ai_attempts < (
             SELECT daily_ai_attempt_limit FROM organizations WHERE id = ?
           )
           AND EXISTS (
             SELECT 1 FROM memberships
             WHERE organization_id = ? AND identity_id = ?
               AND revoked_at IS NULL
               AND role IN ('owner', 'admin', 'member')
           )`,
        )
        .bind(organizationId, usageDay, organizationId, organizationId, identityId),
    ]);
    const result = results[1];
    if (!result || result.meta.changes !== 1) {
      const gate = await db
        .prepare(`SELECT ai_enabled FROM deployment_limits WHERE id = 1`)
        .first<{ ai_enabled: number }>();
      if (gate?.ai_enabled !== 1) throw new ApiError(503, 'ai_disabled');
      const authorized = await db
        .prepare(
          `SELECT 1 FROM memberships
           WHERE organization_id = ? AND identity_id = ?
             AND revoked_at IS NULL
             AND role IN ('owner', 'admin', 'member')`,
        )
        .bind(organizationId, identityId)
        .first();
      if (!authorized) throw new ApiError(403, 'membership_not_authorized');
      throw new ApiError(429, 'organization_ai_budget_exhausted');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.message.includes('ai_disabled')) {
      throw new ApiError(503, 'ai_disabled');
    }
    if (error instanceof Error && error.message.includes('account_ai_budget_exhausted')) {
      throw new ApiError(429, 'account_ai_budget_exhausted');
    }
    throw error;
  }
}
