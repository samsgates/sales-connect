import type { CRMProvider, CanonicalEntity, CanonicalRecord, Connection, EntitySyncConfig, FieldSchema, ListOptions, ObjectSchema, ProviderRequestContext, RecordMapping, RemoteRecord, SyncConflict, SyncEvent, TokenSet } from '@sales-connect/types';
import type { JobQueue, SyncStorage } from '@sales-connect/core';
import { genericDenormalize, genericNormalize } from '@sales-connect/provider-common';

export class MemoryQueue implements JobQueue {
  handlers=new Map<string,(payload:Record<string,unknown>)=>Promise<void>>();
  jobs:Array<{name:string;payload:Record<string,unknown>}>=[];
  async start(){} async stop(){}
  async publish(name:string,payload:Record<string,unknown>){this.jobs.push({name,payload});const h=this.handlers.get(name);if(h)await h(payload);return `job_${this.jobs.length}`;}
  async work(name:string,handler:(payload:Record<string,unknown>)=>Promise<void>){this.handlers.set(name,handler);}
}

export class MemoryStorage implements SyncStorage {
  connections=new Map<string,Connection>(); configs=new Map<string,Array<EntitySyncConfig&{version:number}>>(); events=new Map<string,SyncEvent>(); mappings:RecordMapping[]=[]; conflicts:SyncConflict[]=[]; checkpoints=new Map<string,Record<string,unknown>>(); locals=new Map<string,CanonicalRecord>(); fingerprints=new Set<string>();
  key(t:string,...p:string[]){return [t,...p].join(':')}
  async createConnection(c:Connection){this.connections.set(this.key(c.tenantId,c.id),structuredClone(c));}
  async getConnection(t:string,id:string){return structuredClone(this.connections.get(this.key(t,id))??null)}
  async updateConnection(t:string,id:string,p:Partial<Connection>){const c=await this.getConnection(t,id);if(!c)return;this.connections.set(this.key(t,id),{...c,...p});}
  async listConnections(t:string){return [...this.connections.values()].filter(c=>c.tenantId===t).map(x=>structuredClone(x));}
  async saveEntityConfig(t:string,c:string,config:EntitySyncConfig){const k=this.key(t,c,config.entity);const list=this.configs.get(k)??[];const version=list.length+1;list.push({...structuredClone(config),version});this.configs.set(k,list);return version;}
  async getEntityConfig(t:string,c:string,e:CanonicalEntity){const l=this.configs.get(this.key(t,c,e))??[];return structuredClone(l.at(-1)??null);}
  async listEntityConfigs(t:string,c:string){return [...this.configs.entries()].filter(([k])=>k.startsWith(`${t}:${c}:`)).map(([,v])=>structuredClone(v.at(-1)!));}
  async appendEvent(e:SyncEvent){const k=this.key(e.tenantId,e.id);if(this.events.has(k))return false;this.events.set(k,structuredClone(e));return true;}
  async getEvent(t:string,id:string){return structuredClone(this.events.get(this.key(t,id))??null)}
  async listEvents(t:string,c?:string,limit=100){return [...this.events.values()].filter(e=>e.tenantId===t&&(!c||e.connectionId===c)).slice(-limit).reverse().map(x=>structuredClone(x));}
  async updateEvent(t:string,id:string,p:Partial<SyncEvent>){const e=await this.getEvent(t,id);if(e)this.events.set(this.key(t,id),{...e,...p});}
  async getMappingByLocal(t:string,c:string,e:CanonicalEntity,l:string){return structuredClone(this.mappings.find(m=>m.tenantId===t&&m.connectionId===c&&m.entity===e&&m.localId===l)??null)}
  async getMappingByRemote(t:string,c:string,e:CanonicalEntity,r:string){return structuredClone(this.mappings.find(m=>m.tenantId===t&&m.connectionId===c&&m.entity===e&&m.remoteId===r)??null)}
  async upsertMapping(m:RecordMapping){const i=this.mappings.findIndex(x=>x.tenantId===m.tenantId&&x.connectionId===m.connectionId&&x.entity===m.entity&&x.localId===m.localId);if(i>=0)this.mappings[i]=structuredClone(m);else this.mappings.push(structuredClone(m));}
  async saveFingerprint(a:any){this.fingerprints.add(this.key(a.tenantId,a.connectionId,a.entity,a.remoteId,a.fingerprint));}
  async hasFingerprint(a:any){return this.fingerprints.has(this.key(a.tenantId,a.connectionId,a.entity,a.remoteId,a.fingerprint));}
  async saveConflict(c:SyncConflict){this.conflicts.push(structuredClone(c));}
  async listConflicts(t:string,c?:string,status?:string){return this.conflicts.filter(x=>x.tenantId===t&&(!c||x.connectionId===c)&&(!status||x.status===status)).map(x=>structuredClone(x));}
  async resolveConflict(t:string,id:string,status:SyncConflict['status']){const c=this.conflicts.find(x=>x.tenantId===t&&x.id===id);if(c)c.status=status;}
  async getCheckpoint(t:string,c:string,e:CanonicalEntity){return structuredClone(this.checkpoints.get(this.key(t,c,e))??null)}
  async saveCheckpoint(t:string,c:string,e:CanonicalEntity,cp:Record<string,unknown>){this.checkpoints.set(this.key(t,c,e),structuredClone(cp));}
  async upsertLocalRecord(t:string,r:CanonicalRecord){this.locals.set(this.key(t,r.entity,r.id),structuredClone(r));return structuredClone(r);}
  async getLocalRecord(t:string,e:CanonicalEntity,id:string){return structuredClone(this.locals.get(this.key(t,e,id))??null)}
  async listLocalRecords(t:string,e:CanonicalEntity,limit=100){return [...this.locals.values()].filter(r=>r.entity===e&&this.locals.has(this.key(t,e,r.id))).slice(0,limit).map(x=>structuredClone(x));}
  async deleteLocalRecord(t:string,e:CanonicalEntity,id:string,soft=true){const k=this.key(t,e,id);if(!soft)this.locals.delete(k);else{const r=this.locals.get(k);if(r)this.locals.set(k,{...r,deletedAt:new Date().toISOString()});}}
}

export class MockCRMProvider implements CRMProvider {
  id='mock'; records=new Map<string,Map<string,RemoteRecord>>();
  capabilities(){return {webhooks:true,cdc:false,upsert:true,externalIds:true,customObjects:true,batchWrite:true,bulkRead:true};}
  getAuthorizationUrl(){return 'https://mock.local/oauth'} async exchangeAuthorizationCode(){return {accessToken:'mock'} as TokenSet} async refreshToken(){return {accessToken:'mock'} as TokenSet}
  async discoverObjects(){return [...this.records.keys()].map(name=>({name,fields:[]} satisfies ObjectSchema));}
  async discoverFields(_ctx:ProviderRequestContext,object:string){const r=[...(this.records.get(object)?.values()??[])][0];return Object.keys(r?.fields??{}).map(name=>({name,type:'string',readable:true,writable:true} satisfies FieldSchema));}
  async getRecord(_ctx:ProviderRequestContext,object:string,id:string){const r=this.records.get(object)?.get(id);if(!r)throw Object.assign(new Error('not found'),{status:404});return structuredClone(r);}
  async listRecords(_ctx:ProviderRequestContext,object:string,_o:ListOptions={}){return {records:[...(this.records.get(object)?.values()??[])].map(x=>structuredClone(x))};}
  async createRecord(_ctx:ProviderRequestContext,object:string,data:Record<string,unknown>){const id=`remote_${Math.random().toString(36).slice(2)}`;const r={id,object,fields:structuredClone(data),updatedAt:new Date().toISOString()};if(!this.records.has(object))this.records.set(object,new Map());this.records.get(object)!.set(id,r);return structuredClone(r);}
  async updateRecord(_ctx:ProviderRequestContext,object:string,id:string,data:Record<string,unknown>){const current=await this.getRecord(_ctx,object,id);const r={...current,fields:{...current.fields,...structuredClone(data)},updatedAt:new Date().toISOString()};this.records.get(object)!.set(id,r);return structuredClone(r);}
  async upsertRecord(ctx:ProviderRequestContext,object:string,key:{field:string;value:string},data:Record<string,unknown>){const hit=[...(this.records.get(object)?.values()??[])].find(r=>r.fields[key.field]===key.value);return hit?this.updateRecord(ctx,object,hit.id,data):this.createRecord(ctx,object,{...data,[key.field]:key.value});}
  async deleteRecord(_ctx:ProviderRequestContext,object:string,id:string){this.records.get(object)?.delete(id);}
  normalize(object:string,remote:RemoteRecord,mapping:EntitySyncConfig){return genericNormalize(object,remote,mapping)} denormalize(object:string,c:CanonicalRecord,m:EntitySyncConfig){return genericDenormalize(object,c,m)}
}
