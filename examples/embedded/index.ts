import { SalesConnectEngine, StorageApplicationAdapter } from '@sales-connect/core';
import { PostgresStorage } from '@sales-connect/storage-postgres';
import { PostgresQueue } from '@sales-connect/queue-postgres';
import { HubSpotProvider } from '@sales-connect/provider-hubspot';

const storage = new PostgresStorage(process.env.DATABASE_URL!);
const queue = new PostgresQueue(process.env.DATABASE_URL!);
const engine = new SalesConnectEngine({
  storage,
  queue,
  providers: [new HubSpotProvider()],
  application: new StorageApplicationAdapter(storage),
  masterKey: process.env.SALES_CONNECT_MASTER_KEY!,
  oauth: {
    hubspot: {
      clientId: process.env.HUBSPOT_CLIENT_ID!,
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET!,
      redirectUri: 'http://localhost:4000/oauth/callback'
    }
  }
});

await queue.start();
await queue.work('sync.event', job => engine.processEvent(String(job.tenantId), String(job.eventId)));
console.log('Embedded Sales-Connect engine is ready');
