/* Public read-only gallery. Data comes from checked rows in the Google Sheet. */
(() => {
  const root = '/';
  const fallback = {
    videos: [{title:'Лучшие моменты',file:'- Андрей Шевцов - Видео выступлений.mp4',description:'Нарезка выступлений',cover:'best-moments.webp'}],
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
  function showPlayer(video) {
    if(!dialog) {
      dialog=element('dialog','showcase-dialog');
      dialog.setAttribute('aria-label','Просмотр видео');
      dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
      dialog.addEventListener('close',()=>{const player=dialog.querySelector('video');if(player){player.pause();player.removeAttribute('src');player.load()}});
      document.body.append(dialog);
    }
    dialog.replaceChildren();
    const close=element('button','showcase-close','✕');
    close.type='button';close.setAttribute('aria-label','Закрыть видео');close.addEventListener('click',()=>dialog.close());
    const player=element('video','showcase-player');
    player.controls=true;player.playsInline=true;player.preload='metadata';
    player.src=mediaPath('videos',video.file);
    const cover=mediaPath('covers',video.cover);
    if(cover)player.poster=cover;
    const caption=element('div','showcase-caption',video.title||'Видео выступления');
    dialog.append(close,player,caption);
    dialog.showModal();
    player.play().catch(()=>{});
  }
  function showPhoto(photo) {
    if(!dialog) {
      dialog=element('dialog','showcase-dialog');
      dialog.setAttribute('aria-label','Просмотр фотографии');
      dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
      document.body.append(dialog);
    }
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
      const cover=mediaPath('covers',item.cover);
      if(cover) {
        const poster=element('img','showcase-poster');
        poster.src=cover;poster.loading='lazy';poster.alt='';
        poster.addEventListener('error',()=>{poster.remove();makeVideoPreview(thumb,item)});
        thumb.append(poster);
      } else makeVideoPreview(thumb,item);
      thumb.append(element('span','showcase-play','▶'));
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
  function makeVideoPreview(thumb,item){
    const vid=element('video','showcase-preview');
    vid.muted=true;vid.playsInline=true;vid.preload='metadata';vid.tabIndex=-1;
    vid.setAttribute('aria-hidden','true');
    vid.src=mediaPath('videos',item.file)+'#t=1';
    thumb.prepend(vid);
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
