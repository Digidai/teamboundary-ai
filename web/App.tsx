import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  api,
  ApiClientError,
  ApiNetworkError,
  type Membership,
  type Project,
  type Run,
  type RunDetail,
} from './api.ts';

interface MeResponse {
  identity: { id: string; email: string; displayName: string | null };
  organizations: Membership[];
}

type View = 'runs' | 'settings';

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [tenantEpoch, setTenantEpoch] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [view, setView] = useState<View>('runs');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const epochRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const activeOrganization = useMemo(
    () => me?.organizations.find((organization) => organization.organizationId === organizationId),
    [me, organizationId],
  );

  const refresh = useCallback(async (orgId: string, epoch: number) => {
    const controller = new AbortController();
    loadControllerRef.current?.abort();
    loadControllerRef.current = controller;
    const [projectResponse, runResponse] = await Promise.all([
      api<{ projects: Project[] }>(`/api/v1/organizations/${orgId}/projects`, {
        signal: controller.signal,
      }),
      api<{ runs: Run[] }>(`/api/v1/organizations/${orgId}/runs?limit=25`, {
        signal: controller.signal,
      }),
    ]);
    if (epoch !== epochRef.current || controller.signal.aborted) return;
    setProjects(projectResponse.projects);
    setRuns(runResponse.runs);
  }, []);

  const refreshRuns = useCallback(async (orgId: string, epoch: number) => {
    const response = await api<{ runs: Run[] }>(`/api/v1/organizations/${orgId}/runs?limit=25`);
    if (epoch === epochRef.current) setRuns(response.runs);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const identity = await api<MeResponse>('/api/v1/me');
        setMe(identity);
        const first = identity.organizations[0]?.organizationId || '';
        if (!first) throw new ApiClientError('identity_not_provisioned', 403);
        const epoch = ++epochRef.current;
        setTenantEpoch(epoch);
        setOrganizationId(first);
        await refresh(first, epoch);
      } catch (caught) {
        setError(errorCode(caught));
      } finally {
        setLoading(false);
      }
    })();
    return () => loadControllerRef.current?.abort();
  }, [refresh]);

  const hasActiveRun = runs.some((run) => run.status === 'pending' || run.status === 'running');
  useEffect(() => {
    if (!organizationId || !hasActiveRun) return;
    const epoch = tenantEpoch;
    let cancelled = false;
    let timer = 0;
    let delay = 5_000;
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          await refreshRuns(organizationId, epoch);
          delay = 5_000;
        } catch {
          delay = Math.min(delay * 2, 60_000);
        }
      }
      if (!cancelled && epoch === epochRef.current) {
        timer = window.setTimeout(() => void poll(), delay);
      }
    };
    timer = window.setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasActiveRun, organizationId, refreshRuns, tenantEpoch]);

  async function selectOrganization(nextId: string) {
    const epoch = ++epochRef.current;
    setTenantEpoch(epoch);
    setOrganizationId(nextId);
    setProjects([]);
    setRuns([]);
    setError(null);
    await refresh(nextId, epoch).catch((caught: unknown) => {
      if (epoch === epochRef.current) setError(errorCode(caught));
    });
  }

  if (loading) return <main className="center-state">Opening your workspace…</main>;
  if (!me || !activeOrganization) {
    return (
      <main className="center-state error-state">
        <span>Workspace unavailable</span>
        <small>{error || 'No pre-provisioned organization membership was found.'}</small>
      </main>
    );
  }

  const refreshCurrent = () => refresh(organizationId, tenantEpoch);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TB</span>
          <div>
            <strong>TeamBoundary AI</strong>
            <small>open-source preview</small>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          <NavButton active={view === 'runs'} onClick={() => setView('runs')} icon="◫">
            Runs
          </NavButton>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="○">
            Controls
          </NavButton>
        </nav>
        <div className="sidebar-foot">
          <label htmlFor="organization">Organization</label>
          <select
            id="organization"
            value={organizationId}
            onChange={(event) => void selectOrganization(event.target.value)}
          >
            {me.organizations.map((organization) => (
              <option value={organization.organizationId} key={organization.organizationId}>
                {organization.organizationName}
              </option>
            ))}
          </select>
          <div className="identity">
            <span>{initials(me.identity.displayName || me.identity.email)}</span>
            <div>
              <strong>{me.identity.displayName || me.identity.email}</strong>
              <small>{activeOrganization.role}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeOrganization.organizationName}</p>
            <h1>{view === 'runs' ? 'Bounded AI runs' : 'Security controls'}</h1>
          </div>
          <span className="status">
            <i /> Cloudflare edge
          </span>
        </header>
        {error && (
          <div className="notice" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {view === 'runs' ? (
          <RunsView
            key={`${organizationId}:${tenantEpoch}`}
            organizationId={organizationId}
            projects={projects}
            runs={runs}
            onChanged={refreshCurrent}
            onError={(caught) => setError(errorCode(caught))}
          />
        ) : (
          <ControlsView organization={activeOrganization} />
        )}
      </main>
    </div>
  );
}

function RunsView({
  organizationId,
  projects,
  runs,
  onChanged,
  onError,
}: {
  organizationId: string;
  projects: Project[];
  runs: Run[];
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [input, setInput] = useState('Summarize the purpose of this workspace in three bullets.');
  const [projectId, setProjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const mutationKey = useRef<string | null>(null);
  const selectedProject = projectId || projects[0]?.id || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject) return;
    setSubmitting(true);
    const key = mutationKey.current ?? crypto.randomUUID();
    mutationKey.current = key;
    try {
      await api(`/api/v1/organizations/${organizationId}/runs`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ kind: 'chat', projectId: selectedProject, input }),
      });
      mutationKey.current = null;
      setUnknownOutcome(false);
      setInput('');
      await onChanged();
    } catch (caught) {
      const retrySame = shouldRetrySameMutation(caught);
      if (!retrySame) mutationKey.current = null;
      setUnknownOutcome(retrySame);
      onError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="content-grid">
      <div className="primary-column">
        <form className="composer" onSubmit={submit}>
          <div className="composer-head">
            <span>New AI run</span>
            <select
              aria-label="Project"
              value={selectedProject}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={!projects.length || unknownOutcome}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            aria-label="Run prompt"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={20_000}
            placeholder={projects.length ? 'Ask the workspace…' : 'Create a project first'}
            disabled={!projects.length || unknownOutcome}
          />
          <div className="composer-foot">
            <span>
              {unknownOutcome
                ? 'Network outcome unknown; retry reuses the same operation key.'
                : 'Text only · no tools · no browser model key'}
            </span>
            <button type="submit" disabled={!input.trim() || !projects.length || submitting}>
              {submitting ? 'Starting…' : unknownOutcome ? 'Retry same request →' : 'Start run →'}
            </button>
          </div>
        </form>
        <div className="section-title">
          <div>
            <h2>Recent runs</h2>
            <p>Durable execution with explicit status</p>
          </div>
          <span>{runs.length}</span>
        </div>
        <div className="run-list">
          {runs.length ? (
            runs.map((run) => (
              <RunCard
                organizationId={organizationId}
                run={run}
                project={projects.find((project) => project.id === run.project_id)}
                key={run.id}
              />
            ))
          ) : (
            <Empty title="No runs yet" detail="Start with a prompt above." />
          )}
        </div>
      </div>
      <aside className="rail">
        <ProjectPanel
          organizationId={organizationId}
          projects={projects}
          onChanged={onChanged}
          onError={onError}
        />
        <div className="control-card">
          <p className="eyebrow">Model boundary</p>
          <h3>No executable tools</h3>
          <p>Runs receive text only and cannot invoke a shell, browser, network tool, or secret.</p>
        </div>
      </aside>
    </section>
  );
}

function RunCard({
  organizationId,
  run,
  project,
}: {
  organizationId: string;
  run: Run;
  project: Project | undefined;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  async function toggleDetail() {
    if (detail) return setDetail(null);
    setLoadingDetail(true);
    try {
      const response = await api<{ run: RunDetail }>(
        `/api/v1/organizations/${organizationId}/runs/${run.id}`,
      );
      setDetail(response.run);
    } finally {
      setLoadingDetail(false);
    }
  }
  return (
    <article className="run-card">
      <div className="run-meta">
        <span className={`run-state state-${run.status}`}>{run.status}</span>
        <span>{project?.name || 'Unknown project'}</span>
        <time>{formatTime(run.created_at)}</time>
      </div>
      <h3>{detail?.input || run.input_preview}</h3>
      {detail?.output && <pre>{detail.output}</pre>}
      {run.status === 'failed' && run.error_code && <p className="error-copy">{run.error_code}</p>}
      <button type="button" onClick={() => void toggleDetail()} disabled={loadingDetail}>
        {loadingDetail ? 'Loading…' : detail ? 'Hide detail' : 'View detail'}
      </button>
      <small className="mono">{run.id}</small>
    </article>
  );
}

function ProjectPanel({
  organizationId,
  projects,
  onChanged,
  onError,
}: {
  organizationId: string;
  projects: Project[];
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const mutationKey = useRef<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const key = mutationKey.current ?? crypto.randomUUID();
    mutationKey.current = key;
    try {
      await api(`/api/v1/organizations/${organizationId}/projects`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ name, description: '' }),
      });
      mutationKey.current = null;
      setUnknownOutcome(false);
      setName('');
      await onChanged();
    } catch (caught) {
      const retrySame = shouldRetrySameMutation(caught);
      if (!retrySame) mutationKey.current = null;
      setUnknownOutcome(retrySame);
      onError(caught);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="control-card">
      <div className="section-title compact">
        <div>
          <h2>Projects</h2>
          <p>Tenant-scoped containers</p>
        </div>
        <span>{projects.length}</span>
      </div>
      <ul className="project-list">
        {projects.slice(0, 6).map((project) => (
          <li key={project.id}>
            <span>{project.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{project.name}</strong>
              <small>{project.description || 'No description'}</small>
            </div>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={submit}>
        <input
          aria-label="New project name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          placeholder={unknownOutcome ? 'Retry the same project request' : 'New project'}
          disabled={unknownOutcome}
        />
        <button disabled={name.trim().length < 2 || submitting}>
          {unknownOutcome ? '↻' : '+'}
        </button>
      </form>
    </div>
  );
}

function ControlsView({ organization }: { organization: Membership }) {
  const controls = [
    ['Identity', 'Cloudflare Access', 'Production memberships are operator-provisioned'],
    ['Tenant role', organization.role, `Scope ${organization.organizationId}`],
    ['Model tools', 'None', 'No shell, browser, fetch tool, or application secret'],
    ['Durability', 'Cloudflare Workflows', 'Two-hour wall-clock limit and terminal reconciliation'],
    ['AI switch', 'Server controlled', 'Disabled by default in the checked deployment config'],
  ];
  return (
    <section>
      <div className="section-title">
        <div>
          <h2>Runtime controls</h2>
          <p>Visible security posture for this deployment</p>
        </div>
      </div>
      <div className="controls-table">
        {controls.map(([name, value, detail]) => (
          <div key={name}>
            <span>{name}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>
      <div className="notice static">
        <span>
          TeamBoundary AI is an independent open-source project built for Cloudflare services. It is
          not affiliated with or endorsed by Cloudflare, Inc.
        </span>
      </div>
    </section>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      <span>{icon}</span>
      {children}
    </button>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <span>○</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function initials(value: string) {
  return value
    .split(/\s+|@/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function errorCode(error: unknown) {
  if (error instanceof ApiClientError || error instanceof ApiNetworkError) return error.message;
  return 'unexpected_error';
}

function shouldRetrySameMutation(error: unknown): boolean {
  if (error instanceof ApiNetworkError) return true;
  if (!(error instanceof ApiClientError)) return true;
  return error.status >= 500 || [408, 425, 429].includes(error.status);
}
