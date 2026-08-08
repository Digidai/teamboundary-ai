export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  project_id: string;
  kind: 'chat';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  input_preview: string;
  error_code: string | null;
  created_at: string;
}

export interface RunDetail extends Omit<Run, 'input_preview'> {
  input: string;
  output: string | null;
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super('network_unavailable');
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method || 'GET').toUpperCase();
  if (options.body) {
    headers.set('Content-Type', 'application/json');
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', crypto.randomUUID());
  }
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  } catch {
    try {
      response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    } catch {
      throw new ApiNetworkError();
    }
  }
  const payload = (await response.json().catch(() => null)) as
    T | { error?: { code?: string } } | null;
  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'error' in payload
        ? payload.error?.code
        : undefined;
    throw new ApiClientError(code || `http_${response.status}`, response.status);
  }
  return payload as T;
}
