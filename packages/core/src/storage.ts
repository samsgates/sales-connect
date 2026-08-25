import type { CanonicalEntity, CanonicalRecord, Connection, EntitySyncConfig, RecordMapping, SyncConflict, SyncEvent } from '@sales-connect/types';

export interface SyncStorage {
  createConnection(connection: Connection): Promise<void>;
  getConnection(tenantId: string, connectionId: string): Promise<Connection | null>;
  updateConnection(tenantId: string, connectionId: string, patch: Partial<Connection>): Promise<void>;
  listConnections(tenantId: string): Promise<Connection[]>;
  saveEntityConfig(tenantId: string, connectionId: string, config: EntitySyncConfig): Promise<number>;
  getEntityConfig(tenantId: string, connectionId: string, entity: CanonicalEntity): Promise<(EntitySyncConfig & { version: number }) | null>;
  listEntityConfigs(tenantId: string, connectionId: string): Promise<Array<EntitySyncConfig & { version: number }>>;
  appendEvent(event: SyncEvent): Promise<boolean>;
  getEvent(tenantId: string, eventId: string): Promise<SyncEvent | null>;
  listEvents(tenantId: string, connectionId?: string, limit?: number): Promise<SyncEvent[]>;
  updateEvent(tenantId: string, eventId: string, patch: Partial<SyncEvent>): Promise<void>;
  getMappingByLocal(tenantId: string, connectionId: string, entity: CanonicalEntity, localId: string): Promise<RecordMapping | null>;
  getMappingByRemote(tenantId: string, connectionId: string, entity: CanonicalEntity, remoteId: string): Promise<RecordMapping | null>;
  upsertMapping(mapping: RecordMapping): Promise<void>;
  saveFingerprint(args: { tenantId: string; connectionId: string; entity: CanonicalEntity; remoteId: string; fingerprint: string; expiresAt: string }): Promise<void>;
  hasFingerprint(args: { tenantId: string; connectionId: string; entity: CanonicalEntity; remoteId: string; fingerprint: string }): Promise<boolean>;
  saveConflict(conflict: SyncConflict): Promise<void>;
  listConflicts(tenantId: string, connectionId?: string, status?: string): Promise<SyncConflict[]>;
  resolveConflict(tenantId: string, conflictId: string, status: SyncConflict['status']): Promise<void>;
  getCheckpoint(tenantId: string, connectionId: string, entity: CanonicalEntity): Promise<Record<string, unknown> | null>;
  saveCheckpoint(tenantId: string, connectionId: string, entity: CanonicalEntity, checkpoint: Record<string, unknown>): Promise<void>;
  upsertLocalRecord(tenantId: string, record: CanonicalRecord): Promise<CanonicalRecord>;
  getLocalRecord(tenantId: string, entity: CanonicalEntity, id: string): Promise<CanonicalRecord | null>;
  listLocalRecords(tenantId: string, entity: CanonicalEntity, limit?: number): Promise<CanonicalRecord[]>;
  deleteLocalRecord(tenantId: string, entity: CanonicalEntity, id: string, soft?: boolean): Promise<void>;
}

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(name: string, payload: Record<string, unknown>, options?: { singletonKey?: string; retryLimit?: number }): Promise<string | null>;
  work(name: string, handler: (payload: Record<string, unknown>) => Promise<void>): Promise<void>;
}
