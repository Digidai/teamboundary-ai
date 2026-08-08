import { ApiError } from './lib/http.ts';
import type { IdentityClaims } from './auth/access.ts';
import { sha256Hex } from './lib/crypto.ts';
import type { Env } from './types.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AI_PATH = /^\/api\/v1\/organizations\/[^/]+\/runs$/;

export async function enforceRequestRateLimits(
  env: Env,
  claims: IdentityClaims,
  method: string,
  path: string,
): Promise<void> {
  const principalKey = await sha256Hex(`${claims.issuer}\u0000${claims.subject}`);
  const normalizedMethod = method.toUpperCase();
  const request = await env.REQUEST_RATE_LIMITER.limit({ key: principalKey });
  if (!request.success) throw new ApiError(429, 'request_rate_limit_exceeded');
  const account = await env.ACCOUNT_RATE_LIMITER.limit({ key: 'teamboundary-deployment' });
  if (!account.success) throw new ApiError(429, 'deployment_rate_limit_exceeded');

  if (SAFE_METHODS.has(normalizedMethod)) return;

  const mutation = await env.MUTATION_RATE_LIMITER.limit({ key: principalKey });
  if (!mutation.success) throw new ApiError(429, 'mutation_rate_limit_exceeded');

  if (normalizedMethod === 'POST' && AI_PATH.test(path)) {
    const expensive = await env.AI_RATE_LIMITER.limit({ key: principalKey });
    if (!expensive.success) throw new ApiError(429, 'ai_rate_limit_exceeded');
  }
}
