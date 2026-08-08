import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { provisionActor, verifyIdentity } from '../src/auth/access.ts';
import type { Env } from '../src/types.ts';

const claims = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'subject-1',
  email: 'person@example.com',
  displayName: 'Person',
};

const accessTeamDomain = 'teamboundary-test.cloudflareaccess.com';
const accessIssuer = `https://${accessTeamDomain}`;
const accessAudience = 'teamboundary-test-audience';
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', use: 'sig' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterAll(() => vi.unstubAllGlobals());

describe('authentication configuration boundary', () => {
  it('allows development identity only on an exact loopback origin', async () => {
    const env = { AUTH_MODE: 'dev', APP_ENV: 'development' } as Env;
    await expect(
      verifyIdentity(new Request('http://localhost:5173/api/v1/me'), env),
    ).resolves.toEqual(expect.objectContaining({ subject: 'developer' }));
    await expect(
      verifyIdentity(new Request('https://preview.example/api/v1/me'), env),
    ).rejects.toMatchObject({ status: 503, code: 'authentication_not_configured' });
  });

  it.each(['', 'staging', 'prod', 'production'])(
    'fails closed for dev auth when APP_ENV is %j',
    async (appEnv) => {
      const env = { AUTH_MODE: 'dev', APP_ENV: appEnv } as Env;
      await expect(
        verifyIdentity(new Request('http://127.0.0.1/api/v1/me'), env),
      ).rejects.toMatchObject({ status: 503, code: 'authentication_not_configured' });
    },
  );
});

describe('Access JWT verification', () => {
  it('accepts an exact RS256 issuer, audience, identity and time window', async () => {
    const token = await accessToken();
    await expect(verifyIdentity(accessRequest(token), accessEnv())).resolves.toEqual({
      issuer: accessIssuer,
      subject: 'subject-1',
      email: 'person@example.com',
      displayName: 'Person',
    });
  });

  it.each([
    ['wrong audience', { audience: 'wrong-audience' }],
    ['wrong issuer', { issuer: 'https://other.cloudflareaccess.com' }],
    ['expired', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['not active', { notBefore: Math.floor(Date.now() / 1000) + 3600 }],
    ['missing subject', { subject: null }],
    ['missing email', { email: null }],
  ] as const)('rejects %s claims', async (_label, overrides) => {
    const token = await accessToken(overrides);
    await expect(verifyIdentity(accessRequest(token), accessEnv())).rejects.toMatchObject({
      status: 401,
      code: 'invalid_access_token',
    });
  });

  it('rejects a non-RS256 assertion and an oversized assertion', async () => {
    const token = await new SignJWT({ email: claims.email })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuer(accessIssuer)
      .setAudience(accessAudience)
      .setSubject(claims.subject)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('not-an-rsa-key'));
    await expect(verifyIdentity(accessRequest(token), accessEnv())).rejects.toMatchObject({
      status: 401,
      code: 'invalid_access_token',
    });
    await expect(
      verifyIdentity(accessRequest('x'.repeat(16_385)), accessEnv()),
    ).rejects.toMatchObject({ status: 401, code: 'authentication_required' });
  });
});

describe('production identity lookup', () => {
  it('performs no writes for an existing active identity', async () => {
    const fixture = d1Fixture({ existing: true, activeMembership: true });
    await expect(provisionActor(fixture.env, claims)).resolves.toMatchObject({
      identityId: 'idn_existing',
    });
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.batch).not.toHaveBeenCalled();
  });

  it('does not update identity rows as a side effect of a GET', async () => {
    const fixture = d1Fixture({ existing: true, activeMembership: true });
    await provisionActor(fixture.env, { ...claims, email: 'changed@example.com' });
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.batch).not.toHaveBeenCalled();
  });

  it('rejects an unknown production identity without creating anything', async () => {
    const fixture = d1Fixture({ existing: false, activeMembership: false });
    await expect(provisionActor(fixture.env, claims)).rejects.toMatchObject({
      status: 403,
      code: 'identity_not_provisioned',
    });
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.batch).not.toHaveBeenCalled();
  });

  it('rejects a revoked membership while preserving the identity row', async () => {
    const fixture = d1Fixture({ existing: true, activeMembership: false });
    await expect(provisionActor(fixture.env, claims)).rejects.toMatchObject({
      status: 403,
      code: 'identity_not_provisioned',
    });
    expect(fixture.batch).not.toHaveBeenCalled();
  });
});

function d1Fixture(options: { existing: boolean; activeMembership: boolean }) {
  const run = vi.fn().mockResolvedValue({ success: true });
  const batch = vi.fn().mockResolvedValue([]);
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: vi
        .fn()
        .mockResolvedValue(
          sql.includes('FROM identities') && options.existing
            ? { id: 'idn_existing', email: claims.email, display_name: claims.displayName }
            : null,
        ),
      all: vi.fn().mockResolvedValue({
        results:
          sql.includes('FROM memberships') && options.activeMembership
            ? [
                {
                  organization_id: 'org_existing',
                  organization_name: 'Personal workspace',
                  organization_slug: 'personal-existing',
                  role: 'owner',
                },
              ]
            : [],
      }),
      run,
    })),
  }));
  const db = { prepare, batch } as unknown as D1Database;
  return {
    env: {
      CONTROL_DB: db,
      APP_ENV: 'production',
      AUTH_MODE: 'access',
      PROVISIONING_MODE: 'closed',
    } as unknown as Env,
    run,
    batch,
  };
}

function accessEnv(): Env {
  return {
    AUTH_MODE: 'access',
    APP_ENV: 'production',
    ACCESS_TEAM_DOMAIN: accessTeamDomain,
    ACCESS_AUD: accessAudience,
  } as Env;
}

function accessRequest(token: string): Request {
  return new Request('https://app.example/api/v1/me', {
    headers: { 'cf-access-jwt-assertion': token },
  });
}

async function accessToken(
  overrides: {
    audience?: string;
    issuer?: string;
    expiresAt?: number;
    notBefore?: number;
    subject?: string | null;
    email?: string | null;
  } = {},
): Promise<string> {
  const payload: Record<string, unknown> = { name: claims.displayName };
  if (overrides.email !== null) payload.email = overrides.email ?? claims.email;
  let token = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? accessIssuer)
    .setAudience(overrides.audience ?? accessAudience)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 300);
  if (overrides.subject !== null) token = token.setSubject(overrides.subject ?? claims.subject);
  if (overrides.notBefore) token = token.setNotBefore(overrides.notBefore);
  return token.sign(privateKey);
}
