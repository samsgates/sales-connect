import type { CanonicalEntity, CanonicalRecord, Connection, EntitySyncConfig, SyncConflict, SyncEvent } from '@sales-connect/types';

export interface SalesConnectClientOptions { baseUrl:string; tenantId:string; apiKey:string; fetch?:typeof fetch }
export class SalesConnectClient {
  private f:typeof fetch;
  constructor(private readonly options:SalesConnectClientOptions){this.f=options.fetch??fetch;}
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const res=await this.f(`${this.options.baseUrl.replace(/\/$/,'')}${path}`,{...init,headers:{'content-type':'application/json','x-sales-connect-key':this.options.apiKey,'x-sales-connect-tenant':this.options.tenantId,...(init.headers??{})}});
    const text=await res.text(); const body=text?JSON.parse(text):null; if(!res.ok)throw new Error(body?.message??`Sales-Connect request failed ${res.status}`); return body as T;
  }
  connections={
    list:()=>this.request<{connections:Connection[]}>('/v1/connections'),
    create:(provider:string,name?:string)=>this.request<Connection>('/v1/connections',{method:'POST',body:JSON.stringify({provider,name})}),
    authorize:(id:string)=>this.request<{url:string}>(`/v1/connections/${id}/authorize`,{method:'POST'}),
    pause:(id:string)=>this.request(`/v1/connections/${id}/pause`,{method:'POST'}),
    resume:(id:string)=>this.request(`/v1/connections/${id}/resume`,{method:'POST'})
  };
  mappings={
    save:(connectionId:string,config:EntitySyncConfig)=>this.request<{version:number}>(`/v1/connections/${connectionId}/mappings`,{method:'POST',body:JSON.stringify(config)}),
    list:(connectionId:string)=>this.request<{mappings:Array<EntitySyncConfig&{version:number}>}>(`/v1/connections/${connectionId}/mappings`)
  };
  records={
    list:(connectionId:string,entity:CanonicalEntity)=>this.request<{records:CanonicalRecord[]}>(`/v1/connections/${connectionId}/records/${entity}`),
    upsert:(connectionId:string,entity:CanonicalEntity,record:Omit<CanonicalRecord,'entity'>)=>this.request<CanonicalRecord>(`/v1/connections/${connectionId}/records/${entity}`,{method:'POST',body:JSON.stringify(record)}),
    delete:(connectionId:string,entity:CanonicalEntity,id:string)=>this.request(`/v1/connections/${connectionId}/records/${entity}/${encodeURIComponent(id)}`,{method:'DELETE'})
  };
  sync={
    backfill:(connectionId:string,entity:CanonicalEntity)=>this.request(`/v1/connections/${connectionId}/sync/${entity}/backfill`,{method:'POST'}),
    reconcile:(connectionId:string,entity:CanonicalEntity)=>this.request(`/v1/connections/${connectionId}/sync/${entity}/reconcile`,{method:'POST'})
  };
  events={list:(connectionId?:string)=>this.request<{events:SyncEvent[]}>(`/v1/events${connectionId?`?connectionId=${encodeURIComponent(connectionId)}`:''}`),replay:(id:string)=>this.request(`/v1/events/${id}/replay`,{method:'POST'})};
  conflicts={list:(connectionId?:string)=>this.request<{conflicts:SyncConflict[]}>(`/v1/conflicts${connectionId?`?connectionId=${encodeURIComponent(connectionId)}`:''}`),resolve:(id:string,choice:'local'|'remote'|'ignore')=>this.request(`/v1/conflicts/${id}/resolve`,{method:'POST',body:JSON.stringify({choice})})};
}
