export type ProviderId = 'salesforce' | 'hubspot' | 'zoho' | (string & {});
export type CanonicalEntity = 'contact' | 'company' | 'lead' | 'deal' | 'owner' | 'pipeline' | 'stage' | 'activity' | 'task' | 'note' | (string & {});
export type SyncDirection = 'remote_to_local' | 'local_to_remote' | 'bidirectional' | 'disabled';
export type FieldOwner = 'local' | 'remote' | 'shared';
export type ConflictStrategy = 'remote_wins' | 'local_wins' | 'latest_wins' | 'field_owner' | 'manual' | 'custom';
export type DeletePolicy = 'ignore' | 'soft_delete' | 'hard_delete' | 'archive' | 'manual';
export type SyncSource = 'local' | 'remote' | 'reconciliation' | 'backfill' | 'manual';
export type SyncOperation = 'create' | 'update' | 'upsert' | 'delete' | 'merge' | 'restore';

export interface CanonicalRecord {
  id: string;
  entity: CanonicalEntity;
  fields: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  metadata?: {
    provider?: ProviderId;
    remoteId?: string;
    remoteCreatedAt?: string;
    remoteUpdatedAt?: string;
    raw?: unknown;
  };
}

export interface FieldMapping {
  local: string;
  remote: string;
  direction?: SyncDirection;
  owner?: FieldOwner;
  required?: boolean;
}

export interface EntitySyncConfig {
  entity: CanonicalEntity;
  remoteObject?: string;
  direction: SyncDirection;
  mappings: FieldMapping[];
  conflictStrategy?: ConflictStrategy;
  deletePolicy?: { remoteToLocal: DeletePolicy; localToRemote: DeletePolicy };
  externalIdField?: string;
  filter?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  tenantId: string;
  provider: ProviderId;
  status: 'connecting' | 'discovering' | 'backfilling' | 'catching_up' | 'active' | 'degraded' | 'paused' | 'error' | 'disconnected';
  name?: string;
  remoteAccountId?: string;
  config: Record<string, unknown>;
  credentialsEncrypted?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  instanceUrl?: string;
  apiDomain?: string;
  tokenType?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ObjectSchema {
  name: string;
  label?: string;
  canonicalEntity?: CanonicalEntity;
  fields: FieldSchema[];
}

export interface FieldSchema {
  name: string;
  label?: string;
  type: string;
  readable?: boolean;
  writable?: boolean;
  required?: boolean;
  unique?: boolean;
}

export interface RemoteRecord {
  id: string;
  object: string;
  fields: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
  raw?: unknown;
}

export interface ListOptions {
  cursor?: string;
  limit?: number;
  modifiedSince?: string;
  fields?: string[];
  filter?: Record<string, unknown>;
}

export interface ListPage {
  records: RemoteRecord[];
  nextCursor?: string;
  watermark?: string;
}

export interface ProviderCapabilities {
  webhooks: boolean;
  cdc: boolean;
  upsert: boolean;
  externalIds: boolean;
  customObjects: boolean;
  batchWrite: boolean;
  bulkRead: boolean;
}

export interface ProviderRequestContext {
  tenantId: string;
  connectionId: string;
  credentials: TokenSet;
  connectionConfig: Record<string, unknown>;
}

export interface CRMProvider {
  id: ProviderId;
  capabilities(): ProviderCapabilities;
  getAuthorizationUrl(config: OAuthConfig, state: string, scopes?: string[]): string;
  exchangeAuthorizationCode(config: OAuthConfig, code: string, extra?: Record<string, string>): Promise<TokenSet>;
  refreshToken(config: OAuthConfig, tokenSet: TokenSet): Promise<TokenSet>;
  discoverObjects(ctx: ProviderRequestContext): Promise<ObjectSchema[]>;
  discoverFields(ctx: ProviderRequestContext, object: string): Promise<FieldSchema[]>;
  getRecord(ctx: ProviderRequestContext, object: string, id: string, fields?: string[]): Promise<RemoteRecord>;
  listRecords(ctx: ProviderRequestContext, object: string, options?: ListOptions): Promise<ListPage>;
  createRecord(ctx: ProviderRequestContext, object: string, data: Record<string, unknown>): Promise<RemoteRecord>;
  updateRecord(ctx: ProviderRequestContext, object: string, id: string, data: Record<string, unknown>): Promise<RemoteRecord>;
  upsertRecord(ctx: ProviderRequestContext, object: string, key: { field: string; value: string }, data: Record<string, unknown>): Promise<RemoteRecord>;
  deleteRecord(ctx: ProviderRequestContext, object: string, id: string): Promise<void>;
  normalize(object: string, remote: RemoteRecord, mapping: EntitySyncConfig): Promise<CanonicalRecord>;
  denormalize(object: string, canonical: CanonicalRecord, mapping: EntitySyncConfig): Promise<Record<string, unknown>>;
  verifyWebhook?(args: { headers: Record<string, string | string[] | undefined>; method: string; url: string; rawBody: string; secret: string }): boolean;
  parseWebhook?(payload: unknown, headers?: Record<string, string | string[] | undefined>): Promise<ProviderWebhookEvent[]>;
}

export interface ProviderWebhookEvent {
  id: string;
  object: string;
  remoteId: string;
  operation: SyncOperation;
  occurredAt?: string;
  changedFields?: string[];
  payload?: unknown;
}

export interface SyncEvent {
  id: string;
  tenantId: string;
  connectionId: string;
  provider: ProviderId;
  entity: CanonicalEntity;
  operation: SyncOperation;
  source: SyncSource;
  localId?: string;
  remoteId?: string;
  payload: unknown;
  mappingVersion?: number;
  receivedAt: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_letter' | 'ignored';
  attempt: number;
  error?: string | null;
}

export interface RecordMapping {
  id: string;
  tenantId: string;
  connectionId: string;
  entity: CanonicalEntity;
  localId: string;
  remoteId: string;
  externalId?: string;
  lastSyncedHash?: string;
  lastSyncedSnapshot?: CanonicalRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncConflict {
  id: string;
  tenantId: string;
  connectionId: string;
  entity: CanonicalEntity;
  localId?: string;
  remoteId?: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  previousValue: unknown;
  status: 'open' | 'resolved_local' | 'resolved_remote' | 'resolved_custom' | 'ignored';
  detectedAt: string;
  resolvedAt?: string | null;
}

export interface ApplicationAdapter {
  get(tenantId: string, entity: CanonicalEntity, id: string): Promise<CanonicalRecord | null>;
  upsert(tenantId: string, entity: CanonicalEntity, record: CanonicalRecord): Promise<CanonicalRecord>;
  delete(tenantId: string, entity: CanonicalEntity, id: string, policy: DeletePolicy): Promise<void>;
  list?(tenantId: string, entity: CanonicalEntity, cursor?: string): Promise<{ records: CanonicalRecord[]; nextCursor?: string }>;
}
