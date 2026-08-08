import { describe, expect, it, vi } from 'vitest';

import { enforceRequestRateLimits } from '../src/rate-limit.ts';
import type { IdentityClaims } from '../src/auth/access.ts';
import type { Env } from '../src/types.ts';

const claims: IdentityClaims = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'subject-1',
  email: 'person@example.com',
  displayName: 'Person',
};

describe('application rate-limit boundary', () => {
  it('does not spend counters for read-only requests', async () => {
    const fixture = environment(true, true, true, true);
    await enforceRequestRateLimits(fixture.env, claims, 'GET', '/api/v1/organizations');
    expect(fixture.account).toHaveBeenCalledWith({ key: 'teamboundary-deployment' });
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.mutation).not.toHaveBeenCalled();
    expect(fixture.ai).not.toHaveBeenCalled();
  });

  it('enforces both budgets on expensive mutations', async () => {
    const fixture = environment(true, true, true, false);
    await expect(
      enforceRequestRateLimits(fixture.env, claims, 'POST', '/api/v1/organizations/org_1/runs'),
    ).rejects.toMatchObject({ status: 429, code: 'ai_rate_limit_exceeded' });
    const principalKey = fixture.request.mock.calls[0]?.[0]?.key;
    expect(principalKey).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.mutation).toHaveBeenCalledWith({ key: principalKey });
    expect(fixture.ai).toHaveBeenCalledWith({ key: principalKey });
  });

  it('rejects over-budget requests before downstream work', async () => {
    const fixture = environment(true, false, true, true);
    await expect(
      enforceRequestRateLimits(fixture.env, claims, 'GET', '/api/v1/organizations'),
    ).rejects.toMatchObject({ status: 429, code: 'request_rate_limit_exceeded' });
    expect(fixture.account).not.toHaveBeenCalled();
    expect(fixture.mutation).not.toHaveBeenCalled();
    expect(fixture.ai).not.toHaveBeenCalled();
  });
});

function environment(
  accountSuccess: boolean,
  requestSuccess: boolean,
  mutationSuccess: boolean,
  aiSuccess: boolean,
) {
  const account = vi.fn().mockResolvedValue({ success: accountSuccess });
  const request = vi.fn().mockResolvedValue({ success: requestSuccess });
  const mutation = vi.fn().mockResolvedValue({ success: mutationSuccess });
  const ai = vi.fn().mockResolvedValue({ success: aiSuccess });
  return {
    env: {
      ACCOUNT_RATE_LIMITER: { limit: account },
      REQUEST_RATE_LIMITER: { limit: request },
      MUTATION_RATE_LIMITER: { limit: mutation },
      AI_RATE_LIMITER: { limit: ai },
    } as unknown as Env,
    account,
    request,
    mutation,
    ai,
  };
}
