const eventCard=document.querySelector('#events .event-card');
if(eventCard){
 const date=eventCard.querySelector('.event-date');
 const title=eventCard.querySelector('.event-title');
 const place=eventCard.querySelector('.event-place');
 const media=eventCard.querySelector('.event-media');
 const buttons=eventCard.querySelectorAll('.event-actions .btn');
 const fallbackImage='/images/event-fallback.webp';
 const poster=document.createElement('img');
 poster.alt='Концертная сцена с микрофоном';
 poster.loading='lazy';
 poster.onerror=()=>{
  if(poster.getAttribute('src')!==fallbackImage){
   poster.src=fallbackImage;
   poster.alt='Концертная сцена с микрофоном';
  }else{
   poster.remove();
  }
 };
 poster.src=fallbackImage;
 media.append(poster);
 const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:''}catch{return ''}};
 async function loadNextShow(){
  try{
   const response=await fetch('https://jjaunlbglskpddslwegp.supabase.co/functions/v1/singer-request?public_show=1');
   if(!response.ok)throw Error('unavailable');
   const {show}=await response.json();
   if(!show){date.textContent='Следите за афишей';place.textContent='Новые даты появятся здесь';return}
   const start=new Date(show.show_at);
   if(!Number.isFinite(start.getTime()))throw Error('invalid date');
   date.textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',weekday:'short'}).format(start)+(show.time?' · '+show.time:'');
   title.textContent=show.venue||'Выступление Андрея';
   place.textContent=show.address||'Место выступления уточняется';
   const image=safeUrl(show.image_url);
   if(image){poster.alt='Афиша или фотография площадки';poster.src=image}
   const destination=safeUrl(show.booking_url)||safeUrl(show.website)||safeUrl(show.map_link);
   buttons[1].href='#events';buttons[1].addEventListener('click',e=>{e.preventDefault();window.downloadSingerEvent(show,start)});
   if(destination){buttons[0].href=destination;buttons[0].textContent=show.booking_url?'Забронировать столик ↗':'Подробнее о площадке ↗'}
  }catch{date.textContent='Следите за афишей';place.textContent='Актуальное расписание — в Telegram-канале'}
 }
 loadNextShow();
}
