import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { z } from 'zod';
import { SalesConnectEngine, StorageApplicationAdapter, sha256, signHmac } from '@sales-connect/core';
import { PostgresStorage } from '@sales-connect/storage-postgres';
import { PostgresQueue } from '@sales-connect/queue-postgres';
import { SalesforceProvider } from '@sales-connect/provider-salesforce';
import { HubSpotProvider } from '@sales-connect/provider-hubspot';
import { ZohoProvider } from '@sales-connect/provider-zoho';
import type { CanonicalEntity, EntitySyncConfig } from '@sales-connect/types';

const env=z.object({
  NODE_ENV:z.string().default('development'),PORT:z.coerce.number().default(4380),DATABASE_URL:z.string().min(1),SALES_CONNECT_ADMIN_API_KEY:z.string().min(12),
  SALES_CONNECT_MASTER_KEY:z.string().regex(/^[0-9a-fA-F]{64}$/),PUBLIC_BASE_URL:z.string().url(),DASHBOARD_URL:z.string().default('http://localhost:3000'),
  SALESFORCE_CLIENT_ID:z.string().default(''),SALESFORCE_CLIENT_SECRET:z.string().default(''),SALESFORCE_LOGIN_URL:z.string().default('https://login.salesforce.com'),SALESFORCE_API_VERSION:z.string().default('v64.0'),
  HUBSPOT_CLIENT_ID:z.string().default(''),HUBSPOT_CLIENT_SECRET:z.string().default(''),HUBSPOT_SCOPES:z.string().default(''),
  ZOHO_CLIENT_ID:z.string().default(''),ZOHO_CLIENT_SECRET:z.string().default(''),ZOHO_ACCOUNTS_URL:z.string().default('https://accounts.zoho.com'),ZOHO_API_DOMAIN:z.string().default('https://www.zohoapis.com'),ZOHO_SCOPES:z.string().default(''),
  RECONCILE_INTERVAL_MS:z.coerce.number().default(900000),WEBHOOK_TARGET_URL:z.string().default(''),WEBHOOK_SIGNING_SECRET:z.string().default('')
}).parse(process.env);

const app=Fastify({logger:{level:env.NODE_ENV==='development'?'debug':'info'},trustProxy:true,bodyLimit:2*1024*1024});
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json',{parseAs:'string'},(req,body,done)=>{ try{(req as any).rawBody=String(body);done(null,body?JSON.parse(String(body)):{});}catch(e){done(e as Error,undefined);} });

const storage=new PostgresStorage(env.DATABASE_URL);
const queue=new PostgresQueue(env.DATABASE_URL);
const salesforce=new SalesforceProvider({loginUrl:env.SALESFORCE_LOGIN_URL,apiVersion:env.SALESFORCE_API_VERSION});
const hubspot=new HubSpotProvider();
const zoho=new ZohoProvider({accountsUrl:env.ZOHO_ACCOUNTS_URL,apiDomain:env.ZOHO_API_DOMAIN});
const providers=[salesforce,hubspot,zoho];

const registry=new Registry(); collectDefaultMetrics({register:registry,prefix:'sales_connect_'});
const processed=new Counter({name:'sales_connect_sync_events_total',help:'Sync event outcomes',labelNames:['status','provider','entity'],registers:[registry]});
const latency=new Histogram({name:'sales_connect_sync_event_duration_seconds',help:'Sync event processing duration',labelNames:['provider'],registers:[registry]});
const connGauge=new Gauge({name:'sales_connect_connections',help:'Connections by status',labelNames:['status'],registers:[registry]});

const engine=new SalesConnectEngine({
  storage,queue,providers,application:new StorageApplicationAdapter(storage),masterKey:env.SALES_CONNECT_MASTER_KEY,
  oauth:{
    salesforce:{clientId:env.SALESFORCE_CLIENT_ID,clientSecret:env.SALESFORCE_CLIENT_SECRET,redirectUri:`${env.PUBLIC_BASE_URL}/v1/oauth/salesforce/callback`},
    hubspot:{clientId:env.HUBSPOT_CLIENT_ID,clientSecret:env.HUBSPOT_CLIENT_SECRET,redirectUri:`${env.PUBLIC_BASE_URL}/v1/oauth/hubspot/callback`},
    zoho:{clientId:env.ZOHO_CLIENT_ID,clientSecret:env.ZOHO_CLIENT_SECRET,redirectUri:`${env.PUBLIC_BASE_URL}/v1/oauth/zoho/callback`}
  },
  onEvent:async evt=>{
    const data=evt.data as any;
    if(evt.type.startsWith('sync.event.')) processed.inc({status:evt.type.split('.').at(-1)??'unknown',provider:String(data?.provider??'unknown'),entity:String(data?.entity??'unknown')});
    if(env.WEBHOOK_TARGET_URL&&env.WEBHOOK_SIGNING_SECRET){
      await queue.publish('delivery.webhook',{event:evt},{singletonKey:`delivery:${evt.type}:${evt.tenantId}:${evt.connectionId}:${String(data?.eventId??Date.now())}`,retryLimit:7});
    }
  }
});

function publicConnection(c:any){
  const config=Object.fromEntries(Object.entries(c.config??{}).filter(([k])=>!/(secret|token|password|key)/i.test(k)));
  return {...c,config,credentialsEncrypted:c.credentialsEncrypted?'<encrypted>':null};
}
function tenant(req:any){return String(req.headers['x-sales-connect-tenant']??'');}
function requireTenant(req:any){const t=tenant(req);if(!t)throw Object.assign(new Error('x-sales-connect-tenant is required'),{statusCode:400});return t;}
function providerScopes(id:string){ if(id==='salesforce')return ['api','refresh_token'];if(id==='hubspot')return env.HUBSPOT_SCOPES.split(/\s+/).filter(Boolean);if(id==='zoho')return env.ZOHO_SCOPES.split(',').map(x=>x.trim()).filter(Boolean);return []; }

app.addHook('onRequest',async req=>{
  const url=req.url;
  if(url==='/health'||url==='/ready'||url==='/metrics'||url.startsWith('/v1/oauth/')||url.startsWith('/v1/webhooks/'))return;
  if(!url.startsWith('/v1/'))return;
  if(req.headers['x-sales-connect-key']!==env.SALES_CONNECT_ADMIN_API_KEY)throw Object.assign(new Error('Unauthorized'),{statusCode:401});
  requireTenant(req);
});

app.setErrorHandler((error,req,reply)=>{ const status=(error as any).statusCode??500;if(status>=500)req.log.error({err:error},'request failed');reply.code(status).send({message:error.message,requestId:req.id}); });

app.get('/health',async()=>({status:'healthy',time:new Date().toISOString()}));
app.get('/ready',async(_req,reply)=>{try{await storage.pool.query('SELECT 1');return {status:'ready'};}catch(e){reply.code(503);return {status:'not_ready'};}});
app.get('/metrics',async(_req,reply)=>{const m=await storage.metrics();for(const s of ['connecting','discovering','backfilling','catching_up','active','degraded','paused','error','disconnected'])connGauge.set({status:s},0);for(const r of m.connections)connGauge.set({status:r.status},Number(r.count));reply.header('content-type',registry.contentType);return registry.metrics();});

app.post('/v1/connections',async(req:any,reply)=>{
  const body=z.object({provider:z.enum(['salesforce','hubspot','zoho']),name:z.string().optional(),config:z.record(z.unknown()).optional()}).parse(req.body);
  const webhookSecret=randomBytes(24).toString('base64url');
  const c=await engine.createConnection({tenantId:requireTenant(req),provider:body.provider,name:body.name,config:{...(body.config??{}),webhookSecret}});
  await storage.audit(c.tenantId,'connection.created',{provider:c.provider},c.id,'api'); reply.code(201);return {...c,webhookSecret};
});
app.get('/v1/connections',async(req:any)=>({connections:(await storage.listConnections(requireTenant(req))).map(publicConnection)}));
app.get('/v1/connections/:id',async(req:any,reply)=>{const c=await storage.getConnection(requireTenant(req),req.params.id);if(!c){reply.code(404);return {message:'Connection not found'};}return publicConnection(c);});
app.post('/v1/connections/:id/authorize',async(req:any)=>{const t=requireTenant(req);const c=await storage.getConnection(t,req.params.id);if(!c)throw Object.assign(new Error('Connection not found'),{statusCode:404});const state=randomBytes(32).toString('base64url');await storage.saveOAuthState(sha256(state),t,c.id,new Date(Date.now()+10*60_000).toISOString());return {url:engine.authorizationUrl(c,state,providerScopes(c.provider))};});
app.get('/v1/oauth/:provider/callback',async(req:any,reply)=>{const q=z.object({code:z.string(),state:z.string(),location:z.string().optional(),'accounts-server':z.string().optional()}).parse(req.query);const st=await storage.consumeOAuthState(sha256(q.state));if(!st)throw Object.assign(new Error('Invalid or expired OAuth state'),{statusCode:400});const c=await storage.getConnection(st.tenantId,st.connectionId);if(!c||c.provider!==req.params.provider)throw Object.assign(new Error('OAuth provider mismatch'),{statusCode:400});const zohoAccounts=q['accounts-server']?.startsWith('https://')?q['accounts-server']:(q.location?({us:'https://accounts.zoho.com',eu:'https://accounts.zoho.eu',in:'https://accounts.zoho.in',au:'https://accounts.zoho.com.au',jp:'https://accounts.zoho.jp',cn:'https://accounts.zoho.com.cn',ca:'https://accounts.zohocloud.ca'} as Record<string,string>)[q.location.toLowerCase()]:undefined);const extra=req.params.provider==='zoho'&&zohoAccounts?{accountsUrl:zohoAccounts}:{ };await engine.completeOAuth(c,q.code,extra);await storage.audit(c.tenantId,'connection.oauth.completed',{},c.id,'oauth');reply.redirect(`${env.DASHBOARD_URL}/?connected=${encodeURIComponent(c.id)}`);});
app.post('/v1/connections/:id/pause',async(req:any)=>{const t=requireTenant(req);await storage.updateConnection(t,req.params.id,{status:'paused',updatedAt:new Date().toISOString()});await storage.audit(t,'sync.paused',{},req.params.id,'api');return {status:'paused'};});
app.post('/v1/connections/:id/resume',async(req:any)=>{const t=requireTenant(req);await storage.updateConnection(t,req.params.id,{status:'active',updatedAt:new Date().toISOString()});await storage.audit(t,'sync.resumed',{},req.params.id,'api');return {status:'active'};});
app.delete('/v1/connections/:id',async(req:any)=>{const t=requireTenant(req);await storage.updateConnection(t,req.params.id,{status:'disconnected',credentialsEncrypted:null,updatedAt:new Date().toISOString()});await storage.audit(t,'connection.disconnected',{},req.params.id,'api');return {status:'disconnected'};});

app.get('/v1/connections/:id/schema',async(req:any)=>{const t=requireTenant(req);const c=await storage.getConnection(t,req.params.id);if(!c)throw Object.assign(new Error('Connection not found'),{statusCode:404});return {objects:await engine.provider(c.provider).discoverObjects(await engine.providerContext(c))};});
app.get('/v1/connections/:id/schema/:object',async(req:any)=>{const t=requireTenant(req);const c=await storage.getConnection(t,req.params.id);if(!c)throw Object.assign(new Error('Connection not found'),{statusCode:404});return {fields:await engine.provider(c.provider).discoverFields(await engine.providerContext(c),req.params.object)};});
app.get('/v1/connections/:id/mappings',async(req:any)=>({mappings:await storage.listEntityConfigs(requireTenant(req),req.params.id)}));
app.post('/v1/connections/:id/mappings',async(req:any)=>{const config=z.object({entity:z.string(),remoteObject:z.string().optional(),direction:z.enum(['remote_to_local','local_to_remote','bidirectional','disabled']),mappings:z.array(z.object({local:z.string(),remote:z.string(),direction:z.enum(['remote_to_local','local_to_remote','bidirectional','disabled']).optional(),owner:z.enum(['local','remote','shared']).optional(),required:z.boolean().optional()})),conflictStrategy:z.enum(['remote_wins','local_wins','latest_wins','field_owner','manual','custom']).optional(),externalIdField:z.string().optional(),deletePolicy:z.object({remoteToLocal:z.enum(['ignore','soft_delete','hard_delete','archive','manual']),localToRemote:z.enum(['ignore','soft_delete','hard_delete','archive','manual'])}).optional()}).parse(req.body) as EntitySyncConfig;const version=await engine.saveEntityConfig(requireTenant(req),req.params.id,config);await storage.audit(requireTenant(req),'mapping.updated',{entity:config.entity,version},req.params.id,'api');return {version};});

app.get('/v1/connections/:id/records/:entity',async(req:any)=>({records:await storage.listLocalRecords(requireTenant(req),req.params.entity as CanonicalEntity,500)}));
app.post('/v1/connections/:id/records/:entity',async(req:any,reply)=>{const body=z.object({id:z.string().optional(),fields:z.record(z.unknown()).default({}),customFields:z.record(z.unknown()).optional(),createdAt:z.string().optional(),updatedAt:z.string().optional()}).parse(req.body);const rec=await engine.localUpsert({tenantId:requireTenant(req),connectionId:req.params.id,entity:req.params.entity,record:{...body,id:body.id??`local_${randomUUID().replaceAll('-','')}`,entity:req.params.entity}});reply.code(202);return rec;});
app.delete('/v1/connections/:id/records/:entity/:recordId',async(req:any,reply)=>{await engine.localDelete({tenantId:requireTenant(req),connectionId:req.params.id,entity:req.params.entity,localId:req.params.recordId});reply.code(202);return {status:'accepted'};});

app.post('/v1/connections/:id/sync/:entity/backfill',async(req:any,reply)=>{const t=requireTenant(req);await queue.publish('sync.backfill',{tenantId:t,connectionId:req.params.id,entity:req.params.entity},{singletonKey:`backfill:${t}:${req.params.id}:${req.params.entity}`,retryLimit:3});reply.code(202);return {status:'accepted'};});
app.post('/v1/connections/:id/sync/:entity/reconcile',async(req:any,reply)=>{const t=requireTenant(req);await queue.publish('sync.reconcile',{tenantId:t,connectionId:req.params.id,entity:req.params.entity},{singletonKey:`reconcile:${t}:${req.params.id}:${req.params.entity}`,retryLimit:3});reply.code(202);return {status:'accepted'};});

app.get('/v1/events',async(req:any)=>({events:await storage.listEvents(requireTenant(req),req.query?.connectionId,Number(req.query?.limit??100))}));
app.post('/v1/events/:id/replay',async(req:any,reply)=>{const t=requireTenant(req);const e=await storage.getEvent(t,req.params.id);if(!e)throw Object.assign(new Error('Event not found'),{statusCode:404});await storage.updateEvent(t,e.id,{status:'pending',attempt:0,error:null});await queue.publish('sync.event',{tenantId:t,eventId:e.id},{retryLimit:7});await storage.audit(t,'event.replayed',{eventId:e.id},e.connectionId,'api');reply.code(202);return {status:'accepted'};});
app.get('/v1/conflicts',async(req:any)=>({conflicts:await storage.listConflicts(requireTenant(req),req.query?.connectionId,req.query?.status??'open')}));
app.post('/v1/conflicts/:id/resolve',async(req:any)=>{const t=requireTenant(req);const body=z.object({choice:z.enum(['local','remote','ignore'])}).parse(req.body);const c=await storage.getConflict(t,req.params.id);if(!c)throw Object.assign(new Error('Conflict not found'),{statusCode:404});if(body.choice==='local'&&c.localId){const rec=await storage.getLocalRecord(t,c.entity,c.localId);if(rec)await engine.localUpsert({tenantId:t,connectionId:c.connectionId,entity:c.entity,record:rec});await storage.resolveConflict(t,c.id,'resolved_local');}else if(body.choice==='remote'&&c.remoteId){await engine.ingestRemoteEvent({tenantId:t,connectionId:c.connectionId,entity:c.entity,remoteId:c.remoteId,operation:'update',providerEventId:`manual-resolution:${c.id}:${Date.now()}`});await storage.resolveConflict(t,c.id,'resolved_remote');}else await storage.resolveConflict(t,c.id,'ignored');await storage.audit(t,'conflict.resolved',{conflictId:c.id,choice:body.choice},c.connectionId,'api');return {status:'resolved'};});

app.post('/v1/webhooks/:tenantId/:connectionId/:provider',async(req:any,reply)=>{
  const {tenantId,connectionId,provider:providerId}=req.params;const c=await storage.getConnection(tenantId,connectionId);if(!c||c.provider!==providerId){reply.code(404);return {message:'Connection not found'};}
  const provider=engine.provider(providerId);const rawBody=(req as any).rawBody??JSON.stringify(req.body??{});const headers=req.headers as Record<string,string|string[]|undefined>;
  if(providerId==='hubspot'){
    if(!provider.verifyWebhook?.({headers,method:req.method,url:`${env.PUBLIC_BASE_URL}${req.raw.url}`,rawBody,secret:env.HUBSPOT_CLIENT_SECRET})){reply.code(401);return {message:'Invalid HubSpot signature'};}
  }else{
    const supplied=String(headers['x-sales-connect-webhook-secret']??req.query?.secret??'');if(supplied!==String(c.config.webhookSecret??'')){reply.code(401);return {message:'Invalid webhook secret'};}
  }
  const configs=await storage.listEntityConfigs(tenantId,connectionId);let events:any[]=[];
  if(provider.parseWebhook)events=await provider.parseWebhook(req.body,headers);
  else {const b=req.body as any;events=[{id:String(b.eventId??randomUUID()),object:String(b.object),remoteId:String(b.recordId),operation:b.operation??'update',payload:b}];}
  let accepted=0;
  for(const e of events){const cfg=configs.find(x=>(x.remoteObject??'').toLowerCase()===String(e.object).toLowerCase());if(!cfg)continue;await engine.ingestRemoteEvent({tenantId,connectionId,entity:cfg.entity,remoteId:e.remoteId,operation:e.operation,payload:e.payload,providerEventId:e.id});accepted++;}
  reply.code(202);return {accepted};
});

await queue.start();
await queue.work('sync.event',async data=>{const end=latency.startTimer({provider:'unknown'});try{await engine.processEvent(String(data.tenantId),String(data.eventId));}finally{end();}});
await queue.work('sync.backfill',async d=>{await engine.backfill(String(d.tenantId),String(d.connectionId),String(d.entity) as CanonicalEntity);});
await queue.work('sync.reconcile',async d=>{await engine.reconcile(String(d.tenantId),String(d.connectionId),String(d.entity) as CanonicalEntity);});
await queue.work('delivery.webhook',async d=>{if(!env.WEBHOOK_TARGET_URL||!env.WEBHOOK_SIGNING_SECRET)return;const body=JSON.stringify(d.event);const ts=String(Date.now());const sig=signHmac(env.WEBHOOK_SIGNING_SECRET,`${ts}.${body}`);const res=await fetch(env.WEBHOOK_TARGET_URL,{method:'POST',headers:{'content-type':'application/json','x-salesconnect-timestamp':ts,'x-salesconnect-signature':sig},body});if(!res.ok)throw new Error(`Outbound webhook failed ${res.status}: ${await res.text()}`);});

const timer=setInterval(async()=>{try{const active=await storage.listActiveConnections();for(const c of active){const configs=await storage.listEntityConfigs(c.tenantId,c.id);for(const cfg of configs){await queue.publish('sync.reconcile',{tenantId:c.tenantId,connectionId:c.id,entity:cfg.entity},{singletonKey:`scheduled:${c.tenantId}:${c.id}:${cfg.entity}`,retryLimit:3});}}}catch(error){app.log.error({error},'scheduled reconciliation failed');}},env.RECONCILE_INTERVAL_MS);timer.unref();

const shutdown=async(signal:string)=>{app.log.info({signal},'shutting down');clearInterval(timer);await app.close();await queue.stop();await storage.close();process.exit(0);};process.on('SIGTERM',()=>void shutdown('SIGTERM'));process.on('SIGINT',()=>void shutdown('SIGINT'));
await app.listen({host:'0.0.0.0',port:env.PORT});
