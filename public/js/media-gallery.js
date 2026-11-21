/* ANDREY-SPOET public galleries: cached catalog, swipeable carousel and media viewer. */
(() => {
  'use strict';
  const API=document.querySelector('script[data-media-api]')?.dataset.mediaApi||'';
  const CACHE_KEY='andrey-spoet-media-v2';
  const EMPTY={videos:[],photos:[]};
  let collection=EMPTY, signature='', modal=null, mode='', photoIndex=0, videoIndex=0;
  let photos=[],videos=[];
  const elt=(tag,className,text)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const fileURL=(folder,name)=>{
    if(typeof name!=='string'||!name||name.includes('/')||name.includes('\\')||name.includes('..'))return '';
    return '/'+folder+'/'+encodeURIComponent(name);
  };
  const thumbnailURL=(folder,file)=>{
    if(typeof file!=='string'||!file.includes('.'))return '';
    return fileURL('thumbs/'+folder,file.replace(/\.[^.]+$/,'.webp'));
  };
  function coverCandidates(video){
    const stem=String(video.file||'').replace(/\.[^.]+$/,'');
    const preferred=String(video.cover||'').match(/\.(webp|jpe?g|png|avif)$/i)?.[1]?.toLowerCase();
    return [...new Set([preferred,'webp','jpg','jpeg','png','avif'].filter(Boolean))]
      .map(ext=>fileURL('videos',stem+'.'+ext)).filter(Boolean);
  }
  const imageCache=new Map();
  function resolveCover(video,callback){
    const key=video.file+'|'+(video.cover||'');
    if(imageCache.has(key)){callback(imageCache.get(key));return;}
    const paths=[thumbnailURL('videos',video.file),...coverCandidates(video)].filter(Boolean);
    let index=0;
    const tryNext=()=>{
      if(index===paths.length){imageCache.set(key,'');callback('');return;}
      const current=paths[index++],probe=new Image();
      probe.onload=()=>{imageCache.set(key,current);callback(current);};
      probe.onerror=tryNext;
      probe.src=current;
    };
    tryNext();
  }
  const getModal=()=>{
    if(modal)return modal;
    modal=elt('dialog','showcase-dialog');
    modal.setAttribute('aria-label','Просмотр фото и видео');
    modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});
    modal.addEventListener('close',()=>{
      const video=modal.querySelector('video');
      if(video){video.pause();video.removeAttribute('src');video.load();}
      if(document.fullscreenElement===modal)document.exitFullscreen().catch(()=>{});
      mode='';
    });
    document.body.append(modal);
    return modal;
  };
  function arrowIcon(direction) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','22');
    svg.setAttribute('height','22');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('focusable','false');
    svg.classList.add('showcase-arrow-icon');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',direction<0?'M15 5 8 12l7 7':'m9 5 7 7-7 7');
    path.setAttribute('fill','none');
    path.setAttribute('stroke','currentColor');
    path.setAttribute('stroke-width','2.6');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('stroke-linejoin','round');
    svg.append(path);
    return svg;
  }
  function downloadIcon(){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','20');
    svg.setAttribute('height','20');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('focusable','false');
    svg.classList.add('showcase-download-icon');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M12 3v12m0 0 4-4m-4 4-4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3');
    path.setAttribute('fill','none');
    path.setAttribute('stroke','currentColor');
    path.setAttribute('stroke-width','2');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('stroke-linejoin','round');
    svg.append(path);
    return svg;
  }
  function navButton(direction,callback,disabled){
    const btn=elt('button','showcase-video-arrow '+(direction<0?'showcase-prev':'showcase-next'));
    btn.append(arrowIcon(direction));
    btn.type='button';btn.disabled=disabled;
    btn.setAttribute('aria-label',direction<0?'Предыдущее':'Следующее');
    btn.addEventListener('click',callback);
    return btn;
  }
  function swipe(stage,callback){
    let x=null,y=null;
    stage.addEventListener('touchstart',e=>{
      if(e.touches.length===1){x=e.touches[0].clientX;y=e.touches[0].clientY;}
    },{passive:true});
    stage.addEventListener('touchend',e=>{
      if(x===null||e.changedTouches.length!==1)return;
      const dx=e.changedTouches[0].clientX-x,dy=e.changedTouches[0].clientY-y;
      x=null;y=null;
      if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)callback(dx<0?1:-1);
    },{passive:true});
  }
  function showPhoto(item){
    photos=collection.photos;
    photoIndex=Math.max(0,photos.findIndex(p=>p.file===item.file));
    mode='photo';renderPhoto();
  }
  function changePhoto(delta){
    const next=photoIndex+delta;
    if(next<0||next>=photos.length)return;
    photoIndex=next;renderPhoto();
  }
  function renderPhoto(){
    const item=photos[photoIndex];if(!item)return;
    const dialog=getModal();
    dialog.classList.remove('showcase-video-dialog');
    dialog.classList.add('showcase-photo-dialog');
    dialog.replaceChildren();
    const close=elt('button','showcase-close','✕');
    close.type='button';close.setAttribute('aria-label','Закрыть');
    close.addEventListener('click',()=>dialog.close());
    const stage=elt('div','showcase-photo-stage');
    const photo=elt('img','showcase-photo');
    photo.src=fileURL('photos',item.file);
    photo.alt=item.title||'Фотография Андрея Шевцова';
    stage.append(photo);
    if(photos.length>1){
      stage.append(navButton(-1,()=>changePhoto(-1),photoIndex===0),
        navButton(1,()=>changePhoto(1),photoIndex===photos.length-1));
    }
    swipe(stage,changePhoto);
    const footer=elt('div','showcase-photo-footer');
    const count=elt('span','showcase-video-count',(photoIndex+1)+' / '+photos.length);
    const download=elt('a','showcase-download');
    download.append(downloadIcon(),document.createTextNode('Скачать фото'));
    download.href=photo.src;download.download=item.file;
    download.setAttribute('aria-label','Скачать фото '+item.file);
    footer.append(count,download);
    dialog.append(close,stage,footer);
    if(!dialog.open)dialog.showModal();
    // Warm the adjacent images while the current photo is being viewed.
    for(const idx of [photoIndex-1,photoIndex+1]){
      if(photos[idx]){const next=new Image();next.src=fileURL('photos',photos[idx].file);}
    }
  }
  function showVideo(item){
    videos=collection.videos;
    videoIndex=Math.max(0,videos.findIndex(v=>v.file===item.file));
    mode='video';renderVideo();
    const dialog=getModal();
    if(dialog.requestFullscreen&&!document.fullscreenElement)dialog.requestFullscreen().catch(()=>{});
  }
  function changeVideo(delta){
    const next=videoIndex+delta;
    if(next<0||next>=videos.length)return;
    videoIndex=next;renderVideo();
  }
  function renderVideo(){
    const item=videos[videoIndex];if(!item)return;
    const dialog=getModal();
    const old=dialog.querySelector('video');
    if(old){old.pause();old.removeAttribute('src');old.load();}
    dialog.classList.remove('showcase-photo-dialog');
    dialog.classList.add('showcase-video-dialog');
    dialog.replaceChildren();
    const close=elt('button','showcase-close','✕');
    close.type='button';close.setAttribute('aria-label','Закрыть');
    close.addEventListener('click',()=>dialog.close());
    const stage=elt('div','showcase-video-stage');
    const player=elt('video','showcase-player');
    player.controls=true;player.playsInline=true;player.preload='auto';
    player.src=fileURL('videos',item.file);
    stage.append(player);
    resolveCover(item,url=>{if(url&&player.isConnected)player.poster=url;});
    if(videos.length>1)stage.append(navButton(-1,()=>changeVideo(-1),videoIndex===0),
      navButton(1,()=>changeVideo(1),videoIndex===videos.length-1));
    swipe(stage,changeVideo);
    const footer=elt('div','showcase-video-footer');
    footer.append(elt('strong','showcase-caption',item.title||'Видео выступления'));
    if(videos.length>1)footer.append(elt('span','showcase-video-count',(videoIndex+1)+' / '+videos.length));
    dialog.append(close,stage,footer);
    if(!dialog.open)dialog.showModal();
    player.play().catch(()=>{});
  }
  document.addEventListener('keydown',e=>{
    if(!modal?.open)return;
    if(e.key==='ArrowRight'){mode==='photo'?changePhoto(1):mode==='video'&&changeVideo(1);}
    if(e.key==='ArrowLeft'){mode==='photo'?changePhoto(-1):mode==='video'&&changeVideo(-1);}
  });
  function card(item,type,index,carousel){
    const button=elt('button','showcase-card '+(type==='photos'?'showcase-photo-card':'showcase-video-card'));
    button.type='button';
    button.setAttribute('aria-label',type==='photos'?'Открыть фотографию '+(index+1):'Воспроизвести '+(item.title||'видео'));
    const thumb=elt('span','showcase-thumb');
    if(type==='photos'){
      const img=elt('img','showcase-poster');
      img.src=thumbnailURL('photos',item.file)||fileURL('photos',item.file);
      img.onerror=()=>{
        const original=fileURL('photos',item.file);
        if(img.src!==new URL(original,location.href).href){img.onerror=null;img.src=original;}
      };
      img.alt=item.title||'';
      img.loading=carousel&&index<4?'eager':'lazy';
      img.decoding='async';
      if(carousel&&index<2)img.fetchPriority='high';
      thumb.append(img);
      button.append(thumb);
      button.addEventListener('click',()=>showPhoto(item));
      return button;
    }
    resolveCover(item,url=>{
      if(!button.isConnected)return;
      if(url){
        const img=elt('img','showcase-poster');
        img.src=url;img.alt='';
        img.loading=index<3?'eager':'lazy';
        img.decoding='async';
        thumb.prepend(img);
      }else{
        // Only if no supplied still exists, capture one frame from the MP4.
        captureVideoStill(thumb,item);
      }
    });
    thumb.append(elt('span','showcase-play'));
    const caption=elt('span','showcase-card-body');
    caption.append(elt('strong','showcase-card-title',item.title||'Видео выступления'));
    if(item.description)caption.append(elt('span','showcase-card-sub',item.description));
    button.append(thumb,caption);
    button.addEventListener('click',()=>showVideo(item));
    return button;
  }
  function captureVideoStill(thumb,item){
    if(thumb.querySelector('.showcase-still'))return;
    const holder=elt('span','showcase-still');
    thumb.prepend(holder);
    const start=()=>{
      const video=document.createElement('video');video.preload='metadata';
      video.muted=true;video.playsInline=true;
      const cleanup=()=>{video.pause();video.removeAttribute('src');video.load();};
      video.addEventListener('loadeddata',()=>{
        try{
          const canvas=document.createElement('canvas');
          const scale=Math.min(1,420/video.videoWidth,420/video.videoHeight);
          canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
          canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
          canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
          const image=elt('img','showcase-poster');image.src=canvas.toDataURL('image/jpeg',.7);
          holder.replaceChildren(image);
        }catch(e){}
        cleanup();
      },{once:true});
      video.addEventListener('error',cleanup,{once:true});
      video.src=fileURL('videos',item.file)+'#t=1';
    };
    if('IntersectionObserver'in window){
      const obs=new IntersectionObserver(entries=>{
        if(entries.some(e=>e.isIntersecting)){obs.disconnect();start();}
      },{rootMargin:'90px'});
      obs.observe(thumb);
    }else start();
  }
  function drawJustifiedPhotos(host,items){
    // Justified photo rows: each image keeps its native aspect ratio. Unlike
    // CSS columns, order stays left-to-right exactly as in the Google Sheet.
    const GAP=4;
    const buttons=items.map((item,i)=>card(item,'photos',i,false));
    const ratios=buttons.map(()=>0.75);
    const images=buttons.map(button=>button.querySelector('img'));
    let active=true,scheduled=false;
    function layout(){
      scheduled=false;
      if(!active||!host.isConnected)return;
      const width=host.clientWidth;
      if(!width)return;
      const target=width>=1050?300:width>=680?240:width>=420?200:170;
      const groups=[];
      let current=[],sum=0;
      buttons.forEach((button,i)=>{
        current.push(i);sum+=ratios[i];
        if(sum*target+GAP*(current.length-1)>=width && current.length){
          groups.push(current);current=[];sum=0;
        }
      });
      if(current.length)groups.push(current);
      const fragment=document.createDocumentFragment();
      groups.forEach((indexes,rowIndex)=>{
        const ratioSum=indexes.reduce((v,i)=>v+ratios[i],0);
        const fitted=(width-GAP*(indexes.length-1))/ratioSum;
        const last=rowIndex===groups.length-1;
        // A sparse final row is not blown up to giant portraits.
        const height=Math.max(115,Math.min(last?target*1.12:target*1.50,fitted));
        const row=elt('div','showcase-justified-row');
        row.style.height=height+'px';
        row.style.gap=GAP+'px';
        // Fill complete rows edge-to-edge, leave short last row natural-sized.
        row.style.justifyContent='flex-start';
        indexes.forEach(i=>{
          const button=buttons[i];
          button.style.flex='0 0 '+(height*ratios[i])+'px';
          row.append(button);
        });
        fragment.append(row);
      });
      host.replaceChildren(fragment);
    }
    const schedule=()=>{
      if(scheduled)return;
      scheduled=true;
      requestAnimationFrame(layout);
    };
    images.forEach((img,i)=>{
      const update=()=>{
        if(img.naturalWidth&&img.naturalHeight){
          ratios[i]=Math.max(0.25,Math.min(4,img.naturalWidth/img.naturalHeight));
          schedule();
        }
      };
      img.addEventListener('load',update);
      if(img.complete)update();
    });
    const observer='ResizeObserver' in window?new ResizeObserver(schedule):null;
    if(observer)observer.observe(host);
    else window.addEventListener('resize',schedule,{passive:true});
    // Avoid leaking an observer if the gallery is replaced after a Sheets update.
    host._showcaseCleanup=()=>{
      active=false;
      observer?.disconnect();
      if(!observer)window.removeEventListener('resize',schedule);
    };
    schedule();
  }
  function drawCarousel(host,items,type){
    const shell=elt('div','showcase-carousel');
    const rail=elt('div','showcase-carousel-rail');
    rail.setAttribute('aria-label',type==='photos'?'Карусель фотографий':'Карусель видео');
    items.forEach((item,i)=>rail.append(card(item,type,i,true)));
    const prev=elt('button','showcase-carousel-arrow showcase-carousel-prev');
    prev.append(arrowIcon(-1));
    const next=elt('button','showcase-carousel-arrow showcase-carousel-next');
    next.append(arrowIcon(1));
    prev.type=next.type='button';
    prev.setAttribute('aria-label','Прокрутить назад');
    next.setAttribute('aria-label','Прокрутить вперёд');
    const step=direction=>{
      const first=rail.querySelector('.showcase-card');
      rail.scrollBy({left:direction*(first?.getBoundingClientRect().width||300)+direction*14,behavior:'smooth'});
    };
    prev.addEventListener('click',()=>step(-1));
    next.addEventListener('click',()=>step(1));
    const sync=()=>{
      prev.disabled=rail.scrollLeft<5;
      next.disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-5;
    };
    rail.addEventListener('scroll',sync,{passive:true});
    shell.append(rail);
    if(items.length>1)shell.append(prev,next);
    host.append(shell);
    requestAnimationFrame(sync);
  }
  function warmImages(data){
    const urls=data.photos.slice(0,5).map(p=>thumbnailURL('photos',p.file));
    urls.forEach(url=>{if(!url)return;const img=new Image();img.src=url;});
    data.videos.slice(0,3).forEach(v=>resolveCover(v,()=>{}));
  }
  function render(){
    document.querySelectorAll('[data-media-gallery]').forEach(host=>{
      const type=host.dataset.mediaGallery==='photos'?'photos':'videos';
      const items=collection[type];
      if(typeof host._showcaseCleanup==='function'){
        host._showcaseCleanup();host._showcaseCleanup=null;
      }
      host.replaceChildren();
      if(!items.length){
        host.append(elt('p','showcase-empty',type==='photos'?'Фотографии скоро появятся здесь.':'Видео скоро появятся здесь.'));
        return;
      }
      if(host.classList.contains('showcase-home'))drawCarousel(host,items,type);
      else if(type==='photos')drawJustifiedPhotos(host,items);
      else items.forEach((item,i)=>host.append(card(item,type,i,false)));
    });
  }
  function update(data){
    if(!data||!Array.isArray(data.videos)||!Array.isArray(data.photos))return;
    const clean={videos:data.videos,photos:data.photos};
    const serialized=JSON.stringify(clean);
    if(serialized===signature)return; // avoid tearing down cards and reloading imagery
    signature=serialized;
    collection=clean;
    try{localStorage.setItem(CACHE_KEY,JSON.stringify({time:Date.now(),data:clean}));}catch(e){}
    render();
    warmImages(clean);
  }
  window.singerMediaLoaded=data=>{update(data);};
  let hasSaved=false;
  // Embedded at build time: no network request to Google or even JSON required
  // to display the first set of gallery cards.
  try{
    const seed=document.getElementById('media-snapshot');
    if(seed){
      const data=JSON.parse(seed.textContent);
      if(Array.isArray(data.photos)&&Array.isArray(data.videos)){
        update(data);
        hasSaved=true;
      }
    }
  }catch(e){}
  if(!hasSaved)try{
    const saved=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
    if(saved?.data&&Date.now()-saved.time<7*86400000){
      update(saved.data);hasSaved=true;
    }
  }catch(e){}
  if(!hasSaved)fetch('/media-catalog.json',{cache:'force-cache'})
    .then(response=>response.ok?response.json():null)
    .then(data=>{if(!signature&&data)update(data);})
    .catch(()=>{});
  function refresh(){
    if(!API)return;
    const script=document.createElement('script');
    script.async=true;
    script.src=API+(API.includes('?')?'&':'?')+'kind=media&callback=singerMediaLoaded&v='+Math.floor(Date.now()/300000);
    script.onload=()=>script.remove();
    script.onerror=()=>script.remove();
    document.head.append(script);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(!signature)render();refresh();},{once:true});
  else {if(!signature)render();refresh();}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(refresh,300000);
})();
