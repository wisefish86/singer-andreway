import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const SITE = "https://singer.andreway.ru";
const ORIGINS = new Set([SITE, "http://localhost:4321", "http://127.0.0.1:4321"]);
const encoder = new TextEncoder();
const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))).map(x => x.toString(16).padStart(2,"0")).join("");
const json = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), {
 status, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store",
 "access-control-allow-origin":origin,"access-control-allow-methods":"GET,POST,OPTIONS",
 "access-control-allow-headers":"content-type,authorization","vary":"Origin"}
});
type Song={id:string;name:string;artist:string};
let songCache: {until:number;songs:Song[]} | null = null;
async function finalists():Promise<Song[]>{
 if(songCache && songCache.until > Date.now())return songCache.songs;
 const response = await fetch(SITE + "/data/repertoire.public.json", {signal:AbortSignal.timeout(8000),cache:"no-store"});
 if(!response.ok) throw new Error("catalogue_unavailable");
 const data=await response.json();
 if(!Array.isArray(data.songs))throw new Error("catalogue_invalid");
 const songs:Song[]=[];
 for(const song of data.songs){
  if(!/^[a-f0-9]{16}$/.test(String(song.id))||!Array.isArray(song.playlist_variants))continue;
  const eligible = song.playlist_variants.some((variant:{relative_path?:string}) => {
   const name=String(variant?.relative_path||"").split(/[\\/]/).pop()||"";
   return name.includes("@");
  });
  if(eligible)songs.push({id:song.id,name:String(song.name||""),artist:String(song.artist||"")});
 }
 songs.sort((a,b)=>(a.artist+" "+a.name).localeCompare(b.artist+" "+b.name,"ru"));
 songCache={until:Date.now()+120000,songs};
 return songs;
}
function dbClient(){
 return createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
}
// Public calendar exposes only !В (open) performances, never private event details.
// The existing guest-mode endpoint adds 2h; voting is open until just 1h after the show.
const CALENDAR = "https://script.google.com/macros/s/AKfycbzCtHUBRaC3c_Tovx6We58tVElMRn1w6FUkcLCdNZAVhDyLnVj8hut-_gKTXgov086tlg/exec?kind=guest-mode";
let calendarCache: {until:number;windows:{start:string;end:string}[]} | null = null;
async function currentPublicWindows(){
 if(calendarCache && calendarCache.until>Date.now())return calendarCache.windows;
 const response=await fetch(CALENDAR,{signal:AbortSignal.timeout(8000),cache:"no-store"});
 if(!response.ok)throw new Error("calendar_unavailable");
 const data=await response.json();
 const windows=Array.isArray(data.windows)?data.windows.flatMap((w:{start:string;end:string})=>{
  const start=Date.parse(w.start), originalEnd=Date.parse(w.end);
  const end=originalEnd-3600000;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>12*3600000)return [];
  return [{start:new Date(start).toISOString(),end:new Date(end).toISOString()}];
 }):[];
 calendarCache={until:Date.now()+60000,windows};
 return windows;
}
async function ensureCalendarSessions(db:any){
 try{
  const windows=(await currentPublicWindows()).filter(w=>Date.parse(w.start)<=Date.now() && Date.parse(w.end)>Date.now());
  for(const window of windows){
   const {error}=await db.from("singer_vote_sessions").upsert({
    title:"Голосование вечера", starts_at:window.start,ends_at:window.end,
    enabled:true, source_key:"calendar:"+window.start
   },{onConflict:"source_key",ignoreDuplicates:true});
   if(error)throw error;
  }
 }catch(e){
  // Calendar outages never open unexpected events; manually opened sessions still work.
  console.warn("Public calendar unavailable",e instanceof Error?e.message:"unknown");
 }
}
async function authorized(req:Request,db:any):Promise<boolean>{
 const supplied=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
 if(supplied.length<32||supplied.length>256)return false;
 const {data,error}=await db.from("singer_vote_admin").select("token_hash").eq("id",1).maybeSingle();
 if(error||!data?.token_hash)return false;
 const actual=await sha(supplied),expected=String(data.token_hash);
 if(actual.length!==expected.length)return false;
 let mismatch=0;for(let i=0;i<actual.length;i++)mismatch|=actual.charCodeAt(i)^expected.charCodeAt(i);
 return mismatch===0;
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(!ORIGINS.has(origin))return new Response("Forbidden",{status:403});
 if(req.method==="OPTIONS")return json({},200,origin);
 try{
  const db=dbClient();
  if(req.method==="GET"){
   await ensureCalendarSessions(db);
   const {data,error}=await db.from("singer_vote_sessions").select("id,starts_at,ends_at")
    .eq("enabled",true).lte("starts_at",new Date().toISOString()).gt("ends_at",new Date().toISOString())
    .order("starts_at",{ascending:false}).limit(1).maybeSingle();
   if(error)throw error;
   if(!data)return json({active:false},200,origin);
   return json({active:true,session:{id:data.id,ends_at:data.ends_at},songs:await finalists()},200,origin);
  }
  if(req.method!=="POST")return json({error:"method_not_allowed"},405,origin);
  if(Number(req.headers.get("content-length")||0)>5000)return json({error:"too_large"},413,origin);
  const payload=await req.json();
  if(payload?.action==="admin"){
   if(!(await authorized(req,db)))return json({error:"unauthorized"},401,origin);
   const op=payload.operation;
   if(op==="status"){
    const {data,error}=await db.from("singer_vote_sessions").select("id,starts_at,ends_at,enabled,created_at")
     .order("created_at",{ascending:false}).limit(1);
    if(error)throw error;
    const latest=data?.[0]||null;
    if(!latest)return json({session:null,results:[]},200,origin);
    const {data:ballots,error:ballotError}=await db.from("singer_vote_ballots").select("song_ids").eq("session_id",latest.id);
    if(ballotError)throw ballotError;
    const counts=new Map<string,number>();
    for(const b of ballots||[])for(const id of b.song_ids)counts.set(id,(counts.get(id)||0)+1);
    return json({session:latest,ballots:ballots?.length||0,results:[...counts].map(([id,votes])=>({id,votes})).sort((a,b)=>b.votes-a.votes)},200,origin);
   }
   if(op==="close"){
    if(typeof payload.id!=="string")return json({error:"invalid_id"},400,origin);
    const {error}=await db.from("singer_vote_sessions").update({enabled:false}).eq("id",payload.id);
    if(error)throw error;
    return json({ok:true},200,origin);
   }
   if(op==="open"){
    const start=Date.parse(payload.starts_at),end=Date.parse(payload.ends_at);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>12*3600000||
       end<Date.now()||start>Date.now()+60*86400000)return json({error:"invalid_schedule"},400,origin);
    if((await finalists()).length<3)return json({error:"not_enough_finalists"},409,origin);
    // Disable previous sessions before creating the new one; interrupted operation leaves voting CLOSED.
    const {error:closeError}=await db.from("singer_vote_sessions").update({enabled:false}).eq("enabled",true);
    if(closeError)throw closeError;
    const {data,error}=await db.from("singer_vote_sessions").insert({
     title:"Голосование вечера",starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),enabled:true
    }).select("id,starts_at,ends_at").single();
    if(error)throw error;
    return json({ok:true,session:data},200,origin);
   }
   return json({error:"invalid_operation"},400,origin);
  }
  if(payload?.action!=="vote")return json({error:"invalid_action"},400,origin);
  const id=String(payload.session_id||""),voter=String(payload.voter_id||"");
  const ids=payload.song_ids;
  if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9-]{36}$/.test(voter)||!Array.isArray(ids)||
     ids.length!==3||new Set(ids).size!==3||ids.some((x:unknown)=>typeof x!=="string"||!/^[a-f0-9]{16}$/.test(x))){
    return json({error:"invalid_vote"},400,origin);
  }
  const eligible=new Set((await finalists()).map(s=>s.id));
  if(ids.some((x:string)=>!eligible.has(x)))return json({error:"ineligible_song"},400,origin);
  const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"voter:"+voter;
  const pepper=Deno.env.get("SINGER_VOTE_IP_PEPPER")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(pepper.length<32)return json({error:"not_configured"},503,origin);
  const result=await db.rpc("singer_cast_vote",{p_session:id,p_voter_hash:await sha(id+":"+voter),
   p_ip_hash:await sha(pepper+":"+ip),p_song_ids:ids});
  if(result.error)throw result.error;
  if(result.data!=="ok")return json({error:result.data},result.data==="rate_limited"?429:409,origin);
  return json({ok:true},200,origin);
 }catch(err){
  console.error("Voting request failed",err instanceof Error?err.message:"unknown");
  return json({error:"server_unavailable"},503,origin);
 }
});
