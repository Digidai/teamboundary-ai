PRAGMA foreign_keys = ON;

CREATE TABLE deployment_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  max_identities INTEGER NOT NULL CHECK (max_identities BETWEEN 1 AND 10000),
  account_active_run_limit INTEGER NOT NULL CHECK (account_active_run_limit BETWEEN 1 AND 10000),
  account_daily_run_limit INTEGER NOT NULL CHECK (account_daily_run_limit BETWEEN 1 AND 1000000),
  account_daily_ai_attempt_limit INTEGER NOT NULL CHECK (account_daily_ai_attempt_limit BETWEEN 1 AND 1000000),
  ai_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ai_enabled IN (0, 1))
);

INSERT INTO deployment_limits
  (id, max_identities, account_active_run_limit, account_daily_run_limit,
   account_daily_ai_attempt_limit, ai_enabled)
VALUES (1, 25, 25, 200, 500, 0);

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  project_limit INTEGER NOT NULL DEFAULT 50 CHECK (project_limit BETWEEN 1 AND 10000),
  active_run_limit INTEGER NOT NULL DEFAULT 10 CHECK (active_run_limit BETWEEN 1 AND 10000),
  daily_run_limit INTEGER NOT NULL DEFAULT 50 CHECK (daily_run_limit BETWEEN 1 AND 100000),
  daily_ai_attempt_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_ai_attempt_limit BETWEEN 1 AND 100000),
  run_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (run_retention_days BETWEEN 1 AND 3650),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE memberships (
  organization_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, identity_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE CASCADE
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'chat'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  input TEXT NOT NULL CHECK (length(input) BETWEEN 1 AND 20000),
  output TEXT CHECK (output IS NULL OR length(output) <= 100000),
  error_code TEXT,
  workflow_instance_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requested_by)
    REFERENCES memberships(organization_id, identity_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_identity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_identity_id)
    REFERENCES memberships(organization_id, identity_id)
);

CREATE TABLE idempotency_receipts (
  organization_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('project', 'run')),
  resource_id TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_body TEXT NOT NULL CHECK (length(response_body) <= 64000),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, identity_id, route, idempotency_key),
  FOREIGN KEY (organization_id, identity_id)
    REFERENCES memberships(organization_id, identity_id) ON DELETE CASCADE
);

CREATE TABLE organization_usage_daily (
  organization_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  ai_attempts INTEGER NOT NULL DEFAULT 0 CHECK (ai_attempts >= 0),
  PRIMARY KEY (organization_id, usage_day),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE account_usage_daily (
  usage_day TEXT PRIMARY KEY,
  ai_attempts INTEGER NOT NULL DEFAULT 0 CHECK (ai_attempts >= 0)
);

CREATE INDEX idx_memberships_identity ON memberships(identity_id, organization_id);
CREATE INDEX idx_memberships_active ON memberships(identity_id, revoked_at, organization_id);
CREATE INDEX idx_projects_org_created ON projects(organization_id, created_at DESC);
CREATE INDEX idx_runs_org_created ON runs(organization_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_org_project_created ON runs(organization_id, project_id, created_at DESC);
CREATE INDEX idx_runs_org_status ON runs(organization_id, status, created_at);
CREATE INDEX idx_runs_actor_created ON runs(requested_by, created_at);
CREATE INDEX idx_runs_status_created ON runs(status, created_at);
CREATE INDEX idx_runs_status_completed ON runs(status, completed_at);
CREATE INDEX idx_runs_reconcile ON runs(status, error_code, updated_at);
CREATE INDEX idx_audit_org_created ON audit_events(organization_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_events(resource_type, organization_id, resource_id);
CREATE INDEX idx_idempotency_resource
  ON idempotency_receipts(resource_type, organization_id, resource_id);

CREATE TRIGGER protect_deployment_limits
BEFORE DELETE ON deployment_limits
BEGIN
  SELECT RAISE(ABORT, 'deployment_limits_cannot_be_deleted');
END;

CREATE TRIGGER protect_deployment_limits_identity
BEFORE UPDATE OF id ON deployment_limits
BEGIN
  SELECT RAISE(ABORT, 'deployment_limits_identity_cannot_change');
END;

CREATE TRIGGER require_deployment_limits_for_identity
BEFORE INSERT ON identities
WHEN NOT EXISTS (SELECT 1 FROM deployment_limits WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'deployment_limits_missing');
END;

CREATE TRIGGER enforce_identity_limit
BEFORE INSERT ON identities
WHEN (SELECT COUNT(*) FROM identities) >= (
  SELECT max_identities FROM deployment_limits WHERE id = 1
)
BEGIN
  SELECT RAISE(ABORT, 'deployment_identity_limit_exceeded');
END;

CREATE TRIGGER require_deployment_limits_for_run
BEFORE INSERT ON runs
WHEN NOT EXISTS (SELECT 1 FROM deployment_limits WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'deployment_limits_missing');
END;

CREATE TRIGGER enforce_project_limit
BEFORE INSERT ON projects
WHEN (SELECT COUNT(*) FROM projects WHERE organization_id = NEW.organization_id) >= (
  SELECT project_limit FROM organizations WHERE id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'organization_project_limit_exceeded');
END;

CREATE TRIGGER enforce_account_active_run_limit
BEFORE INSERT ON runs
WHEN (SELECT COUNT(*) FROM runs WHERE status IN ('pending', 'running')) >= (
  SELECT account_active_run_limit FROM deployment_limits WHERE id = 1
)
BEGIN
  SELECT RAISE(ABORT, 'account_active_run_limit_exceeded');
END;

CREATE TRIGGER enforce_organization_active_run_limit
BEFORE INSERT ON runs
WHEN (
  SELECT COUNT(*) FROM runs
  WHERE organization_id = NEW.organization_id AND status IN ('pending', 'running')
) >= (
  SELECT active_run_limit FROM organizations WHERE id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'organization_active_run_limit_exceeded');
END;

CREATE TRIGGER enforce_account_daily_run_limit
BEFORE INSERT ON runs
WHEN (
  SELECT COUNT(*) FROM runs WHERE substr(created_at, 1, 10) = substr(NEW.created_at, 1, 10)
) >= (
  SELECT account_daily_run_limit FROM deployment_limits WHERE id = 1
)
BEGIN
  SELECT RAISE(ABORT, 'account_daily_run_limit_exceeded');
END;

CREATE TRIGGER enforce_organization_daily_run_limit
BEFORE INSERT ON runs
WHEN (
  SELECT COUNT(*) FROM runs
  WHERE organization_id = NEW.organization_id
    AND substr(created_at, 1, 10) = substr(NEW.created_at, 1, 10)
) >= (
  SELECT daily_run_limit FROM organizations WHERE id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'organization_daily_run_limit_exceeded');
END;

CREATE TRIGGER enforce_actor_daily_run_limit
BEFORE INSERT ON runs
WHEN (
  SELECT COUNT(*) FROM runs
  WHERE requested_by = NEW.requested_by
    AND substr(created_at, 1, 10) = substr(NEW.created_at, 1, 10)
) >= 30
BEGIN
  SELECT RAISE(ABORT, 'actor_daily_run_limit_exceeded');
END;

CREATE TRIGGER enforce_run_ai_gate
BEFORE INSERT ON runs
WHEN NOT EXISTS (
  SELECT 1 FROM deployment_limits WHERE id = 1 AND ai_enabled = 1
)
BEGIN
  SELECT RAISE(ABORT, 'ai_disabled');
END;

CREATE TRIGGER enforce_active_run_membership
BEFORE INSERT ON runs
WHEN NOT EXISTS (
  SELECT 1 FROM memberships
  WHERE organization_id = NEW.organization_id
    AND identity_id = NEW.requested_by
    AND revoked_at IS NULL
    AND role IN ('owner', 'admin', 'member')
)
BEGIN
  SELECT RAISE(ABORT, 'membership_not_authorized');
END;

CREATE TRIGGER enforce_active_receipt_membership
BEFORE INSERT ON idempotency_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM memberships
  WHERE organization_id = NEW.organization_id
    AND identity_id = NEW.identity_id
    AND revoked_at IS NULL
    AND role IN ('owner', 'admin', 'member')
)
BEGIN
  SELECT RAISE(ABORT, 'membership_not_authorized');
END;

CREATE TRIGGER enforce_active_create_audit_membership
BEFORE INSERT ON audit_events
WHEN NEW.action IN ('project.create', 'run.create')
  AND NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = NEW.organization_id
      AND identity_id = NEW.actor_identity_id
      AND revoked_at IS NULL
      AND role IN ('owner', 'admin', 'member')
  )
BEGIN
  SELECT RAISE(ABORT, 'membership_not_authorized');
END;

CREATE TRIGGER enforce_ai_kill_switch
BEFORE UPDATE OF ai_attempts ON organization_usage_daily
WHEN NEW.ai_attempts > OLD.ai_attempts
  AND NOT EXISTS (
    SELECT 1 FROM deployment_limits WHERE id = 1 AND ai_enabled = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'ai_disabled');
END;

CREATE TRIGGER enforce_account_ai_attempt_limit
BEFORE UPDATE OF ai_attempts ON organization_usage_daily
WHEN NEW.ai_attempts > OLD.ai_attempts
BEGIN
  INSERT OR IGNORE INTO account_usage_daily (usage_day, ai_attempts)
    VALUES (NEW.usage_day, 0);
  UPDATE account_usage_daily
    SET ai_attempts = ai_attempts + (NEW.ai_attempts - OLD.ai_attempts)
    WHERE usage_day = NEW.usage_day
      AND ai_attempts + (NEW.ai_attempts - OLD.ai_attempts) <= (
        SELECT account_daily_ai_attempt_limit FROM deployment_limits WHERE id = 1
      );
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'account_ai_budget_exhausted') END;
END;

CREATE TRIGGER cleanup_run_related_records
AFTER DELETE ON runs
BEGIN
  DELETE FROM idempotency_receipts
    WHERE resource_type = 'run'
      AND organization_id = OLD.organization_id
      AND resource_id = OLD.id;
  DELETE FROM audit_events
    WHERE resource_type = 'run'
      AND organization_id = OLD.organization_id
      AND resource_id = OLD.id;
END;
