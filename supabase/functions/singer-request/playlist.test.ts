import { makeM3U8 } from "./playlist.ts";

const a="a".repeat(16);
const b="b".repeat(16);
const root="C:\\Music";
const sample={
  schema_version:6,
  songs:[
    {id:a,artist:"Burito",name:"Мама",playlist_variants:[
      {relative_path:"Burito/mama_plus.mp3",title:"Мама +Б",duration_seconds:198},
      {relative_path:"Burito/mama_minus.mp3",title:"Мама -Б",duration_seconds:201},
      {relative_path:"Burito/mama_plus.mp3",title:"Мама +Б",duration_seconds:198},
    ]},
    {id:b,artist:"Sting",name:"Shape",playlist_variants:[
      {relative_path:"Sting/shape.mp3",title:"Shape",duration_seconds:237},
    ]}
  ]
};

function check(ok:boolean,message:string):void{if(!ok)throw new Error(message)}

Deno.test("one selected song includes all local versions, duplicates excluded",()=>{
 const m3u=makeM3U8([a],sample,root);
 check(m3u.startsWith("\uFEFF#EXTM3U\r\n"),"Missing UTF-8 BOM/header");
 check((m3u.match(/#EXTINF:/g)||[]).length===2,"Expected two versions");
 check(m3u.includes("C:\\Music\\Burito\\mama_minus.mp3"),"Incorrect Windows path");
});
Deno.test("selection order and version titles stay readable",()=>{
 const m3u=makeM3U8([b,a,a],sample,root);
 check(m3u.indexOf("Sting")<m3u.indexOf("Burito"),"Song order changed");
 check(m3u.includes("Мама +Б")&&m3u.includes("Мама -Б"),"Version title lost");
 check((m3u.match(/#EXTINF:/g)||[]).length===3,"Duplicated song/variant");
});
Deno.test("incomplete catalog and directory escapes are rejected",()=>{
 let fail=0;
 const calls=[
  ()=>makeM3U8(["f".repeat(16)],sample,root),
  ()=>makeM3U8([a],{...sample,schema_version:5},root),
  ()=>makeM3U8([a],{schema_version:6,songs:[{id:a,playlist_variants:[
   {relative_path:"../private.mp3"}
  ]}]},root),
 ];
 for(const call of calls){try{call()}catch{fail++}}
 check(fail===calls.length,"Unsafe or incomplete input passed");
});
