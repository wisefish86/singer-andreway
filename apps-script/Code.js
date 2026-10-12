/**
 * Singer public events sync. Google Calendar is the source of truth.
 * Deploy with clasp; configure TELEGRAM_BOT_TOKEN in Apps Script properties.
 * Run installTriggers() once after first deployment.
 */
const CFG = Object.freeze({
  calendarId: 'mr.wisefish@gmail.com',
  calendarPrefix: '!В',
  timezone: 'Europe/Moscow',
  channel: '@andrey_spoet',
  spreadsheetId: '19GVhpyG9IjSJb9sR8dppXPbBYBemPkMUhgZUN4527t8',
  horizonDays: 180,
});

function publicEvents_() {
  const calendar = CalendarApp.getCalendarById(CFG.calendarId);
  if (!calendar) throw new Error('Calendar unavailable: ' + CFG.calendarId);
  const now = new Date();
  const until = new Date(now.getTime() + CFG.horizonDays * 86400000);
  return calendar.getEvents(now, until)
    .filter(e => e.getTitle().startsWith(CFG.calendarPrefix) && !e.isAllDayEvent())
    .map(e => ({
      id: e.getId(),
      title: e.getTitle().slice(CFG.calendarPrefix.length).trim(),
      start: e.getStartTime().toISOString(),
      end: e.getEndTime().toISOString(),
      location: e.getLocation() || '',
      description: e.getDescription() || '',
    }))
    .sort((a,b) => a.start.localeCompare(b.start));
}

function telegram_(method, data) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN script property');
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(data), muteHttpExceptions: true,
  });
  const result = JSON.parse(response.getContentText());
  if (!result.ok) throw new Error('Telegram ' + method + ': ' + result.description);
  return result.result;
}

function formatDate_(iso) {
  return Utilities.formatDate(new Date(iso), CFG.timezone, 'dd.MM.yyyy HH:mm');
}

function escapeHtml_(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanCalendarText_(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function compactAddress_(raw) {
  const parts = String(raw || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  const street = parts.find(p => /^(?:ул\.?|улица|проспект|пр-т|пер\.?|переулок|бульвар|шоссе|наб\.?|набережная|площадь|пр-д|проезд|мкр\.?|микрорайон)\s/i.test(p));
  const cityExplicit = parts.find(p => /^(?:г\.?|город)\s+[А-ЯЁ]/i.test(p));
  const cityCandidate = cityExplicit || parts.find(p =>
    p !== street && !/^(?:Россия|Российская Федерация|\d{5,6}|.*(?:край|область|республика|район|округ)|дом\s+\d|д\.\s*\d)/i.test(p)
    && !/^(?:ул\.?|улица|проспект|пр-т|пер\.?|переулок|бульвар|шоссе|наб\.?|набережная|площадь|проезд)/i.test(p)
    && /^[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,2}$/.test(p));
  const city = (cityCandidate || '').replace(/^(?:г\.?|город)\s+/i, '');
  if (city && street) {
    const afterStreet = parts.slice(parts.indexOf(street) + 1).find(p => /^(?:\d+[а-яa-z]?|д\.?\s*\d+)/i.test(p));
    const fullStreet = afterStreet ? street + ', ' + afterStreet : street;
    return city + ', ' + fullStreet;
  }
  // Preserve the address if its city/street cannot be identified confidently.
  return parts.filter(p => !/^(?:Россия|Российская Федерация|\d{5,6}|.*(?:край|область|республика))$/i.test(p)).join(', ');
}

function eventDetails_(event) {
  const original = event.description || '';
  const desc = cleanCalendarText_(original);
  const read = labels => {
    const pattern = new RegExp('(?:^|\\n)\\s*(?:[•●▪◦*-]\\s*)?(?:' + labels + ')\\s*[:：]\\s*(.+)', 'im');
    const match = desc.match(pattern);
    return match ? match[1].trim() : '';
  };
  // Supports plain URLs, Markdown links and HTML links in calendar descriptions.
  const linkedUrl = (labels) => {
    const line = read(labels);
    if (!line) return '';
    const md = line.match(/\]\((https?:\/\/[^)\s]+)\)/i);
    if (md) return md[1];
    const plain = line.match(/https?:\/\/[^\s<>)]+/i);
    if (plain) return plain[0];
    const escaped = labels.replace(/\|/g, '|');
    const htmlLine = original.match(new RegExp('(?:' + escaped + ')[^\\n]*?<a\\b[^>]*href=["\\'](https?:\\/\\/[^"\\']+)', 'i'));
    return htmlLine ? htmlLine[1] : '';
  };
  const unwrap = url => {
    if (!url) return '';
    url = url.replace(/&amp;/gi, '&').replace(/\\&/g, '&');
    const redirect = url.match(/^https?:\/\/(?:www\.)?google\.com\/url\?(.*)$/i);
    if (redirect) {
      const q = redirect[1].match(/(?:^|&)q=([^&]+)/);
      if (q) { try { return decodeURIComponent(q[1]); } catch (e) { return q[1]; } }
    }
    return url.replace(/[.,;]+$/, '');
  };
  const mapLink = unwrap(linkedUrl('Яндекс\\s*Карты|Яндекс\\.?Карты|Карта|Маршрут'));
  const siteLine = read('Официальный сайт|Сайт|Website|URL');
  let website = unwrap(linkedUrl('Официальный сайт|Сайт|Website|URL'));
  if (!website && siteLine && /^(?:www\.)?[\w-]+\.[a-z]{2,}/i.test(siteLine)) website = 'https://' + siteLine;
  const phonePattern = /(?:\+7|8)[\s().-]*(?:\d[\s().-]*){10}(?!\d)/g;
  const phoneMatch = desc.match(phonePattern);
  return {
    venue: read('Заведение|Площадка|Место|Venue') || event.title,
    address: compactAddress_(read('Адрес|Address') || event.location),
    website,
    mapLink: /^https?:\/\/(?:yandex\.ru|www\.yandex\.ru|yandex\.com|maps\.yandex\.[a-z]+)\//i.test(mapLink) ? mapLink : '',
    phone: read('Телефон|Тел\\.?|Phone') || (phoneMatch ? phoneMatch[0].trim() : ''),
  };
}

function routeLink_(address, mapLink) {
  return mapLink || 'https://yandex.ru/maps/?text=' + encodeURIComponent(address);
}

function addressLine_(address, mapLink) {
  return '📍 ' + escapeHtml_(address) + ' · <a href="' + escapeHtml_(routeLink_(address, mapLink)) + '">Построить маршрут</a>';
}

function renderChannel_(events) {
  const lines = ['<b>Ближайшие открытые выступления</b>', ''];
  if (!events.length) lines.push('Новых дат пока нет. Следите за обновлениями!');
  events.slice(0, 6).forEach(e => {
    const details = eventDetails_(e);
    lines.push('📅 ' + escapeHtml_(formatDate_(e.start)));
    if (details.venue) lines.push('🏛️ ' + escapeHtml_(details.venue));
    if (details.address) lines.push(addressLine_(details.address, details.mapLink));
    if (details.website) {
      const url = /^https?:\/\//i.test(details.website) ? details.website : 'https://' + details.website;
      if (/^https?:\/\/[^\s<>"]+$/i.test(url)) lines.push('🌐 <a href="' + escapeHtml_(url) + '">Сайт заведения</a>');
    }
    if (details.phone) lines.push('📞 ' + escapeHtml_(details.phone));
    lines.push('');
  });
  lines.push('🔔 Хотите получать напоминания о выступлениях? Подпишитесь на уведомления: https://t.me/andrey_spoet_bot');
  // Photo captions are limited to 1024 characters after parsing entities.
  const full = lines.join('\n');
  if (full.length <= 950) return full;
  const footer = '🔔 Напоминания: https://t.me/andrey_spoet_bot';
  const compact = ['<b>Ближайшие открытые выступления</b>', ''];
  for (const e of events) {
    const d = eventDetails_(e);
    const block = ['📅 ' + escapeHtml_(formatDate_(e.start))];
    if (d.venue) block.push('🏛️ ' + escapeHtml_(d.venue));
    if (d.address) block.push(addressLine_(d.address, d.mapLink));
    if (d.website) {
      const url = /^https?:\/\//i.test(d.website) ? d.website : 'https://' + d.website;
      if (/^https?:\/\/[^\s<>"]+$/i.test(url)) block.push('🌐 <a href="' + escapeHtml_(url) + '">Сайт</a>');
    }
    if (d.phone) block.push('📞 ' + escapeHtml_(d.phone));
    if ([...compact, ...block, '', footer].join('\n').length > 950) break;
    compact.push(...block, '');
  }
  compact.push(footer);
  return compact.join('\n');
}

function syncChannel() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const events = publicEvents_();
    const text = renderChannel_(events);
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('CHANNEL_LAST_TEXT') === text) return;
    const id = props.getProperty('CHANNEL_MESSAGE_ID');
    const photoId = props.getProperty('TELEGRAM_PHOTO_FILE_ID');
    if (id) {
      try {
        telegram_(photoId ? 'editMessageCaption' : 'editMessageText', photoId
          ? {chat_id: CFG.channel, message_id: Number(id), caption: text, parse_mode: 'HTML'}
          : {chat_id: CFG.channel, message_id: Number(id), text, parse_mode: 'HTML'});
      } catch (err) {
        if (!String(err).includes('message is not modified')) throw err;
      }
    } else {
      const sent = photoId
        ? telegram_('sendPhoto', {chat_id: CFG.channel, photo: photoId, caption: text, parse_mode: 'HTML'})
        : telegram_('sendMessage', {chat_id: CFG.channel, text, parse_mode: 'HTML'});
      props.setProperty('CHANNEL_MESSAGE_ID', String(sent.message_id));
      telegram_('pinChatMessage', {chat_id: CFG.channel, message_id: sent.message_id, disable_notification: true});
    }
    props.setProperty('CHANNEL_LAST_TEXT', text);
    props.setProperty('LAST_SUCCESS_AT', new Date().toISOString());
  } finally { lock.releaseLock(); }
}

/**
 * One-time photo setup: send the desired photo to the bot in a private chat,
 * then run this function. It replaces the pinned text post with a photo post.
 */
function setupChannelPhoto() {
  const props = PropertiesService.getScriptProperties();
  const updates = telegram_('getUpdates', {limit: 100, timeout: 0});
  const photos = updates.filter(u => u.message && u.message.chat.type === 'private' &&
    Array.isArray(u.message.photo) && u.message.photo.length);
  if (!photos.length) throw new Error('Send the photo to @andrey_spoet_bot in a private chat, then try again.');
  const latest = photos[photos.length - 1];
  const fileId = latest.message.photo[latest.message.photo.length - 1].file_id;
  const oldId = props.getProperty('CHANNEL_MESSAGE_ID');
  const oldText = props.getProperty('CHANNEL_LAST_TEXT');
  props.setProperty('TELEGRAM_PHOTO_FILE_ID', fileId);
  props.deleteProperty('CHANNEL_MESSAGE_ID');
  props.deleteProperty('CHANNEL_LAST_TEXT');
  try {
    syncChannel();
    if (oldId) {
      try { telegram_('unpinChatMessage', {chat_id: CFG.channel, message_id: Number(oldId)}); }
      catch (e) { console.warn('Could not unpin old message: ' + e); }
    }
    // Mark this update as consumed so a later setup doesn't reuse it by accident.
    telegram_('getUpdates', {offset: latest.update_id + 1, timeout: 0});
  } catch (e) {
    props.deleteProperty('TELEGRAM_PHOTO_FILE_ID');
    props.setProperty('CHANNEL_MESSAGE_ID', oldId || '');
    if (oldText) props.setProperty('CHANNEL_LAST_TEXT', oldText);
    throw e;
  }
}

function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncChannel')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncChannel').timeBased().everyHours(6).create();
}

// Public read-only endpoint for the website. Deployment is a separate one-time step.
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    updatedAt: new Date().toISOString(),
    events: publicEvents_().map(({id,title,start,end,location}) => ({id,title,start,end,location})),
  })).setMimeType(ContentService.MimeType.JSON);
}
