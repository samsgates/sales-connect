#!/usr/bin/env node
import { SalesConnectClient } from '@sales-connect/sdk';
const [cmd,...args]=process.argv.slice(2);const baseUrl=process.env.SALES_CONNECT_URL??'http://localhost:4380';const tenantId=process.env.SALES_CONNECT_TENANT??'default';const apiKey=process.env.SALES_CONNECT_API_KEY??'';
if(!apiKey){console.error('Set SALES_CONNECT_API_KEY');process.exit(1);}const c=new SalesConnectClient({baseUrl,tenantId,apiKey});
const json=(x:unknown)=>console.log(JSON.stringify(x,null,2));
try{
  if(cmd==='connections')json(await c.connections.list());
  else if(cmd==='events')json(await c.events.list(args[0]));
  else if(cmd==='conflicts')json(await c.conflicts.list(args[0]));
  else if(cmd==='backfill'&&args[0]&&args[1])json(await c.sync.backfill(args[0],args[1] as any));
  else if(cmd==='reconcile'&&args[0]&&args[1])json(await c.sync.reconcile(args[0],args[1] as any));
  else {console.log(`sales-connect commands:\n  connections\n  events [connectionId]\n  conflicts [connectionId]\n  backfill <connectionId> <entity>\n  reconcile <connectionId> <entity>`);}
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exit(1);}
