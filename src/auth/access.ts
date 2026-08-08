import { createRemoteJWKSet, jwtVerify } from 'jose';

import { sha256Hex } from '../lib/crypto.ts';
import { ApiError } from '../lib/http.ts';
import { nowIso } from '../lib/ids.ts';
import type { Actor, Env, Membership, Role } from '../types.ts';

export interface IdentityClaims {
  issuer: string;
  subject: string;
  email: string;
  displayName: string | null;
}

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: Role;
}

interface IdentityRow {
  id: string;
  email: string;
  display_name: string | null;
}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function requireOrganization(
  actor: Actor,
  organizationId: string,
  acceptedRoles: readonly Role[] = ['owner', 'admin', 'member', 'viewer'],
): Membership {
  const membership = actor.memberships.find(
    (candidate) =>
      candidate.organizationId === organizationId && acceptedRoles.includes(candidate.role),
  );
  if (!membership) throw new ApiError(404, 'organization_not_found');
  return membership;
}

export async function verifyIdentity(request: Request, env: Env): Promise<IdentityClaims> {
  if (env.AUTH_MODE === 'dev') {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (env.APP_ENV !== 'development' || !isLoopbackHostname(hostname)) {
      throw new ApiError(503, 'authentication_not_configured');
    }
    return {
      issuer: 'urn:teamboundary:local',
      subject: 'developer',
      email: 'developer@localhost',
      displayName: 'Local Developer',
    };
  }

  if (env.AUTH_MODE !== 'access') {
    throw new ApiError(503, 'authentication_not_configured');
  }

  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = env.ACCESS_AUD?.trim();
  if (!teamDomain || !audience) {
    throw new ApiError(503, 'access_configuration_missing');
  }

  const token = request.headers.get('cf-access-jwt-assertion') ?? '';
  if (!token || token.length > 16_384) throw new ApiError(401, 'authentication_required');

  const issuer = `https://${teamDomain}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      audience,
      issuer,
      requiredClaims: ['sub', 'email', 'exp', 'iat'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new Error('invalid_claims');
    }
    return {
      issuer,
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      displayName: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null,
    };
  } catch {
    throw new ApiError(401, 'invalid_access_token');
  }
}

export async function provisionActor(env: Env, claims: IdentityClaims): Promise<Actor> {
  const db = env.CONTROL_DB;
  const existingIdentity = await db
    .prepare(
      `SELECT id, email, display_name
       FROM identities
       WHERE issuer = ? AND subject = ?`,
    )
    .bind(claims.issuer, claims.subject)
    .first<IdentityRow>();

  if (existingIdentity) {
    return actorWithMemberships(db, existingIdentity.id, claims);
  }

  if (
    env.APP_ENV !== 'development' ||
    env.AUTH_MODE !== 'dev' ||
    env.PROVISIONING_MODE !== 'personal'
  ) {
    throw new ApiError(403, 'identity_not_provisioned');
  }

  const stableHash = await sha256Hex(`${claims.issuer}\u0000${claims.subject}`);
  const identityId = `idn_${stableHash.slice(0, 40)}`;
  const organizationId = `org_${stableHash.slice(0, 40)}`;
  const organizationSlug = `personal-${stableHash.slice(0, 16)}`;
  const timestamp = nowIso();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO identities
             (id, issuer, subject, email, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          identityId,
          claims.issuer,
          claims.subject,
          claims.email,
          claims.displayName,
          timestamp,
          timestamp,
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO organizations (id, slug, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(organizationId, organizationSlug, 'Personal workspace', timestamp, timestamp),
      db
        .prepare(
          `INSERT OR IGNORE INTO memberships
             (organization_id, identity_id, role, revoked_at, created_at)
           VALUES (?, ?, 'owner', NULL, ?)`,
        )
        .bind(organizationId, identityId, timestamp),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('deployment_identity_limit_exceeded')) {
      throw new ApiError(503, 'deployment_identity_limit_reached');
    }
    throw error;
  }

  return actorWithMemberships(db, identityId, claims);
}

async function actorWithMemberships(
  db: D1Database,
  identityId: string,
  claims: IdentityClaims,
): Promise<Actor> {
  const membershipResult = await db
    .prepare(
      `SELECT
         m.organization_id,
         o.name AS organization_name,
         o.slug AS organization_slug,
         m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.identity_id = ? AND m.revoked_at IS NULL
       ORDER BY o.created_at ASC`,
    )
    .bind(identityId)
    .all<MembershipRow>();

  if (membershipResult.results.length === 0) {
    throw new ApiError(403, 'identity_not_provisioned');
  }

  return {
    identityId,
    issuer: claims.issuer,
    subject: claims.subject,
    email: claims.email,
    displayName: claims.displayName,
    memberships: membershipResult.results.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationSlug: row.organization_slug,
      role: row.role,
    })),
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function normalizeTeamDomain(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/.test(normalized)) return null;
  return normalized;
}
