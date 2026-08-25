import PgBoss from 'pg-boss';
import type { JobQueue } from '@sales-connect/core';

export class PostgresQueue implements JobQueue {
  private readonly boss: PgBoss;
  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString, schema: 'sales_connect_jobs', retryLimit: 7, retryDelay: 5, retryBackoff: true, expireInMinutes: 15 });
  }
  async start(){ await this.boss.start(); }
  async stop(){ await this.boss.stop({ graceful: true, timeout: 30_000 }); }
  async publish(name:string,payload:Record<string,unknown>,options?:{singletonKey?:string;retryLimit?:number}){
    const opts:any={retryLimit:options?.retryLimit??7,retryDelay:5,retryBackoff:true};
    if(options?.singletonKey) opts.singletonKey=options.singletonKey;
    return await this.boss.send(name,payload,opts) as string|null;
  }
  async work(name:string,handler:(payload:Record<string,unknown>)=>Promise<void>){
    await this.boss.work(name,{ batchSize: 1 },async (jobs:any[])=>{ for(const job of jobs) await handler(job.data as Record<string,unknown>); });
  }
}
