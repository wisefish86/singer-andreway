const eventCard=document.querySelector('#events .event-card');
if(eventCard){
 const date=eventCard.querySelector('.event-date');
 const title=eventCard.querySelector('.event-title');
 const place=eventCard.querySelector('.event-place');
 const media=eventCard.querySelector('.event-media');
 const calendarLinks=[...document.querySelectorAll('#events .event-calendar-link')];
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
   // Google Calendar accepts local event times and an IANA time zone.
   // Use the real end time from the event's displayed time range when provided.
   const localParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'
   }).formatToParts(start).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
   const datePart=localParts.year+localParts.month+localParts.day;
   const times=String(show.time||'').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
   const startParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(start).match(/(\d{2}):(\d{2})/);
   const startHour=times?Number(times[1]):Number(startParts?.[1]);
   const startMinute=times?Number(times[2]):Number(startParts?.[2]);
   const endHour=times?Number(times[3]):null;
   const endMinute=times?Number(times[4]):null;
   const validTime=Number.isInteger(startHour)&&startHour>=0&&startHour<24&&startMinute>=0&&startMinute<60;
   const validEnd=times&&endHour>=0&&endHour<24&&endMinute>=0&&endMinute<60;
   if(validTime){
    const pad=value=>String(value).padStart(2,'0');
    const startsAt=datePart+'T'+pad(startHour)+pad(startMinute)+'00';
    let endsAt;
    if(validEnd){
     const followingDay=endHour*60+endMinute<=startHour*60+startMinute;
     const next=followingDay?new Date(Date.UTC(Number(localParts.year),Number(localParts.month)-1,Number(localParts.day)+1)):null;
     const nextDate=next?next.toISOString().slice(0,10).replace(/-/g,''):datePart;
     endsAt=nextDate+'T'+pad(endHour)+pad(endMinute)+'00';
    }else{
     // Calendar-only fallback for events without a stated end time.
     const assumedEnd=new Date(Date.UTC(Number(localParts.year),Number(localParts.month)-1,Number(localParts.day),startHour,startMinute+60));
     endsAt=assumedEnd.toISOString().slice(0,19).replace(/[-:]/g,'');
    }
    const destination=safeUrl(show.booking_url)||safeUrl(show.website)||safeUrl(show.map_link);
    const description=['Живое выступление Андрея Шевцова',!validEnd?'Время окончания уточняется.':'',destination].filter(Boolean).join('\n');
    const params=new URLSearchParams({action:'TEMPLATE',text:'Выступление Андрея Шевцова — '+(show.venue||'концерт'),dates:startsAt+'/'+endsAt,ctz:'Europe/Moscow',details:description,location:[show.venue,show.address].filter(Boolean).join(', ')});
    for(const link of calendarLinks){
     link.href='https://calendar.google.com/calendar/render?'+params.toString();
     link.removeAttribute('aria-disabled');
     link.removeAttribute('tabindex');
    }
   }
  }catch{date.textContent='Следите за афишей';place.textContent='Актуальное расписание — в Telegram-канале'}
 }
 loadNextShow();
}
