import { randomUUID } from 'node:crypto';
import type {
  ApplicationAdapter, CRMProvider, CanonicalEntity, CanonicalRecord, Connection, EntitySyncConfig,
  OAuthConfig, ProviderRequestContext, RecordMapping, SyncConflict, SyncEvent, TokenSet
} from '@sales-connect/types';
import { decryptJson, encryptJson, hashObject, sha256 } from './crypto.js';
import { detectThreeWayConflicts } from './conflicts.js';
import { directionAllows, pickRemoteFields, toRemoteData } from './mapping.js';
import type { JobQueue, SyncStorage } from './storage.js';

export interface SalesConnectEngineOptions {
  storage: SyncStorage;
  queue: JobQueue;
  providers: CRMProvider[];
  application: ApplicationAdapter;
  masterKey: string;
  oauth: Partial<Record<string, OAuthConfig>>;
  onEvent?: (event: { type: string; tenantId: string; connectionId: string; data?: unknown }) => Promise<void> | void;
}

export class SalesConnectEngine {
  private readonly providers = new Map<string, CRMProvider>();

  constructor(private readonly options: SalesConnectEngineOptions) {
    for (const provider of options.providers) this.providers.set(provider.id, provider);
  }

  provider(id: string): CRMProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Unknown CRM provider: ${id}`);
    return p;
  }

  async createConnection(args: { tenantId: string; provider: string; name?: string; config?: Record<string, unknown> }): Promise<Connection> {
    this.provider(args.provider);
    const now = new Date().toISOString();
    const connection: Connection = {
      id: `con_${randomUUID().replaceAll('-', '')}`,
      tenantId: args.tenantId,
      provider: args.provider,
      status: 'connecting',
      name: args.name,
      config: args.config ?? {},
      credentialsEncrypted: null,
      createdAt: now,
      updatedAt: now
    };
    await this.options.storage.createConnection(connection);
    return connection;
  }

  authorizationUrl(connection: Connection, state: string, scopes?: string[]): string {
    const provider = this.provider(connection.provider);
    const oauth = this.options.oauth[connection.provider];
    if (!oauth) throw new Error(`OAuth is not configured for provider ${connection.provider}`);
    return provider.getAuthorizationUrl(oauth, state, scopes);
  }

  async completeOAuth(connection: Connection, code: string, extra?: Record<string, string>): Promise<void> {
    const provider = this.provider(connection.provider);
    const oauth = this.options.oauth[connection.provider];
    if (!oauth) throw new Error(`OAuth is not configured for provider ${connection.provider}`);
    const token = await provider.exchangeAuthorizationCode(oauth, code, extra);
    await this.options.storage.updateConnection(connection.tenantId, connection.id, {
      credentialsEncrypted: encryptJson(token, this.options.masterKey),
      status: 'active',
      updatedAt: new Date().toISOString()
    });
    await this.options.onEvent?.({ type: 'connection.connected', tenantId: connection.tenantId, connectionId: connection.id });
  }

  async providerContext(connection: Connection): Promise<ProviderRequestContext> {
    if (!connection.credentialsEncrypted) throw new Error('Connection has no credentials');
    let token = decryptJson<TokenSet>(connection.credentialsEncrypted, this.options.masterKey);
    if (token.expiresAt && token.expiresAt < Date.now() + 60_000 && token.refreshToken) {
      const oauth = this.options.oauth[connection.provider];
      if (!oauth) throw new Error(`OAuth is not configured for provider ${connection.provider}`);
      token = await this.provider(connection.provider).refreshToken(oauth, token);
      await this.options.storage.updateConnection(connection.tenantId, connection.id, {
        credentialsEncrypted: encryptJson(token, this.options.masterKey), updatedAt: new Date().toISOString()
      });
    }
    return { tenantId: connection.tenantId, connectionId: connection.id, credentials: token, connectionConfig: connection.config };
  }

  async saveEntityConfig(tenantId: string, connectionId: string, config: EntitySyncConfig) {
    const connection = await this.requireConnection(tenantId, connectionId);
    const provider = this.provider(connection.provider);
    const ctx = await this.providerContext(connection);
    const remoteObject = config.remoteObject ?? this.defaultRemoteObject(connection.provider, config.entity);
    const schema = await provider.discoverFields(ctx, remoteObject);
    const remoteFields = new Set(schema.map(f => f.name));
    for (const mapping of config.mappings) {
      if (!remoteFields.has(mapping.remote)) throw new Error(`Remote field ${mapping.remote} was not found on ${remoteObject}`);
    }
    return this.options.storage.saveEntityConfig(tenantId, connectionId, { ...config, remoteObject });
  }

  async localUpsert(args: { tenantId: string; connectionId: string; entity: CanonicalEntity; record: CanonicalRecord; enqueue?: boolean }): Promise<CanonicalRecord> {
    const connection = await this.requireConnection(args.tenantId, args.connectionId);
    const config = await this.requireConfig(args.tenantId, args.connectionId, args.entity);
    const saved = await this.options.application.upsert(args.tenantId, args.entity, { ...args.record, entity: args.entity, updatedAt: new Date().toISOString() });
    if (directionAllows(config.direction, 'local_to_remote') && args.enqueue !== false && connection.status === 'active') {
      const event = this.newEvent(connection, args.entity, 'upsert', 'local', { record: saved }, saved.id, undefined, config.version);
      await this.ingestEvent(event);
    }
    return saved;
  }

  async localDelete(args: { tenantId: string; connectionId: string; entity: CanonicalEntity; localId: string }): Promise<void> {
    const connection = await this.requireConnection(args.tenantId, args.connectionId);
    const config = await this.requireConfig(args.tenantId, args.connectionId, args.entity);
    const mapping = await this.options.storage.getMappingByLocal(args.tenantId, args.connectionId, args.entity, args.localId);
    await this.options.application.delete(args.tenantId, args.entity, args.localId, config.deletePolicy?.localToRemote ?? 'soft_delete');
    if (directionAllows(config.direction, 'local_to_remote') && mapping && connection.status === 'active') {
      const event = this.newEvent(connection, args.entity, 'delete', 'local', {}, args.localId, mapping.remoteId, config.version);
      await this.ingestEvent(event);
    }
  }

  async ingestRemoteEvent(args: { tenantId: string; connectionId: string; entity: CanonicalEntity; remoteId: string; operation: SyncEvent['operation']; payload?: unknown; providerEventId?: string }) {
    const connection = await this.requireConnection(args.tenantId, args.connectionId);
    const config = await this.requireConfig(args.tenantId, args.connectionId, args.entity);
    const id = args.providerEventId ? `evt_${sha256(`${connection.provider}:${connection.id}:${args.providerEventId}`)}` : undefined;
    const event = this.newEvent(connection, args.entity, args.operation, 'remote', args.payload ?? {}, undefined, args.remoteId, config.version, id);
    await this.ingestEvent(event);
    return event;
  }

  async ingestEvent(event: SyncEvent): Promise<boolean> {
    const inserted = await this.options.storage.appendEvent(event);
    if (!inserted) return false;
    await this.options.queue.publish('sync.event', { tenantId: event.tenantId, eventId: event.id }, { singletonKey: event.id, retryLimit: 7 });
    return true;
  }

  async processEvent(tenantId: string, eventId: string): Promise<void> {
    const event = await this.options.storage.getEvent(tenantId, eventId);
    if (!event || ['succeeded', 'ignored'].includes(event.status)) return;
    await this.options.storage.updateEvent(tenantId, eventId, { status: 'processing', attempt: event.attempt + 1 });
    try {
      const connection = await this.requireConnection(tenantId, event.connectionId);
      if (connection.status === 'paused' || connection.status === 'disconnected') {
        await this.options.storage.updateEvent(tenantId, eventId, { status: 'ignored', error: `Connection is ${connection.status}` });
        return;
      }
      const config = await this.requireConfig(tenantId, connection.id, event.entity);
      if (event.source === 'local') await this.processLocalToRemote(connection, config, event);
      else await this.processRemoteToLocal(connection, config, event);
      await this.options.storage.updateEvent(tenantId, eventId, { status: 'succeeded', error: null });
      await this.options.onEvent?.({ type: 'sync.event.succeeded', tenantId, connectionId: connection.id, data: { eventId, provider: connection.provider, entity: event.entity } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttempt = event.attempt + 1;
      if (nextAttempt >= 8) {
        await this.options.storage.updateEvent(tenantId, eventId, { status: 'dead_letter', attempt: nextAttempt, error: message });
        await this.options.onEvent?.({ type: 'sync.event.dead_letter', tenantId, connectionId: event.connectionId, data: { eventId, provider: event.provider, entity: event.entity, error: message } });
        return;
      }
      await this.options.storage.updateEvent(tenantId, eventId, { status: 'failed', attempt: nextAttempt, error: message });
      await this.options.onEvent?.({ type: 'sync.event.failed', tenantId, connectionId: event.connectionId, data: { eventId, provider: event.provider, entity: event.entity, error: message, attempt: nextAttempt } });
      throw error;
    }
  }

  private async processLocalToRemote(connection: Connection, config: EntitySyncConfig & { version: number }, event: SyncEvent) {
    if (!directionAllows(config.direction, 'local_to_remote')) return;
    const provider = this.provider(connection.provider);
    const ctx = await this.providerContext(connection);
    const object = config.remoteObject ?? this.defaultRemoteObject(connection.provider, event.entity);
    if (event.operation === 'delete') {
      if (!event.remoteId) return;
      const policy = config.deletePolicy?.localToRemote ?? 'archive';
      if (policy !== 'ignore' && policy !== 'manual') await provider.deleteRecord(ctx, object, event.remoteId);
      return;
    }
    const record = (event.payload as { record?: CanonicalRecord }).record ?? (event.localId ? await this.options.application.get(connection.tenantId, event.entity, event.localId) : null);
    if (!record) throw new Error('Local record not found');
    let recordToPush: CanonicalRecord = { ...record, fields: { ...record.fields }, customFields: { ...(record.customFields ?? {}) } };
    let mapping = await this.options.storage.getMappingByLocal(connection.tenantId, connection.id, event.entity, record.id);
    if (mapping?.lastSyncedSnapshot) {
      try {
        const currentRemote = await provider.getRecord(ctx, object, mapping.remoteId, pickRemoteFields(config));
        const canonicalRemote = await provider.normalize(object, currentRemote, config);
        const conflicts = detectThreeWayConflicts(recordToPush, canonicalRemote, mapping.lastSyncedSnapshot, config);
        const manual = conflicts.filter(c => c.resolution === 'manual');
        for (const c of manual) {
          await this.options.storage.saveConflict({
            id: `conf_${randomUUID().replaceAll('-', '')}`, tenantId: connection.tenantId, connectionId: connection.id,
            entity: event.entity, localId: record.id, remoteId: mapping.remoteId, field: c.field, localValue: c.localValue,
            remoteValue: c.remoteValue, previousValue: c.previousValue, status: 'open', detectedAt: new Date().toISOString()
          });
        }
        if (manual.length) {
          await this.options.onEvent?.({ type: 'conflict.detected', tenantId: connection.tenantId, connectionId: connection.id, data: { remoteId: mapping.remoteId, conflicts: manual } });
          return;
        }
        for (const c of conflicts) {
          if (c.resolution === 'remote') recordToPush.fields[c.field] = c.remoteValue;
        }
        if (conflicts.some(c => c.resolution === 'remote')) {
          recordToPush = await this.options.application.upsert(connection.tenantId, event.entity, recordToPush);
        }
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status !== 404) throw error;
      }
    }
    const data = await provider.denormalize(object, recordToPush, config);
    let remote;
    if (mapping) {
      remote = await provider.updateRecord(ctx, object, mapping.remoteId, data);
    } else if (config.externalIdField) {
      remote = await provider.upsertRecord(ctx, object, { field: config.externalIdField, value: record.id }, data);
    } else {
      remote = await provider.createRecord(ctx, object, data);
    }
    const canonicalRemote = await provider.normalize(object, remote, config);
    mapping = mapping ?? this.newMapping(connection, event.entity, record.id, remote.id);
    mapping.remoteId = remote.id;
    mapping.lastSyncedSnapshot = canonicalRemote;
    mapping.lastSyncedHash = hashObject(canonicalRemote);
    mapping.updatedAt = new Date().toISOString();
    await this.options.storage.upsertMapping(mapping);
    await this.options.storage.saveFingerprint({
      tenantId: connection.tenantId, connectionId: connection.id, entity: event.entity, remoteId: remote.id,
      fingerprint: hashObject(data), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    });
  }

  private async processRemoteToLocal(connection: Connection, config: EntitySyncConfig & { version: number }, event: SyncEvent) {
    if (!directionAllows(config.direction, 'remote_to_local')) return;
    if (!event.remoteId) throw new Error('Remote event missing remoteId');
    const provider = this.provider(connection.provider);
    const ctx = await this.providerContext(connection);
    const object = config.remoteObject ?? this.defaultRemoteObject(connection.provider, event.entity);

    if (event.operation === 'delete') {
      const mapping = await this.options.storage.getMappingByRemote(connection.tenantId, connection.id, event.entity, event.remoteId);
      if (mapping) await this.options.application.delete(connection.tenantId, event.entity, mapping.localId, config.deletePolicy?.remoteToLocal ?? 'soft_delete');
      return;
    }

    const remote = await provider.getRecord(ctx, object, event.remoteId, pickRemoteFields(config));
    const remoteData = await provider.denormalize(object, await provider.normalize(object, remote, config), config);
    const fingerprint = hashObject(remoteData);
    if (await this.options.storage.hasFingerprint({ tenantId: connection.tenantId, connectionId: connection.id, entity: event.entity, remoteId: event.remoteId, fingerprint })) return;

    const canonicalRemote = await provider.normalize(object, remote, config);
    let mapping = await this.options.storage.getMappingByRemote(connection.tenantId, connection.id, event.entity, event.remoteId);
    const localId = mapping?.localId ?? canonicalRemote.id;
    const local = await this.options.application.get(connection.tenantId, event.entity, localId);
    const previous = mapping?.lastSyncedSnapshot ?? null;

    if (local && previous) {
      const conflicts = detectThreeWayConflicts(local, canonicalRemote, previous, config);
      const manual = conflicts.filter(c => c.resolution === 'manual');
      for (const c of manual) {
        const conflict: SyncConflict = {
          id: `conf_${randomUUID().replaceAll('-', '')}`, tenantId: connection.tenantId, connectionId: connection.id,
          entity: event.entity, localId, remoteId: event.remoteId, field: c.field, localValue: c.localValue,
          remoteValue: c.remoteValue, previousValue: c.previousValue, status: 'open', detectedAt: new Date().toISOString()
        };
        await this.options.storage.saveConflict(conflict);
      }
      if (manual.length) {
        await this.options.onEvent?.({ type: 'conflict.detected', tenantId: connection.tenantId, connectionId: connection.id, data: { remoteId: event.remoteId, conflicts: manual } });
        return;
      }
      for (const c of conflicts) {
        if (c.resolution === 'local') canonicalRemote.fields[c.field] = c.localValue;
      }
    }

    const localSaved = await this.options.application.upsert(connection.tenantId, event.entity, { ...canonicalRemote, id: localId });
    mapping = mapping ?? this.newMapping(connection, event.entity, localSaved.id, event.remoteId);
    mapping.lastSyncedSnapshot = localSaved;
    mapping.lastSyncedHash = hashObject(localSaved);
    mapping.updatedAt = new Date().toISOString();
    await this.options.storage.upsertMapping(mapping);
  }

  async reconcile(tenantId: string, connectionId: string, entity: CanonicalEntity): Promise<{ processed: number; cursor?: string }> {
    const connection = await this.requireConnection(tenantId, connectionId);
    const config = await this.requireConfig(tenantId, connectionId, entity);
    const provider = this.provider(connection.provider);
    const ctx = await this.providerContext(connection);
    const object = config.remoteObject ?? this.defaultRemoteObject(connection.provider, entity);
    const checkpoint = await this.options.storage.getCheckpoint(tenantId, connectionId, entity);
    let cursor = checkpoint?.cursor as string | undefined;
    const modifiedSince = (checkpoint?.modifiedSince as string | undefined) ?? new Date(Date.now() - 30 * 60_000).toISOString();
    let processed = 0;
    do {
      const page = await provider.listRecords(ctx, object, { cursor, modifiedSince, limit: 200, fields: pickRemoteFields(config) });
      for (const remote of page.records) {
        await this.ingestRemoteEvent({ tenantId, connectionId, entity, remoteId: remote.id, operation: 'upsert', payload: { reconciliation: true, remoteUpdatedAt: remote.updatedAt }, providerEventId: `reconcile:${remote.id}:${remote.updatedAt ?? hashObject(remote.fields)}` });
        processed++;
      }
      cursor = page.nextCursor;
      await this.options.storage.saveCheckpoint(tenantId, connectionId, entity, { cursor: cursor ?? null, modifiedSince, watermark: page.watermark ?? new Date().toISOString() });
    } while (cursor);
    await this.options.storage.saveCheckpoint(tenantId, connectionId, entity, { cursor: null, modifiedSince: new Date(Date.now() - 5 * 60_000).toISOString(), watermark: new Date().toISOString() });
    return { processed };
  }

  async backfill(tenantId: string, connectionId: string, entity: CanonicalEntity) {
    const connection = await this.requireConnection(tenantId, connectionId);
    const config = await this.requireConfig(tenantId, connectionId, entity);
    const provider = this.provider(connection.provider);
    const ctx = await this.providerContext(connection);
    const object = config.remoteObject ?? this.defaultRemoteObject(connection.provider, entity);
    await this.options.storage.updateConnection(tenantId, connectionId, { status: 'backfilling', updatedAt: new Date().toISOString() });
    const prior = await this.options.storage.getCheckpoint(tenantId, connectionId, entity);
    let cursor = prior?.backfillCursor as string | undefined;
    let processed = 0;
    do {
      const page = await provider.listRecords(ctx, object, { cursor, limit: 200, fields: pickRemoteFields(config) });
      for (const remote of page.records) {
        const event = this.newEvent(connection, entity, 'upsert', 'backfill', { backfill: true }, undefined, remote.id, config.version,
          `evt_${sha256(`${connection.provider}:${connection.id}:backfill:${entity}:${remote.id}:${remote.updatedAt ?? hashObject(remote.fields)}`)}`);
        await this.ingestEvent(event);
        processed++;
      }
      cursor = page.nextCursor;
      await this.options.storage.saveCheckpoint(tenantId, connectionId, entity, { ...(prior ?? {}), backfillCursor: cursor ?? null, backfillProcessed: processed, backfillUpdatedAt: new Date().toISOString() });
    } while (cursor);
    await this.options.storage.saveCheckpoint(tenantId, connectionId, entity, { backfillCursor: null, backfillCompletedAt: new Date().toISOString(), modifiedSince: new Date(Date.now() - 5 * 60_000).toISOString() });
    await this.options.storage.updateConnection(tenantId, connectionId, { status: 'active', updatedAt: new Date().toISOString() });
    return { processed };
  }

  private newEvent(connection: Connection, entity: CanonicalEntity, operation: SyncEvent['operation'], source: SyncEvent['source'], payload: unknown, localId?: string, remoteId?: string, mappingVersion?: number, id?: string): SyncEvent {
    return {
      id: id ?? `evt_${randomUUID().replaceAll('-', '')}`, tenantId: connection.tenantId, connectionId: connection.id,
      provider: connection.provider, entity, operation, source, localId, remoteId, payload, mappingVersion,
      receivedAt: new Date().toISOString(), status: 'pending', attempt: 0, error: null
    };
  }

  private newMapping(connection: Connection, entity: CanonicalEntity, localId: string, remoteId: string): RecordMapping {
    const now = new Date().toISOString();
    return { id: `map_${randomUUID().replaceAll('-', '')}`, tenantId: connection.tenantId, connectionId: connection.id, entity, localId, remoteId, createdAt: now, updatedAt: now };
  }

  private async requireConnection(tenantId: string, connectionId: string) {
    const connection = await this.options.storage.getConnection(tenantId, connectionId);
    if (!connection) throw new Error('Connection not found');
    return connection;
  }

  private async requireConfig(tenantId: string, connectionId: string, entity: CanonicalEntity) {
    const config = await this.options.storage.getEntityConfig(tenantId, connectionId, entity);
    if (!config) throw new Error(`Sync config for ${entity} not found`);
    return config;
  }

  private defaultRemoteObject(provider: string, entity: CanonicalEntity): string {
    const matrix: Record<string, Record<string, string>> = {
      salesforce: { contact: 'Contact', company: 'Account', lead: 'Lead', deal: 'Opportunity', task: 'Task', note: 'ContentNote' },
      hubspot: { contact: 'contacts', company: 'companies', lead: 'leads', deal: 'deals' },
      zoho: { contact: 'Contacts', company: 'Accounts', lead: 'Leads', deal: 'Deals', task: 'Tasks', note: 'Notes' }
    };
    return matrix[provider]?.[entity] ?? entity;
  }
}
