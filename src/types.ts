export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type RunKind = 'chat';
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
}

export interface Actor {
  identityId: string;
  issuer: string;
  subject: string;
  email: string;
  displayName: string | null;
  memberships: Membership[];
}

export interface RunPayload {
  runId: string;
  organizationId: string;
}

export interface WorkflowInstanceLike {
  id: string;
  terminate?(options?: { rollback?: boolean }): Promise<void>;
  status(): Promise<{
    status:
      | 'queued'
      | 'running'
      | 'paused'
      | 'errored'
      | 'terminated'
      | 'complete'
      | 'waiting'
      | 'waitingForPause'
      | 'unknown';
  }>;
}

export interface WorkflowBindingLike<T> {
  create(options: {
    id?: string;
    params: T;
    retention?: { successRetention?: string | number; errorRetention?: string | number };
  }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
}

export interface AiBindingLike {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

export interface Env {
  CONTROL_DB: D1Database;
  AI: AiBindingLike;
  ACCOUNT_RATE_LIMITER: RateLimit;
  REQUEST_RATE_LIMITER: RateLimit;
  MUTATION_RATE_LIMITER: RateLimit;
  AI_RATE_LIMITER: RateLimit;
  RUN_WORKFLOW: WorkflowBindingLike<RunPayload>;
  APP_ENV: string;
  AUTH_MODE: string;
  AI_ENABLED: string;
  PROVISIONING_MODE: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  AI_GATEWAY_ID?: string;
}

export interface AppVariables {
  actor: Actor;
  requestId: string;
}

export type AppBindings = { Bindings: Env; Variables: AppVariables };
