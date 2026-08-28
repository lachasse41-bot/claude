-- ---------------------------------------------------------------------------
-- Schema relationnel. L'isolation des donnees repose sur deux colonnes
-- systematiques : organization_id (multi-organisation) et user_id (espace prive
-- du collaborateur). Toutes les requetes de lecture les filtrent explicitement.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Table de reference des roles (definition centralisee des permissions).
CREATE TABLE IF NOT EXISTS roles (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  email_lower     TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL REFERENCES roles(key),
  status          TEXT NOT NULL DEFAULT 'active',
  avatar_color    TEXT NOT NULL DEFAULT '#6366f1',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users(organization_id, email_lower);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id, role, status);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  ip              TEXT,
  user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS invitations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_lower     TEXT NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL REFERENCES roles(key),
  initial_credits INTEGER NOT NULL DEFAULT 0,
  token_hash      TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending',
  expires_at      TEXT NOT NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  accepted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id, status);

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model_key         TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  kind              TEXT NOT NULL,
  family            TEXT NOT NULL DEFAULT '',
  provider          TEXT NOT NULL DEFAULT 'kie',
  provider_model    TEXT NOT NULL,
  transport         TEXT NOT NULL DEFAULT 'jobs',
  docs_url          TEXT NOT NULL DEFAULT '',
  timeout_seconds   INTEGER NOT NULL DEFAULT 600,
  -- Definition complete (params, credits, outputs) au format JSON : c'est
  -- cette structure qui pilote l'interface et la validation serveur.
  definition_json   TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 100,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_org_key ON models(organization_id, model_key);

CREATE TABLE IF NOT EXISTS files (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  original_name   TEXT NOT NULL,
  stored_path     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  checksum        TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'upload', -- upload | provider_output
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(organization_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS generations (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id          TEXT REFERENCES models(id) ON DELETE SET NULL,
  model_key         TEXT NOT NULL,
  model_name        TEXT NOT NULL,
  kind              TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'queued',
  prompt            TEXT NOT NULL DEFAULT '',
  params_json       TEXT NOT NULL DEFAULT '{}',
  provider_input_json TEXT NOT NULL DEFAULT '{}',
  credit_cost       INTEGER NOT NULL DEFAULT 0,
  credits_refunded  INTEGER NOT NULL DEFAULT 0,
  external_task_id  TEXT,
  error_code        TEXT,
  error_message     TEXT,          -- message destine a l'utilisateur
  error_detail_json TEXT,          -- diagnostic complet, jamais expose au client
  progress          INTEGER NOT NULL DEFAULT 0,
  batch_id          TEXT,
  batch_index       INTEGER NOT NULL DEFAULT 0,
  batch_size        INTEGER NOT NULL DEFAULT 1,
  workflow_run_id   TEXT,
  workflow_step_id  TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_poll_at      TEXT,
  deadline_at       TEXT,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_state ON generations(state, next_poll_at);
CREATE INDEX IF NOT EXISTS idx_generations_batch ON generations(batch_id);
CREATE INDEX IF NOT EXISTS idx_generations_workflow ON generations(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_generations_model ON generations(organization_id, model_key);

CREATE TABLE IF NOT EXISTS generation_assets (
  id            TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  file_id       TEXT REFERENCES files(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,        -- input | output
  role          TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL,        -- URL distante (provider) ou vide si fichier local
  mime_type     TEXT,
  size_bytes    INTEGER,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_generation ON generation_assets(generation_id, kind, position);

CREATE TABLE IF NOT EXISTS gallery_items (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id   TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  asset_id        TEXT NOT NULL REFERENCES generation_assets(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  tags_json       TEXT NOT NULL DEFAULT '[]',
  favorite        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_asset ON gallery_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_gallery_owner ON gallery_items(organization_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_balances (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  balance         INTEGER NOT NULL DEFAULT 0,
  total_granted   INTEGER NOT NULL DEFAULT 0,
  total_spent     INTEGER NOT NULL DEFAULT 0,
  allow_overdraft INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,  -- grant | debit | refund | adjustment
  amount          INTEGER NOT NULL, -- signe : negatif pour un debit
  balance_after   INTEGER NOT NULL,
  generation_id   TEXT,
  model_key       TEXT,
  reason          TEXT NOT NULL DEFAULT '',
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_generation ON credit_transactions(generation_id);

CREATE TABLE IF NOT EXISTS workflows (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_owner ON workflows(organization_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'generation',
  model_key    TEXT NOT NULL,
  prompt       TEXT NOT NULL DEFAULT '',
  params_json  TEXT NOT NULL DEFAULT '{}',
  inputs_json  TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_steps ON workflow_steps(workflow_id, position);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'queued',
  current_step    INTEGER NOT NULL DEFAULT 0,
  total_steps     INTEGER NOT NULL DEFAULT 0,
  credit_cost     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  context_json    TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_runs ON workflow_runs(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_runs_state ON workflow_runs(state);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id       TEXT NOT NULL,
  position      INTEGER NOT NULL,
  name          TEXT NOT NULL,
  model_key     TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending',
  generation_id TEXT REFERENCES generations(id) ON DELETE SET NULL,
  error_message TEXT,
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_step_runs ON workflow_step_runs(run_id, position);

CREATE TABLE IF NOT EXISTS activity_logs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id   TEXT,
  actor_name      TEXT,
  actor_email     TEXT,
  target_user_id  TEXT,
  target_name     TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  ip              TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_org ON activity_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(organization_id, actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_configurations (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'kie',
  base_url            TEXT NOT NULL,
  api_key_encrypted   TEXT,           -- AES-256-GCM, jamais renvoye au client
  key_last4           TEXT,
  last_check_at       TEXT,
  last_check_status   TEXT,
  last_check_message  TEXT,
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apiconfig_org ON api_configurations(organization_id, provider);

-- Configuration du service d'envoi d'e-mails (SMTP), par organisation.
-- Le mot de passe est chiffre au repos, comme la cle API du fournisseur IA.
CREATE TABLE IF NOT EXISTS email_configurations (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enabled             INTEGER NOT NULL DEFAULT 0,
  -- smtp : relais classique ; resend / brevo : API HTTP (aucun relais requis).
  provider            TEXT NOT NULL DEFAULT 'smtp',
  api_key_encrypted   TEXT,
  host                TEXT NOT NULL DEFAULT '',
  port                INTEGER NOT NULL DEFAULT 587,
  secure              INTEGER NOT NULL DEFAULT 0,   -- TLS implicite (port 465)
  username            TEXT NOT NULL DEFAULT '',
  password_encrypted  TEXT,                         -- AES-256-GCM, jamais renvoye
  from_name           TEXT NOT NULL DEFAULT '',
  from_email          TEXT NOT NULL DEFAULT '',
  reply_to            TEXT NOT NULL DEFAULT '',
  last_check_at       TEXT,
  last_check_status   TEXT,
  last_check_message  TEXT,
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emailconfig_org ON email_configurations(organization_id);
