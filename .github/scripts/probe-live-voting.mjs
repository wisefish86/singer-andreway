// Read-only integration probe. No secret, no votes and no admin actions.
const origin='https://singer.andreway.ru';
const endpoint='https://jjaunlbglskpddslwegp.supabase.co/functions/v1/singer-vote';
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),12000);
try{
 const response=await fetch(endpoint,{headers:{origin},signal:controller.signal});
 const body=await response.json().catch(()=>({}));
 console.log('Voting API: HTTP '+response.status+'; active='+String(body.active)+'; song_count='+(body.songs?.length??'not open'));
 if(!response.ok||typeof body.active!=='boolean')throw Error('Voting API unavailable or invalid payload');
 if(!Array.isArray(body.songs)||body.songs.length<3)throw Error('Finale catalogue missing from API: voting page would appear blank');
 if(!body.active && body.songs.some(song=>(song.votes||0)!==0))throw Error('Closed session should not expose stale vote counts');
 const catalogue=await fetch(origin+'/data/repertoire.public.json',{signal:controller.signal,cache:'no-store'});
 console.log('Published repertoire: HTTP '+catalogue.status);
 if(catalogue.ok){
  const data=await catalogue.json();
  const songs=Array.isArray(data.songs)?data.songs:[];
  const eligible=songs.filter(song=>Array.isArray(song.playlist_variants)&&song.playlist_variants.some(v=>{
   const filename=String(v?.relative_path||v?.filename||'').split(/[\\/]/).pop()||'';
   return filename.includes('@')||String(v?.title||'').includes('@');
  }));
  console.log('Published songs: '+songs.length+'; finale @ songs: '+eligible.length);
  if(eligible.length<3)console.warn('WARNING: Less than three finale candidates; check the repertoire exporter retains the @ marker');
 }else console.warn('WARNING: Published repertoire cannot be fetched; voting cannot show finalists until catalogue is available');
}finally{clearTimeout(timer)}
