import { Pool } from 'pg';
import type { CanonicalEntity, CanonicalRecord, Connection, EntitySyncConfig, RecordMapping, SyncConflict, SyncEvent } from '@sales-connect/types';
import type { SyncStorage } from '@sales-connect/core';

const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
const connectionFromRow = (r: any): Connection => ({
  id: r.id, tenantId: r.tenant_id, provider: r.provider, status: r.status, name: r.name ?? undefined,
  remoteAccountId: r.remote_account_id ?? undefined, config: r.config ?? {}, credentialsEncrypted: r.credentials_encrypted,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at)
});
const eventFromRow = (r: any): SyncEvent => ({
  id:r.id, tenantId:r.tenant_id, connectionId:r.connection_id, provider:r.provider, entity:r.entity,
  operation:r.operation, source:r.source, localId:r.local_id ?? undefined, remoteId:r.remote_id ?? undefined,
  payload:r.payload, mappingVersion:r.mapping_version ?? undefined, receivedAt:iso(r.received_at), status:r.status,
  attempt:r.attempt, error:r.error
});
const mappingFromRow = (r:any): RecordMapping => ({
  id:r.id, tenantId:r.tenant_id, connectionId:r.connection_id, entity:r.entity, localId:r.local_id, remoteId:r.remote_id,
  externalId:r.external_id ?? undefined, lastSyncedHash:r.last_synced_hash ?? undefined, lastSyncedSnapshot:r.last_synced_snapshot ?? null,
  createdAt:iso(r.created_at), updatedAt:iso(r.updated_at)
});
const conflictFromRow = (r:any): SyncConflict => ({
  id:r.id, tenantId:r.tenant_id, connectionId:r.connection_id, entity:r.entity, localId:r.local_id ?? undefined,
  remoteId:r.remote_id ?? undefined, field:r.field, localValue:r.local_value, remoteValue:r.remote_value,
  previousValue:r.previous_value, status:r.status, detectedAt:iso(r.detected_at), resolvedAt:r.resolved_at ? iso(r.resolved_at) : null
});

export class PostgresStorage implements SyncStorage {
  readonly pool: Pool;
  constructor(connectionStringOrPool: string | Pool) {
    this.pool = typeof connectionStringOrPool === 'string' ? new Pool({ connectionString: connectionStringOrPool, max: 20 }) : connectionStringOrPool;
  }

  async close(){ await this.pool.end(); }
  async createConnection(c: Connection) {
    await this.pool.query(`INSERT INTO sc_connections(id,tenant_id,provider,status,name,remote_account_id,config,credentials_encrypted,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.id,c.tenantId,c.provider,c.status,c.name??null,c.remoteAccountId??null,c.config,c.credentialsEncrypted??null,c.createdAt,c.updatedAt]);
  }
  async getConnection(tenantId:string, connectionId:string){ const q=await this.pool.query('SELECT * FROM sc_connections WHERE tenant_id=$1 AND id=$2',[tenantId,connectionId]); return q.rows[0]?connectionFromRow(q.rows[0]):null; }
  async updateConnection(tenantId:string, connectionId:string, patch:Partial<Connection>){
    const current=await this.getConnection(tenantId,connectionId); if(!current) throw new Error('Connection not found');
    const merged={...current,...patch,config:patch.config??current.config,updatedAt:patch.updatedAt??new Date().toISOString()};
    await this.pool.query(`UPDATE sc_connections SET provider=$3,status=$4,name=$5,remote_account_id=$6,config=$7,credentials_encrypted=$8,updated_at=$9 WHERE tenant_id=$1 AND id=$2`,
      [tenantId,connectionId,merged.provider,merged.status,merged.name??null,merged.remoteAccountId??null,merged.config,merged.credentialsEncrypted??null,merged.updatedAt]);
  }
  async listConnections(tenantId:string){ const q=await this.pool.query('SELECT * FROM sc_connections WHERE tenant_id=$1 ORDER BY created_at DESC',[tenantId]); return q.rows.map(connectionFromRow); }
  async saveEntityConfig(tenantId:string,connectionId:string,config:EntitySyncConfig){
    const q=await this.pool.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM sc_entity_configs WHERE tenant_id=$1 AND connection_id=$2 AND entity=$3',[tenantId,connectionId,config.entity]);
    const version=Number(q.rows[0].version); await this.pool.query('INSERT INTO sc_entity_configs(tenant_id,connection_id,entity,version,config) VALUES($1,$2,$3,$4,$5)',[tenantId,connectionId,config.entity,version,config]); return version;
  }
  async getEntityConfig(tenantId:string,connectionId:string,entity:CanonicalEntity){ const q=await this.pool.query('SELECT version,config FROM sc_entity_configs WHERE tenant_id=$1 AND connection_id=$2 AND entity=$3 ORDER BY version DESC LIMIT 1',[tenantId,connectionId,entity]); return q.rows[0]?{...q.rows[0].config,version:q.rows[0].version}:null; }
  async listEntityConfigs(tenantId:string,connectionId:string){ const q=await this.pool.query(`SELECT DISTINCT ON(entity) entity,version,config FROM sc_entity_configs WHERE tenant_id=$1 AND connection_id=$2 ORDER BY entity,version DESC`,[tenantId,connectionId]); return q.rows.map((r:any)=>({...r.config,version:r.version})); }
  async appendEvent(e:SyncEvent){
    const q=await this.pool.query(`INSERT INTO sc_sync_events(id,tenant_id,connection_id,provider,entity,operation,source,local_id,remote_id,payload,mapping_version,received_at,status,attempt,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO NOTHING RETURNING id`,[e.id,e.tenantId,e.connectionId,e.provider,e.entity,e.operation,e.source,e.localId??null,e.remoteId??null,e.payload,e.mappingVersion??null,e.receivedAt,e.status,e.attempt,e.error??null]); return q.rowCount===1;
  }
  async getEvent(tenantId:string,eventId:string){ const q=await this.pool.query('SELECT * FROM sc_sync_events WHERE tenant_id=$1 AND id=$2',[tenantId,eventId]); return q.rows[0]?eventFromRow(q.rows[0]):null; }
  async listEvents(tenantId:string,connectionId?:string,limit=100){ const q=connectionId?await this.pool.query('SELECT * FROM sc_sync_events WHERE tenant_id=$1 AND connection_id=$2 ORDER BY received_at DESC LIMIT $3',[tenantId,connectionId,limit]):await this.pool.query('SELECT * FROM sc_sync_events WHERE tenant_id=$1 ORDER BY received_at DESC LIMIT $2',[tenantId,limit]); return q.rows.map(eventFromRow); }
  async updateEvent(tenantId:string,eventId:string,patch:Partial<SyncEvent>){ const current=await this.getEvent(tenantId,eventId); if(!current) return; const m={...current,...patch}; await this.pool.query('UPDATE sc_sync_events SET status=$3,attempt=$4,error=$5,payload=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenantId,eventId,m.status,m.attempt,m.error??null,m.payload]); }
  async getMappingByLocal(t:string,c:string,e:CanonicalEntity,l:string){ const q=await this.pool.query('SELECT * FROM sc_record_mappings WHERE tenant_id=$1 AND connection_id=$2 AND entity=$3 AND local_id=$4',[t,c,e,l]); return q.rows[0]?mappingFromRow(q.rows[0]):null; }
  async getMappingByRemote(t:string,c:string,e:CanonicalEntity,r:string){ const q=await this.pool.query('SELECT * FROM sc_record_mappings WHERE tenant_id=$1 AND connection_id=$2 AND entity=$3 AND remote_id=$4',[t,c,e,r]); return q.rows[0]?mappingFromRow(q.rows[0]):null; }
  async upsertMapping(m:RecordMapping){ await this.pool.query(`INSERT INTO sc_record_mappings(id,tenant_id,connection_id,entity,local_id,remote_id,external_id,last_synced_hash,last_synced_snapshot,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,connection_id,entity,local_id) DO UPDATE SET remote_id=EXCLUDED.remote_id,external_id=EXCLUDED.external_id,last_synced_hash=EXCLUDED.last_synced_hash,last_synced_snapshot=EXCLUDED.last_synced_snapshot,updated_at=EXCLUDED.updated_at`,[m.id,m.tenantId,m.connectionId,m.entity,m.localId,m.remoteId,m.externalId??null,m.lastSyncedHash??null,m.lastSyncedSnapshot??null,m.createdAt,m.updatedAt]); }
  async saveFingerprint(a:{tenantId:string;connectionId:string;entity:CanonicalEntity;remoteId:string;fingerprint:string;expiresAt:string}){ await this.pool.query(`INSERT INTO sc_write_fingerprints(tenant_id,connection_id,entity,remote_id,fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO UPDATE SET expires_at=EXCLUDED.expires_at`,[a.tenantId,a.connectionId,a.entity,a.remoteId,a.fingerprint,a.expiresAt]); }
  async hasFingerprint(a:{tenantId:string;connectionId:string;entity:CanonicalEntity;remoteId:string;fingerprint:string}){ const q=await this.pool.query(`SELECT 1 FROM sc_write_fingerprints WHERE tenant_id=$1 AND connection_id=$2 AND entity=$3 AND remote_id=$4 AND fingerprint=$5 AND expires_at>now()`,[a.tenantId,a.connectionId,a.entity,a.remoteId,a.fingerprint]); return q.rowCount===1; }
  async saveConflict(c:SyncConflict){ await this.pool.query(`INSERT INTO sc_conflicts(id,tenant_id,connection_id,entity,local_id,remote_id,field,local_value,remote_value,previous_value,status,detected_at,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[c.id,c.tenantId,c.connectionId,c.entity,c.localId??null,c.remoteId??null,c.field,JSON.stringify(c.localValue??null),JSON.stringify(c.remoteValue??null),JSON.stringify(c.previousValue??null),c.status,c.detectedAt,c.resolvedAt??null]); }
  async getConflict(t:string,id:string){ const q=await this.pool.query('SELECT * FROM sc_conflicts WHERE tenant_id=$1 AND id=$2',[t,id]); return q.rows[0]?conflictFromRow(q.rows[0]):null; }
  async listConflicts(t:string,c?:string,status?:string){ let sql='SELECT * FROM sc_conflicts WHERE tenant_id=$1'; const vals:any[]=[t]; if(c){ vals.push(c); sql+=` AND connection_id=$${vals.length}`;} if(status){ vals.push(status); sql+=` AND status=$${vals.length}`;} sql+=' ORDER BY detected_at DESC LIMIT 500'; const q=await this.pool.query(sql,vals); return q.rows.map(conflictFromRow); }
  async resolveConflict(t:string,id:string,status:SyncConflict['status']){ await this.pool.query('UPDATE sc_conflicts SET status=$3,resolved_at=now() WHERE tenant_id=$1 AND id=$2',[t,id,status]); }
  async getCheckpoint(t:string,c:string,e:CanonicalEntity){ const q=await this.pool.query('SELECT checkpoint FROM sc_checkpoints WHERE tenant_id=$1 AND connection_id=$2 AND entity=$3',[t,c,e]); return q.rows[0]?.checkpoint??null; }
  async saveCheckpoint(t:string,c:string,e:CanonicalEntity,checkpoint:Record<string,unknown>){ await this.pool.query(`INSERT INTO sc_checkpoints(tenant_id,connection_id,entity,checkpoint) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,connection_id,entity) DO UPDATE SET checkpoint=EXCLUDED.checkpoint,updated_at=now()`,[t,c,e,checkpoint]); }
  async upsertLocalRecord(t:string,record:CanonicalRecord){ const now=new Date().toISOString(); const saved={...record,createdAt:record.createdAt??now,updatedAt:record.updatedAt??now}; await this.pool.query(`INSERT INTO sc_local_records(tenant_id,entity,id,record,deleted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,entity,id) DO UPDATE SET record=EXCLUDED.record,deleted_at=EXCLUDED.deleted_at,updated_at=EXCLUDED.updated_at`,[t,record.entity,record.id,saved,saved.deletedAt??null,saved.createdAt,saved.updatedAt]); return saved; }
  async getLocalRecord(t:string,e:CanonicalEntity,id:string){ const q=await this.pool.query('SELECT record FROM sc_local_records WHERE tenant_id=$1 AND entity=$2 AND id=$3',[t,e,id]); return q.rows[0]?.record??null; }
  async listLocalRecords(t:string,e:CanonicalEntity,limit=100){ const q=await this.pool.query('SELECT record FROM sc_local_records WHERE tenant_id=$1 AND entity=$2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT $3',[t,e,limit]); return q.rows.map((r:any)=>r.record); }
  async deleteLocalRecord(t:string,e:CanonicalEntity,id:string,soft=true){ if(soft) await this.pool.query(`UPDATE sc_local_records SET deleted_at=now(),record=jsonb_set(record,'{deletedAt}',to_jsonb(now()::text)),updated_at=now() WHERE tenant_id=$1 AND entity=$2 AND id=$3`,[t,e,id]); else await this.pool.query('DELETE FROM sc_local_records WHERE tenant_id=$1 AND entity=$2 AND id=$3',[t,e,id]); }

  async saveOAuthState(stateHash:string,tenantId:string,connectionId:string,expiresAt:string){ await this.pool.query('INSERT INTO sc_oauth_states(state_hash,tenant_id,connection_id,expires_at) VALUES($1,$2,$3,$4)',[stateHash,tenantId,connectionId,expiresAt]); }
  async consumeOAuthState(stateHash:string){ const client=await this.pool.connect(); try{ await client.query('BEGIN'); const q=await client.query(`SELECT * FROM sc_oauth_states WHERE state_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,[stateHash]); if(!q.rows[0]){await client.query('ROLLBACK');return null;} await client.query('UPDATE sc_oauth_states SET used_at=now() WHERE state_hash=$1',[stateHash]); await client.query('COMMIT'); return {tenantId:q.rows[0].tenant_id,connectionId:q.rows[0].connection_id}; } finally{client.release();} }
  async audit(tenantId:string,action:string,detail:unknown={},connectionId?:string,actor?:string){ await this.pool.query('INSERT INTO sc_audit_log(tenant_id,connection_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)',[tenantId,connectionId??null,actor??null,action,detail]); }
  async listActiveConnections(){ const q=await this.pool.query(`SELECT * FROM sc_connections WHERE status='active' ORDER BY updated_at DESC`); return q.rows.map(connectionFromRow); }
  async metrics(){ const [events,conflicts,connections]=await Promise.all([this.pool.query(`SELECT status,count(*)::int count FROM sc_sync_events GROUP BY status`),this.pool.query(`SELECT status,count(*)::int count FROM sc_conflicts GROUP BY status`),this.pool.query(`SELECT status,count(*)::int count FROM sc_connections GROUP BY status`)]); return {events:events.rows,conflicts:conflicts.rows,connections:connections.rows}; }
}
