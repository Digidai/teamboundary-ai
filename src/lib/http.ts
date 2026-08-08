export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type JsonValidator<T> = (value: unknown) => T;

export async function readJson<T>(
  request: Request,
  validate: JsonValidator<T>,
  maximumBytes = 65_536,
): Promise<T> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new ApiError(415, 'json_content_type_required');
  }

  let value: unknown;
  try {
    value = JSON.parse(await readTextLimited(request, maximumBytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json');
  }

  try {
    return validate(value);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_request');
  }
}

export async function readTextLimited(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(413, 'payload_too_large');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel('payload_too_large');
        throw new ApiError(413, 'payload_too_large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_body');
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

export function ensureMutationRequest(request: Request): void {
  ensureSameSiteRequest(request);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError(403, 'origin_mismatch');
  }

  if (request.headers.get('x-requested-with') !== 'XMLHttpRequest') {
    throw new ApiError(403, 'request_marker_required');
  }
}

export function ensureSameSiteRequest(request: Request): void {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new ApiError(403, 'cross_site_request_rejected');
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: { code: error.code, requestId } }, { status: error.status });
  }

  console.error('request_failed', { requestId, errorType: errorName(error) });
  return Response.json({ error: { code: 'internal_error', requestId } }, { status: 500 });
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function securityHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
}
