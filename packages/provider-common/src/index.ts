import type { CanonicalRecord, EntitySyncConfig, RemoteRecord } from '@sales-connect/types';
import { toCanonicalFields, toRemoteData } from '@sales-connect/core';

export async function genericNormalize(object:string, remote:RemoteRecord, mapping:EntitySyncConfig):Promise<CanonicalRecord>{
  const {fields,customFields}=toCanonicalFields(remote.fields,mapping.mappings,mapping.direction);
  return { id:remote.id, entity:mapping.entity, fields, customFields, createdAt:remote.createdAt, updatedAt:remote.updatedAt,
    metadata:{provider:undefined,remoteId:remote.id,remoteCreatedAt:remote.createdAt,remoteUpdatedAt:remote.updatedAt,raw:remote.raw} };
}
export async function genericDenormalize(_object:string, record:CanonicalRecord, mapping:EntitySyncConfig){ return toRemoteData(record,mapping); }
export function assertIdentifier(value:string){ if(!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) throw new Error(`Unsafe CRM identifier: ${value}`); return value; }
export async function fetchJson<T>(url:string,init:RequestInit={}):Promise<T>{
  const res=await fetch(url,init); const text=await res.text(); let body:any=null; try{body=text?JSON.parse(text):null}catch{body=text;}
  if(!res.ok){ const err=new Error(`CRM request failed ${res.status} ${res.statusText}: ${typeof body==='string'?body:JSON.stringify(body)}`) as Error & {status?:number;body?:unknown}; err.status=res.status;err.body=body;throw err; }
  return body as T;
}
