CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sc_connections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  name text,
  remote_account_id text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sc_connections_tenant_idx ON sc_connections(tenant_id, status);

CREATE TABLE IF NOT EXISTS sc_entity_configs (
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  entity text NOT NULL,
  version integer NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id, entity, version),
  FOREIGN KEY (connection_id) REFERENCES sc_connections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sc_entity_configs_latest_idx ON sc_entity_configs(tenant_id, connection_id, entity, version DESC);

CREATE TABLE IF NOT EXISTS sc_sync_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  provider text NOT NULL,
  entity text NOT NULL,
  operation text NOT NULL,
  source text NOT NULL,
  local_id text,
  remote_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping_version integer,
  received_at timestamptz NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_sync_events_tenant_connection_idx ON sc_sync_events(tenant_id, connection_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sc_sync_events_status_idx ON sc_sync_events(status, received_at);

CREATE TABLE IF NOT EXISTS sc_record_mappings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  entity text NOT NULL,
  local_id text NOT NULL,
  remote_id text NOT NULL,
  external_id text,
  last_synced_hash text,
  last_synced_snapshot jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, connection_id, entity, local_id),
  UNIQUE (tenant_id, connection_id, entity, remote_id)
);

CREATE TABLE IF NOT EXISTS sc_write_fingerprints (
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  entity text NOT NULL,
  remote_id text NOT NULL,
  fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id, entity, remote_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS sc_write_fingerprints_expiry_idx ON sc_write_fingerprints(expires_at);

CREATE TABLE IF NOT EXISTS sc_conflicts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  entity text NOT NULL,
  local_id text,
  remote_id text,
  field text NOT NULL,
  local_value jsonb,
  remote_value jsonb,
  previous_value jsonb,
  status text NOT NULL,
  detected_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS sc_conflicts_open_idx ON sc_conflicts(tenant_id, connection_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS sc_checkpoints (
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  entity text NOT NULL,
  checkpoint jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id, entity)
);

CREATE TABLE IF NOT EXISTS sc_local_records (
  tenant_id text NOT NULL,
  entity text NOT NULL,
  id text NOT NULL,
  record jsonb NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity, id)
);
CREATE INDEX IF NOT EXISTS sc_local_records_tenant_entity_idx ON sc_local_records(tenant_id, entity, updated_at DESC);

CREATE TABLE IF NOT EXISTS sc_oauth_states (
  state_hash text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sc_audit_log (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text,
  actor text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_audit_log_tenant_idx ON sc_audit_log(tenant_id, created_at DESC);
