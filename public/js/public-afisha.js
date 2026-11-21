/* Public calendar events. Google Calendar events starting !В are the source of truth. */
(() => {
  const host=document.getElementById('afisha-list');
  const api=document.querySelector('script[data-events-api]')?.dataset.eventsApi;
  if(!host||!api)return;
  const cacheKey='andrey-spoet-public-afisha-1';
  const el=(tag,cls,text)=>{
    const item=document.createElement(tag);
    if(cls)item.className=cls;
    if(text!==undefined)item.textContent=text;
    return item;
  };
  const localDate=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'});
  const weekDay=new Intl.DateTimeFormat('ru-RU',{weekday:'long',timeZone:'Europe/Moscow'});
  const localTime=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
  function cleanTitle(title){
    return String(title||'').replace(/\s*\(\s*\d+\s*[кk]\s*\)/gi,'').trim();
  }
  function parseTitle(title){
    const text=cleanTitle(title);
    const match=text.match(/,\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*$/);
    return {name:match?text.slice(0,match.index).trim():text,clock:match?match[1]+'–'+match[2]:''};
  }
  function calendarLink(item){
    const start=new Date(item.start),end=new Date(item.end);
    const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(start).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const dateStr=dateParts.year+dateParts.month+dateParts.day;
    const title=parseTitle(item.title);
    const match=title.clock.match(/^(\d{2}):(\d{2})–(\d{2}):(\d{2})$/);
    const utcFmt=x=>x.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    let dates=utcFmt(start)+'/'+utcFmt(end);
    if(match){
      const from=Number(match[1])*60+Number(match[2]);
      const to=Number(match[3])*60+Number(match[4]);
      const next=to<=from?new Date(Date.UTC(Number(dateParts.year),Number(dateParts.month)-1,Number(dateParts.day)+1)):null;
      const endDate=next?next.toISOString().slice(0,10).replace(/-/g,''):dateStr;
      dates=dateStr+'T'+match[1]+match[2]+'00/'+endDate+'T'+match[3]+match[4]+'00';
    }
    return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({
      action:'TEMPLATE',text:'Выступление Андрея Шевцова — '+title.name,
      dates,ctz:'Europe/Moscow',details:'Живое выступление Андрея Шевцова',
      location:item.location||''
    }).toString();
  }
  function render(events){
    const now=Date.now();
    const items=Array.isArray(events)?events.filter(x=>{
      const time=Date.parse(x.start);
      return Number.isFinite(time)&&time>=now-12*3600000;
    }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)):[];
    host.replaceChildren();
    if(!items.length){
      const empty=el('div','afisha-empty-state');
      empty.append(el('h2',null,'Новые выступления скоро появятся'));
      empty.append(el('p',null,'Следите за анонсами: здесь будут опубликованы даты ближайших открытых мероприятий.'));
      host.append(empty);return;
    }
    items.forEach(item=>{
      const date=new Date(item.start),details=parseTitle(item.title);
      const card=el('article','afisha-event');
      const dateBox=el('div','afisha-event-date');
      dateBox.append(el('span','afisha-event-weekday',weekDay.format(date)));
      dateBox.append(el('strong',null,localDate.format(date)));
      const content=el('div','afisha-event-content');
      content.append(el('h2',null,details.name||'Выступление Андрея Шевцова'));
      const clock=details.clock||localTime.format(date);
      content.append(el('p','afisha-event-time','◷  '+clock));
      if(item.location)content.append(el('p','afisha-event-location',item.location));
      const actions=el('div','afisha-event-actions');
      const calendar=el('a','afisha-event-action','Добавить в календарь');
      calendar.href=calendarLink(item);calendar.target='_blank';calendar.rel='noopener noreferrer';
      actions.append(calendar);
      if(item.location){
        const maps=el('a','afisha-event-action','Как добраться ↗');
        maps.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(item.location);
        maps.target='_blank';maps.rel='noopener noreferrer';
        actions.append(maps);
      }
      content.append(actions);
      card.append(dateBox,content);
      host.append(card);
    });
  }
  let displayed='';
  function applyEvents(events) {
    if(!Array.isArray(events))return;
    const next=JSON.stringify(events);
    if(next===displayed)return;
    displayed=next;
    render(events);
    try{localStorage.setItem(cacheKey,JSON.stringify({date:Date.now(),events}));}catch{}
  }
  window.singerEventsLoaded=payload=>{
    if(payload&&Array.isArray(payload.events))applyEvents(payload.events);
  };
  // The static HTML already contains the last published public Calendar snapshot.
  // It renders immediately, even on the first visit or if Google is unavailable.
  try{
    const seed=document.getElementById('afisha-snapshot');
    if(seed)applyEvents(JSON.parse(seed.textContent).events);
  }catch{}
  if(!displayed)try{
    const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');
    if(cached&&Array.isArray(cached.events))applyEvents(cached.events);
  }catch{}
  const script=document.createElement('script');
  script.src=api+'?kind=events&callback=singerEventsLoaded&v='+Math.floor(Date.now()/300000);
  script.async=true;
  script.onload=()=>script.remove();
  script.onerror=()=>{
    script.remove();
    if(!displayed)host.replaceChildren(el('p','afisha-empty','Не удалось загрузить расписание. Обновите страницу чуть позже.'));
  };
  document.head.append(script);
})();
