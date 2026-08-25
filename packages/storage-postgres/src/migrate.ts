import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

const url=process.env.DATABASE_URL;
if(!url) throw new Error('DATABASE_URL is required');
const here=dirname(fileURLToPath(import.meta.url));
const sourceCandidates=[join(here,'schema.sql'),join(here,'../src/schema.sql')];
let sql='';
for(const file of sourceCandidates){ try{sql=await readFile(file,'utf8'); break;}catch{} }
if(!sql) throw new Error('schema.sql not found');
const pool=new Pool({connectionString:url});
try{ await pool.query(sql); console.log('Sales-Connect database migration complete'); } finally { await pool.end(); }
