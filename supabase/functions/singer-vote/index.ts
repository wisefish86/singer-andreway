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
type Song={id:string;name:string;artist:string;preview_url:string};
let songCache: {until:number;songs:Song[]} | null = null;
async function finalists():Promise<Song[]>{
 if(songCache && songCache.until > Date.now())return songCache.songs;
 const response = await fetch(SITE + "/data/repertoire.public.json", {signal:AbortSignal.timeout(3800),cache:"no-store"});
 if(!response.ok) throw new Error("catalogue_unavailable");
 const data=await response.json();
 if(!Array.isArray(data.songs))throw new Error("catalogue_invalid");
 const songs:Song[]=[];
 for(const song of data.songs){
  if(!/^[a-f0-9]{16}$/.test(String(song.id))||!Array.isArray(song.playlist_variants))continue;
  const eligible = song.playlist_variants.some((variant:{relative_path?:string;title?:string;filename?:string}) => {
   // The MusicBee @ suffix can survive in a filename or the exported variant title.
   const filename=String(variant?.relative_path||variant?.filename||"").split(/[\\/]/).pop()||"";
   return filename.includes("@") || String(variant?.title||"").includes("@");
  }) || String(song.name||"").includes("@");
  if(eligible){
   let preview_url="";
   try{
    const u=new URL(String(song.preview_url||""));
    if(u.protocol==="https:"&&u.hostname==="singer.andreway.ru"&&u.pathname.startsWith("/audio/plus/")&&!u.search&&!u.hash)preview_url=u.href;
   }catch{}
   songs.push({id:song.id,name:String(song.name||"").replace(/@/g,"").trim(),artist:String(song.artist||""),preview_url});
  }
 }
 songs.sort((a,b)=>(a.artist+" "+a.name).localeCompare(b.artist+" "+b.name,"ru"));
 songCache={until:Date.now()+120000,songs};
 return songs;
}
type VoteTally={counts:Record<string,number>;voters:number};
let tallyCache:{sessionId:string;expires:number;value:VoteTally}|null=null;
async function getTally(db:any, sessionId:string):Promise<VoteTally>{
 if(tallyCache?.sessionId===sessionId && tallyCache.expires>Date.now())return tallyCache.value;
 const counts:Record<string,number>=Object.create(null);
 let voters=0;
 // Supabase limits queries to 1000 rows; paginate rather than dropping late votes.
 for(let offset=0;offset<10000;offset+=1000){
  const {data,error}=await db.from("singer_vote_ballots").select("song_ids").eq("session_id",sessionId).range(offset,offset+999);
  if(error)throw error;
  const rows=data||[];
  voters+=rows.length;
  for(const row of rows)for(const id of row.song_ids||[])counts[id]=(counts[id]||0)+1;
  if(rows.length<1000)break;
 }
 const value={counts,voters};
 tallyCache={sessionId,expires:Date.now()+5000,value};
 return value;
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
 const response=await fetch(CALENDAR,{signal:AbortSignal.timeout(2800),cache:"no-store"});
 if(!response.ok)throw new Error("calendar_unavailable");
 const data=await response.json();
 const windows=Array.isArray(data.windows)?data.windows.flatMap((w:{start:string;end:string})=>{
  const start=Date.parse(w.start), originalEnd=Date.parse(w.end);
  const end=originalEnd-3600000;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>12*3600000)return [];
  return [{start:new Date(start).toISOString(),end:new Date(end).toISOString()}];
 }):[];
 calendarCache={until:Date.now()+120000,windows};
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
// Explicitly private Google Sheet controls manual sessions. The web app exposes
// only dates and a boolean, never the spreadsheet itself or the admin secret.
const VOTE_CONFIG_URL="https://script.google.com/macros/s/AKfycbzCtHUBRaC3c_Tovx6We58tVElMRn1w6FUkcLCdNZAVhDyLnVj8hut-_gKTXgov086tlg/exec?kind=vote-config";
let scheduleCache:{until:number;config:{enabled:boolean;start?:string;end?:string}}|null=null;
async function manualSchedule(){
 if(scheduleCache&&scheduleCache.until>Date.now())return scheduleCache.config;
 const response=await fetch(VOTE_CONFIG_URL,{redirect:"follow",cache:"no-store",signal:AbortSignal.timeout(3500)});
 if(!response.ok)throw new Error("vote_sheet_unavailable");
 const data=await response.json();
 const config:{enabled:boolean;start?:string;end?:string}={enabled:false};
 if(data?.enabled===true){
  const start=Date.parse(data.start),end=Date.parse(data.end);
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=12*3600000&&
   end>Date.now()&&start<Date.now()+60*86400000){
    config.enabled=true;config.start=new Date(start).toISOString();config.end=new Date(end).toISOString();
  }
 }
 scheduleCache={until:Date.now()+30000,config};
 return config;
}
async function ensureManualSheetSession(db:any){
 let config:{enabled:boolean;start?:string;end?:string};
 try{config=await manualSchedule();}
 catch(e){
  // A temporary Sheet outage must not cancel an explicitly enabled live event.
  console.warn("Voting Sheet settings unavailable",e instanceof Error?e.message:"unknown");
  return;
 }
 const source=config.enabled?"sheet:"+config.start:null;
 const {data,error}=await db.from("singer_vote_sessions")
  .select("id,source_key,enabled,starts_at,ends_at").like("source_key","sheet:%").eq("enabled",true).limit(100);
 if(error)throw error;
 for(const old of data||[]){
  if(old.source_key!==source){
   const {error:closeError}=await db.from("singer_vote_sessions").update({enabled:false}).eq("id",old.id);
   if(closeError)throw closeError;
  }
 }
 if(!config.enabled||!source)return;
 const current=(data||[]).find((x:any)=>x.source_key===source);
 if(current&&current.starts_at===config.start&&current.ends_at===config.end)return;
 const {error:upsertError}=await db.from("singer_vote_sessions").upsert({
  title:"Голосование вечера",source_key:source,starts_at:config.start,
  ends_at:config.end,enabled:true
 },{onConflict:"source_key"});
 if(upsertError)throw upsertError;
}
async function authorized(req:Request,db:any):Promise<boolean>{
 const supplied=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
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
   // Fetch songs alongside calendar and Sheet settings to minimize cold-start delay.
   const [calendarCheck,sheetCheck,catalogueCheck]=await Promise.allSettled([
    ensureCalendarSessions(db),ensureManualSheetSession(db),finalists()
   ]);
   if(catalogueCheck.status!=="fulfilled")throw new Error("catalogue_unavailable");
   const songs=catalogueCheck.value;
   for(const check of [calendarCheck,sheetCheck]){
    if(check.status==="rejected")console.warn("Voting schedule source temporarily unavailable");
   }
   const {data,error}=await db.from("singer_vote_sessions").select("id,starts_at,ends_at")
    .eq("enabled",true).lte("starts_at",new Date().toISOString()).gt("ends_at",new Date().toISOString())
    .order("starts_at",{ascending:false}).limit(1).maybeSingle();
   if(error)throw error;
   // The public catalogue is always available for preview even outside an event.
   // Only active sessions expose vote counts or accept ballots.
   if(!data){
    return json({active:false,songs:songs.map(song=>({...song,votes:0})),voters:0,catalogue_ready:songs.length>=3},200,origin);
   }
   const tally=await getTally(db,data.id);
   return json({active:true,session:{id:data.id,ends_at:data.ends_at},songs:songs.map(song=>({...song,votes:tally.counts[song.id]||0}))
    .sort((a,b)=>b.votes-a.votes||(a.artist+" "+a.name).localeCompare(b.artist+" "+b.name,"ru")),
    voters:tally.voters, catalogue_ready:songs.length>=3},200,origin);
  }
  if(req.method!=="POST")return json({error:"method_not_allowed"},405,origin);
  if(Number(req.headers.get("content-length")||0)>5000)return json({error:"too_large"},413,origin);
  const payload=await req.json();
  if(payload?.action==="admin"){
   if(!(await authorized(req,db)))return json({error:"unauthorized"},401,origin);
   const op=payload.operation;
   if(op==="catalogue"){
    const songs=await finalists();
    return json({eligible_count:songs.length,preview:songs.slice(0,12)},200,origin);
   }
   if(op==="status"){
    const {data,error}=await db.from("singer_vote_sessions").select("id,starts_at,ends_at,enabled,created_at")
     .order("created_at",{ascending:false}).limit(20);
    if(error)throw error;
    const now=Date.now();
    const latest=data?.find((session:any)=>session.enabled && Date.parse(session.starts_at)<=now && Date.parse(session.ends_at)>now) || data?.[0] || null;
    if(!latest)return json({session:null,results:[]},200,origin);
    const {data:ballots,error:ballotError}=await db.from("singer_vote_ballots").select("song_ids").eq("session_id",latest.id);
    if(ballotError)throw ballotError;
    const counts=new Map<string,number>();
    for(const b of ballots||[])for(const id of b.song_ids)counts.set(id,(counts.get(id)||0)+1);
    const songNames=await finalists().catch(()=>[]);
    return json({session:latest,ballots:ballots?.length||0,songs:songNames,results:[...counts].map(([id,votes])=>({id,votes})).sort((a,b)=>b.votes-a.votes)},200,origin);
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
     ids.length<1||ids.length>3||new Set(ids).size!==ids.length||ids.some((x:unknown)=>typeof x!=="string"||!/^[a-f0-9]{16}$/.test(x))){
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
  tallyCache=null;
  return json({ok:true},200,origin);
 }catch(err){
  console.error("Voting request failed",err instanceof Error?err.message:"unknown");
  return json({error:"server_unavailable"},503,origin);
 }
});
