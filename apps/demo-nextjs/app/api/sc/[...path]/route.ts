import { NextRequest, NextResponse } from 'next/server';
const base=process.env.SALES_CONNECT_URL??'http://localhost:4380';
const key=process.env.SALES_CONNECT_API_KEY??'';
const tenant=process.env.SALES_CONNECT_TENANT??'demo';
async function proxy(req:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const {path}=await params; const url=new URL(`/v1/${path.join('/')}`,base); req.nextUrl.searchParams.forEach((v,k)=>url.searchParams.set(k,v));
  const init:RequestInit={method:req.method,headers:{'content-type':'application/json','x-sales-connect-key':key,'x-sales-connect-tenant':tenant},cache:'no-store'};
  if(!['GET','HEAD'].includes(req.method))init.body=await req.text();
  const res=await fetch(url,init); const body=await res.text(); return new NextResponse(body,{status:res.status,headers:{'content-type':res.headers.get('content-type')??'application/json'}});
}
export const GET=proxy;export const POST=proxy;export const DELETE=proxy;export const PATCH=proxy;
