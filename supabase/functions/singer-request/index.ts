import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { makeM3U8 } from "./playlist.ts";
const allowed = new Set(["https://singer.andreway.ru","http://localhost:4321","http://127.0.0.1:4321"]);
const encoder = new TextEncoder();
async function hash(s:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
}
function json(data:unknown,status:number,origin:string) {
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":origin,"Vary":"Origin","Cache-Control":"no-store","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST,OPTIONS"}});
}
async function ownerChatId(db:any):Promise<string>{
 const configured=Deno.env.get("SINGER_OWNER_CHAT_ID")||"";
 if(configured)return configured;
 const lookup=await db.rpc("singer_owner_chat_id");
 return !lookup.error&&lookup.data?String(lookup.data):"";
}
async function sendPlaylist(botToken:string,chatId:string,ids:string[]):Promise<boolean>{
 const libraryRoot=Deno.env.get("SINGER_MP3_ROOT");
 if(!libraryRoot){console.warn("Singer playlist root is not configured");return false;}
 try{
  const catalogueResult=await fetch("https://singer.andreway.ru/data/repertoire.public.json",{
   cache:"no-store",signal:AbortSignal.timeout(8000)
  });
  if(!catalogueResult.ok)throw new Error("Catalogue unavailable");
  const playlist=makeM3U8(ids,await catalogueResult.json(),libraryRoot);
  const data=new FormData();
  data.append("chat_id",chatId);
  data.append("document",new Blob([playlist],{type:"application/octet-stream"}),"Подборка.m3u8");
  const response=await fetch("https://api.telegram.org/bot"+botToken+"/sendDocument",{
   method:"POST",body:data,signal:AbortSignal.timeout(12000)
  });
  return response.ok&&Boolean((await response.json())?.ok);
 }catch(error){console.error("Singer playlist delivery failed",error instanceof Error?error.message:"unknown");return false;}
}
async function notifyOwner(kind:"create"|"update",name:string,phone:string,event:string,ids:string[],secretToken:string,db:any):Promise<boolean>{
 const botToken=Deno.env.get("SINGER_TELEGRAM_BOT_TOKEN")||"";
 let chatId=Deno.env.get("SINGER_OWNER_CHAT_ID")||"";
 if(!chatId){
  const lookup=await db.rpc("singer_owner_chat_id");
  if(!lookup.error&&lookup.data)chatId=String(lookup.data);
 }
 if(!botToken||!/^[-]?[0-9]{5,20}$/.test(chatId))return false;
 const url="https://singer.andreway.ru/podborka/#key="+secretToken;
 const lines=[
  kind==="create"?"🎶 Новая подборка песен":"✏️ Изменена подборка песен",
  "Имя: "+name,
  event?"Мероприятие: "+event:"",
  phone?"Телефон: "+phone:"",
  "Выбрано песен: "+ids.length,
  "Открыть и переслать клиенту:",
  url,
 ].filter(Boolean);
 try {
  const resp=await fetch("https://api.telegram.org/bot"+botToken+"/sendMessage",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({chat_id:chatId,text:lines.join("\n"),disable_web_page_preview:true}),
   signal:AbortSignal.timeout(7000),
  });
  if(!resp.ok){console.error("Singer request owner notification HTTP",resp.status);return false;}
  const payload=await resp.json();
  return payload?.ok===true;
 }catch(error){
  console.error("Singer request notification unavailable",error instanceof Error?error.name:"unknown");
  return false;
 }
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(!allowed.has(origin)) return new Response("Forbidden",{status:403});
 if(req.method==="OPTIONS") return json({},200,origin);
 if(req.method!=="POST") return json({error:"method_not_allowed"},405,origin);
 if(Number(req.headers.get("content-length")||0)>20000) return json({error:"too_large"},413,origin);
 try {
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"unknown";
  const {data:permitted,error:limitError}=await db.rpc("singer_check_rate_limit",{p_ip_hash:await hash(ip),p_limit:25});
  if(limitError||!permitted) return json({error:"rate_limited"},429,origin);
  const data=await req.json();
  const op=data?.action;
  if(!["create","get","update"].includes(op)) return json({error:"invalid_action"},400,origin);
  if(op!=="create" && (typeof data.token!=="string"||data.token.length!==64)) return json({error:"invalid_token"},400,origin);
  if(op==="get") {
   const result=await db.rpc("singer_request_get",{p_token_hash:await hash(data.token)});
   if(result.error)return json({error:"server_error"},500,origin);
  if(!result.data)return json({error:"not_found"},404,origin);
  return json({request:result.data},200,origin);
  }
  const name=typeof data.name==="string"?data.name.trim():"";
  const phone=typeof data.phone==="string"?data.phone.trim():"";
  const event=typeof data.event==="string"?data.event.trim():"";
  const ids=data.song_ids;
  if(name.length<1||name.length>100||phone.length>32||event.length>150||!Array.isArray(ids)||ids.length>250||ids.some((x:unknown)=>typeof x!=="string"||!(/^[a-f0-9]{16}$/.test(x)))) return json({error:"invalid_selection"},400,origin);
  if(op==="create"){
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
    const result=await db.rpc("singer_request_create",{p_name:name,p_phone:phone,p_event:event,p_song_ids:ids,p_token_hash:await hash(token)});
    if(result.error)return json({error:"server_error"},500,origin);
    const ownerNotified=await notifyOwner("create",name,phone,event,ids,token,db);
    const playlistSent=ownerNotified?await sendPlaylist(Deno.env.get("SINGER_TELEGRAM_BOT_TOKEN")||"",await ownerChatId(db),ids):false;
    return json({request:result.data,token,owner_notified:ownerNotified,playlist_sent:playlistSent},201,origin);
  }
  const result=await db.rpc("singer_request_update",{p_token_hash:await hash(data.token),p_name:name,p_phone:phone,p_event:event,p_song_ids:ids});
  if(result.error)return json({error:"server_error"},500,origin);
  if(!result.data)return json({error:"not_found"},404,origin);
  const ownerNotified=await notifyOwner("update",name,phone,event,ids,data.token,db);
  const playlistSent=ownerNotified?await sendPlaylist(Deno.env.get("SINGER_TELEGRAM_BOT_TOKEN")||"",await ownerChatId(db),ids):false;
  return json({request:result.data,owner_notified:ownerNotified,playlist_sent:playlistSent},200,origin);
 } catch {return json({error:"bad_request"},400,origin);}
});
