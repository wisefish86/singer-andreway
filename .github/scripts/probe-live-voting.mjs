// Read-only integration probe. No secret, no votes and no admin actions.
const origin='https://singer.andreway.ru';
const endpoint='https://jjaunlbglskpddslwegp.supabase.co/functions/v1/singer-vote';
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),25000);
try{
 const configUrl='https://script.google.com/macros/s/AKfycbzCtHUBRaC3c_Tovx6We58tVElMRn1w6FUkcLCdNZAVhDyLnVj8hut-_gKTXgov086tlg/exec?kind=vote-config';
 const settingsResponse=await fetch(configUrl,{signal:controller.signal,redirect:'follow'});
 if(!settingsResponse.ok)throw Error('Sheet voting settings API unavailable: HTTP '+settingsResponse.status);
 const settings=await settingsResponse.json();
 if(typeof settings.enabled!=='boolean')throw Error('Sheet voting settings missing enabled flag');
 if(settings.enabled&&(!settings.start||!settings.end))throw Error('Invalid active Sheet schedule');
 if(settings.enabled&&(typeof settings.test_mode!=='boolean'||typeof settings.run_id!=='string'))throw Error('Deployed Google Sheet lacks test mode and isolated run ID');
 console.log('Google Sheet vote settings: HTTP '+settingsResponse.status+'; enabled='+settings.enabled+'; test_mode='+Boolean(settings.test_mode));
 const apiStart=Date.now();
 const response=await fetch(endpoint,{headers:{origin},signal:controller.signal});
 const apiDuration=Date.now()-apiStart;
 if(response.headers.get('access-control-allow-origin')!==origin)throw Error('Voting API CORS origin mismatch');
 console.log('Voting API request duration: '+apiDuration+' ms');
 const body=await response.json().catch(()=>({}));
 console.log('Voting API: HTTP '+response.status+'; active='+String(body.active)+'; song_count='+(body.songs?.length??'not open')+'; test_mode='+Boolean(body.test_mode));
 if(typeof body.test_mode!=='boolean')throw Error('Voting API missing test-mode status');
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
 const [votePage,homePage]=await Promise.all([
  fetch(origin+'/vote/',{signal:controller.signal}),fetch(origin+'/',{signal:controller.signal})
 ]);
 if(!votePage.ok||!homePage.ok)throw Error('Live site pages unavailable');
 const [vhtml,hhtml]=await Promise.all([votePage.text(),homePage.text()]);
 if(!vhtml.includes('vote-progress-fill')||!vhtml.includes('CATALOGUE_CACHE_KEY'))throw Error('Published vote page missing progress or cache');
 if(!hhtml.includes('home-reviews-track')||!hhtml.includes('whatsapp://send?phone='))throw Error('Published homepage missing reviews carousel or WhatsApp direct link');
 console.log('Published site HTML: vote cache/progress, review carousel and WhatsApp app link verified');
}finally{clearTimeout(timer)}
