import { sha256Hex } from './lib/crypto.ts';
import { ApiError, readTextLimited } from './lib/http.ts';
import { nowIso } from './lib/ids.ts';
import type { Actor } from './types.ts';

export interface PreparedMutation {
  key: string;
  route: string;
  requestHash: string;
}

interface ReceiptRow {
  request_hash: string;
  response_status: number;
  response_body: string;
}

export async function prepareMutation(request: Request): Promise<PreparedMutation> {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new ApiError(400, 'uuid_idempotency_key_required');
  }
  const route = `${request.method.toUpperCase()} ${new URL(request.url).pathname}`;
  const body = await readTextLimited(request.clone() as unknown as Request, 65_536);
  return { key, route, requestHash: await sha256Hex(`${route}\u0000${body}`) };
}

export async function deterministicMutationId(
  prefix: string,
  actor: Actor,
  organizationId: string,
  mutation: PreparedMutation,
): Promise<string> {
  const digest = await sha256Hex(
    `${actor.identityId}\u0000${organizationId}\u0000${mutation.route}\u0000${mutation.key}`,
  );
  return `${prefix}_${digest.slice(0, 40)}`;
}

export async function commitIdempotentMutation(
  db: D1Database,
  actor: Actor,
  organizationId: string,
  mutation: PreparedMutation,
  resource: { type: 'project' | 'run'; id: string },
  statements: D1PreparedStatement[],
  responseStatus: number,
  responseValue: unknown,
): Promise<{ response: Response; committed: boolean }> {
  const replay = await readReceipt(db, actor, organizationId, mutation);
  if (replay) return { response: replay, committed: false };

  const responseBody = JSON.stringify(responseValue);
  if (new TextEncoder().encode(responseBody).byteLength > 64_000) {
    throw new ApiError(500, 'idempotency_response_too_large');
  }
  const receipt = db
    .prepare(
      `INSERT INTO idempotency_receipts
         (organization_id, identity_id, route, idempotency_key, request_hash,
          resource_type, resource_id, response_status, response_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      organizationId,
      actor.identityId,
      mutation.route,
      mutation.key,
      mutation.requestHash,
      resource.type,
      resource.id,
      responseStatus,
      responseBody,
      nowIso(),
    );

  try {
    await db.batch([...statements, receipt]);
  } catch (error) {
    const concurrent = await readReceipt(db, actor, organizationId, mutation);
    if (concurrent) return { response: concurrent, committed: false };
    throw error;
  }
  return { response: jsonResponse(responseBody, responseStatus, false), committed: true };
}

export async function replayIdempotentMutation(
  db: D1Database,
  actor: Actor,
  organizationId: string,
  mutation: PreparedMutation,
): Promise<Response | null> {
  return readReceipt(db, actor, organizationId, mutation);
}

async function readReceipt(
  db: D1Database,
  actor: Actor,
  organizationId: string,
  mutation: PreparedMutation,
): Promise<Response | null> {
  const receipt = await db
    .prepare(
      `SELECT request_hash, response_status, response_body
       FROM idempotency_receipts
       WHERE organization_id = ? AND identity_id = ? AND route = ? AND idempotency_key = ?`,
    )
    .bind(organizationId, actor.identityId, mutation.route, mutation.key)
    .first<ReceiptRow>();
  if (!receipt) return null;
  if (receipt.request_hash !== mutation.requestHash) {
    throw new ApiError(409, 'idempotency_key_conflict');
  }
  return jsonResponse(receipt.response_body, receipt.response_status, true);
}

function jsonResponse(body: string, status: number, replayed: boolean): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=UTF-8' });
  if (replayed) headers.set('Idempotency-Replayed', 'true');
  return new Response(body, { status, headers });
}
