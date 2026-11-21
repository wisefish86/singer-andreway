/* Public read-only gallery. Data comes from checked rows in the Google Sheet. */
(() => {
  const root = '/';
  const fallback = {
    videos: [{title:'Лучшие моменты',file:'- Андрей Шевцов - Видео выступлений.mp4',description:'Нарезка выступлений',cover:'- Андрей Шевцов - Видео выступлений.webp'}],
    photos: []
  };
  let collection = fallback;
  function mediaPath(folder,name) {
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.includes('..')) return '';
    return root + folder + '/' + encodeURIComponent(name);
  }
  function element(tag,className,text) {
    const node = document.createElement(tag);
    if(className)node.className=className;
    if(text !== undefined)node.textContent=text;
    return node;
  }
  let dialog;
  let activeVideoIndex = 0;
  let videoList = [];
  function getDialog() {
    if (!dialog) {
      dialog = element('dialog','showcase-dialog');
      dialog.addEventListener('click', e => {if(e.target===dialog)dialog.close()});
      dialog.addEventListener('close', () => {
        const player=dialog.querySelector('video');
        if(player){player.pause();player.removeAttribute('src');player.load()}
        if(document.fullscreenElement===dialog)document.exitFullscreen().catch(()=>{});
      });
      document.body.append(dialog);
    }
    return dialog;
  }
  function renderPlayer() {
    const video=videoList[activeVideoIndex];
    if(!video)return;
    const playerDialog=getDialog();
    const old=playerDialog.querySelector('video');
    if(old){old.pause();old.removeAttribute('src');old.load()}
    playerDialog.classList.add('showcase-video-dialog');
    playerDialog.replaceChildren();
    const close=element('button','showcase-close','✕');
    close.type='button';close.setAttribute('aria-label','Закрыть видео');close.addEventListener('click',()=>playerDialog.close());
    const stage=element('div','showcase-video-stage');
    const player=element('video','showcase-player');
    player.controls=true;player.playsInline=true;player.preload='auto';
    player.src=mediaPath('videos',video.file);
    const cover=mediaPath('videos',video.cover);
    if(cover)player.poster=cover;
    stage.append(player);
    const previous=element('button','showcase-video-arrow showcase-prev','‹');
    previous.type='button';previous.setAttribute('aria-label','Предыдущее видео');
    previous.disabled=activeVideoIndex===0;
    previous.addEventListener('click',()=>changeVideo(-1));
    const next=element('button','showcase-video-arrow showcase-next','›');
    next.type='button';next.setAttribute('aria-label','Следующее видео');
    next.disabled=activeVideoIndex===videoList.length-1;
    next.addEventListener('click',()=>changeVideo(1));
    if(videoList.length>1)stage.append(previous,next);
    let touchX=null,touchY=null;
    stage.addEventListener('touchstart',e=>{
      if(e.touches.length===1){touchX=e.touches[0].clientX;touchY=e.touches[0].clientY}
    },{passive:true});
    stage.addEventListener('touchend',e=>{
      if(touchX===null||e.changedTouches.length!==1)return;
      const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;
      touchX=null;touchY=null;
      if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.6)changeVideo(dx<0?1:-1);
    },{passive:true});
    const footer=element('div','showcase-video-footer');
    const caption=element('strong','showcase-caption',video.title||'Видео выступления');
    footer.append(caption);
    if(videoList.length>1)footer.append(element('span','showcase-video-count',(activeVideoIndex+1)+' / '+videoList.length));
    playerDialog.append(close,stage,footer);
    if(!playerDialog.open)playerDialog.showModal();
    player.play().catch(()=>{});
  }
  function changeVideo(delta) {
    const index=activeVideoIndex+delta;
    if(index<0||index>=videoList.length)return;
    activeVideoIndex=index;
    renderPlayer();
  }
  function showPlayer(video) {
    videoList=Array.isArray(collection.videos)?collection.videos:[];
    if(!videoList.length)videoList=fallback.videos;
    activeVideoIndex=Math.max(0,videoList.findIndex(item=>item.file===video.file));
    renderPlayer();
    // Fullscreen the whole viewer rather than the video, so navigation remains visible.
    const viewer=getDialog();
    if(viewer.requestFullscreen && !document.fullscreenElement) {
      viewer.requestFullscreen().catch(()=>{}); // CSS fullscreen dialog is the fallback on iPhone.
    }
  }
  document.addEventListener('keydown',event=>{
    if(!dialog?.open||!dialog.classList.contains('showcase-video-dialog'))return;
    if(event.key==='ArrowRight')changeVideo(1);
    if(event.key==='ArrowLeft')changeVideo(-1);
  });
  function showPhoto(photo) {
    if(!dialog) {
      dialog=element('dialog','showcase-dialog');
      dialog.setAttribute('aria-label','Просмотр фотографии');
      dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
      document.body.append(dialog);
    }
    dialog.classList.remove('showcase-video-dialog');
    dialog.replaceChildren();
    const close=element('button','showcase-close','✕');
    close.type='button';close.setAttribute('aria-label','Закрыть фотографию');close.addEventListener('click',()=>dialog.close());
    const img=element('img','showcase-photo');
    img.src=mediaPath('photos',photo.file);img.alt=photo.title||photo.description||'Фотография с выступления';
    const actions=element('div','showcase-photo-actions');
    const caption=element('div','showcase-caption',photo.title||photo.description||'');
    const download=element('a','showcase-download','↓ Скачать фото');
    download.href=img.src;
    download.download=photo.file;
    download.setAttribute('aria-label','Скачать фотографию '+(photo.title||photo.file));
    actions.append(caption,download);
    dialog.append(close,img,actions);
    dialog.showModal();
  }
  function makeCard(item,type) {
    const card=element('button','showcase-card');
    card.type='button';
    const thumb=element('span','showcase-thumb');
    if(type==='video') {
      const cover=mediaPath('videos',item.cover);
      if(cover) {
        const poster=element('img','showcase-poster');
        poster.src=cover;poster.loading='lazy';poster.alt='';
        poster.addEventListener('error',()=>{poster.remove();makeVideoPreview(thumb,item)});
        thumb.append(poster);
      } else makeVideoPreview(thumb,item);
      thumb.append(element('span','showcase-play',''));
      card.addEventListener('click',()=>showPlayer(item));
    } else {
      const img=element('img','showcase-poster');
      img.loading='lazy';img.src=mediaPath('photos',item.file);img.alt=item.title||item.description||'Фотография';
      thumb.append(img);card.addEventListener('click',()=>showPhoto(item));
    }
    const body=element('span','showcase-card-body');
    body.append(element('strong','showcase-card-title',item.title || (type==='video'?'Видео выступления':'Фото')));
    if(item.description)body.append(element('span','showcase-card-sub',item.description));
    card.append(thumb,body);
    return card;
  }
  // Capture a single frame and immediately release the large MP4 decoder.
  // With a supplied cover image, no video file is fetched for previews.
  function makeVideoPreview(thumb,item){
    const holder=element('span','showcase-still');
    thumb.prepend(holder);
    const loadFrame=()=>{
      const video=document.createElement('video');
      video.muted=true;video.playsInline=true;video.preload='metadata';
      video.setAttribute('aria-hidden','true');
      let done=false;
      const cleanup=()=>{
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
      const capture=()=>{
        if(done||!video.videoWidth||!video.videoHeight)return;
        done=true;
        try{
          const canvas=document.createElement('canvas');
          const scale=Math.min(1,480/video.videoWidth,480/video.videoHeight);
          canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
          canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
          canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
          const image=element('img','showcase-poster');
          image.alt='';image.src=canvas.toDataURL('image/jpeg',0.78);
          holder.replaceChildren(image);
        }catch(error){ /* Keep gradient placeholder on failure. */ }
        cleanup();
      };
      video.addEventListener('loadeddata',capture,{once:true});
      video.addEventListener('error',cleanup,{once:true});
      video.src=mediaPath('videos',item.file)+'#t=1';
    };
    if('IntersectionObserver' in window){
      const observer=new IntersectionObserver(entries=>{
        if(entries.some(e=>e.isIntersecting)){observer.disconnect();loadFrame()}
      },{rootMargin:'120px'});
      observer.observe(thumb);
    }else loadFrame();
  }
  function render() {
    document.querySelectorAll('[data-media-gallery]').forEach(host=>{
      const type=host.dataset.mediaGallery;
      const list=type==='photos'?collection.photos:collection.videos;
      const limit=Number(host.dataset.limit)||10000;
      host.replaceChildren();
      const relevant=Array.isArray(list)?list.slice(0,limit):[];
      if(!relevant.length) {
        host.append(element('p','showcase-empty',type==='photos'?'Фотографии скоро появятся здесь.':'Видео скоро появятся здесь.'));
        return;
      }
      relevant.forEach(item=>host.append(makeCard(item,type==='photos'?'photo':'video')));
    });
  }
  window.singerMediaLoaded = data => {
    if(!data || !Array.isArray(data.videos) || !Array.isArray(data.photos)) return;
    collection=data;render();
  };
  function refresh(){
    const config=document.querySelector('script[data-media-api]');
    const base=config?.dataset.mediaApi||'';
    if(!base) return;
    const script=document.createElement('script');
    script.async=true;
    script.src=base+(base.includes('?')?'&':'?')+'kind=media&callback=singerMediaLoaded&v='+Math.floor(Date.now()/300000);
    script.onerror=()=>script.remove();
    document.head.append(script);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{render();refresh()},{once:true});
  else {render();refresh()}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  setInterval(refresh,300000);
})();
