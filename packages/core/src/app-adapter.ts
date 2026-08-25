import type { ApplicationAdapter, CanonicalEntity, CanonicalRecord, DeletePolicy } from '@sales-connect/types';
import type { SyncStorage } from './storage.js';

export class StorageApplicationAdapter implements ApplicationAdapter {
  constructor(private readonly storage: SyncStorage) {}

  get(tenantId: string, entity: CanonicalEntity, id: string) {
    return this.storage.getLocalRecord(tenantId, entity, id);
  }

  upsert(tenantId: string, _entity: CanonicalEntity, record: CanonicalRecord) {
    return this.storage.upsertLocalRecord(tenantId, record);
  }

  async delete(tenantId: string, entity: CanonicalEntity, id: string, policy: DeletePolicy) {
    if (policy === 'ignore' || policy === 'manual') return;
    await this.storage.deleteLocalRecord(tenantId, entity, id, policy !== 'hard_delete');
  }

  async list(tenantId: string, entity: CanonicalEntity) {
    return { records: await this.storage.listLocalRecords(tenantId, entity, 1000) };
  }
}
