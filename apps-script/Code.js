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
    const htmlLine = original.match(new RegExp("(?:(" + labels + "))[^\\n]*?<a\\b[^>]*href=[\\\"'](https?:\\/\\/[^\\\"']+)", "i"));
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
  const mapCandidates = [...original.matchAll(/https?:\/\/(?:www\.)?(?:yandex\.(?:ru|com)\/maps|maps\.yandex\.[a-z]+)\/[^\s<>"')\]]+/gi)].map(m => m[0]);
  const mapLink = unwrap(linkedUrl('Яндекс\\s*Карты|Яндекс\\.?Карты|Карта|Маршрут') || mapCandidates[0] || '');
  const siteLine = read('Официальный сайт|Сайт|Website|URL');
  let website = unwrap(linkedUrl('Официальный сайт|Сайт|Website|URL'));
  if (!website && siteLine && /^(?:www\.)?[\w-]+\.[a-z]{2,}/i.test(siteLine)) website = 'https://' + siteLine;
  const phonePattern = /(?:\+7|8)[\s().-]*(?:\d[\s().-]*){10}(?!\d)/g;
  const phoneMatch = desc.match(phonePattern);
  return {
    venue: read('Заведение|Площадка|Место|Venue') || publicEventHeading_(event).venue,
    address: compactAddress_(read('Адрес|Address') || event.location),
    website,
    mapLink: /^https?:\/\/(?:yandex\.ru|www\.yandex\.ru|yandex\.com|maps\.yandex\.[a-z]+)\//i.test(mapLink) ? mapLink : '',
    phone: read('Телефон|Тел\\.?|Phone') || (phoneMatch ? phoneMatch[0].trim() : ''),
  };
}

function routeLink_(address, mapLink) {
  return mapLink || 'https://yandex.ru/maps/?text=' + encodeURIComponent(address);
}

function publicDateRu_(iso) {
  const day = Number(Utilities.formatDate(new Date(iso), CFG.timezone, 'd'));
  const month = Number(Utilities.formatDate(new Date(iso), CFG.timezone, 'M'));
  const localDate = Utilities.formatDate(new Date(iso), CFG.timezone, 'yyyy-MM-dd');
  const weekday = new Date(localDate + 'T12:00:00Z').getUTCDay();
  const months = ['января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря'];
  const weekdays = ['вс','пн','вт','ср','чт','пт','сб'];
  return day + ' ' + months[month - 1] + ' (' + weekdays[weekday] + ')';
}

function publicEventHeading_(event) {
  // Calendar start/end are private logistics times; only the date is public.
  // Public performance time is explicitly supplied at the end of the event title.
  const match = event.title.match(/^(.*?),\s*(\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2})\s*$/);
  return {
    venue: match ? match[1].trim() : event.title.trim(),
    time: match ? match[2].replace(/\s*[-–—]\s*/, '–') : '',
    date: publicDateRu_(event.start),
  };
}

function renderChannel_(events) {
  const lines = ['<b>Ближайшие открытые выступления</b>', ''];
  if (!events.length) lines.push('Пока нет ближайших открытых выступлений. Новые даты появятся здесь.');
  const footer = ''; // Напоминание оформлено отдельной кнопкой под сообщением.
  for (const e of events.slice(0, 6)) {
    const d = eventDetails_(e);
    const h = publicEventHeading_(e);
    const block = ['📅 ' + escapeHtml_(h.date)];
    if (h.time) block.push('🕗 ' + escapeHtml_(h.time));
    const site = /^https?:\/\/[^\s<>"]+$/i.test(d.website) ? d.website : '';
    if (d.venue) block.push('🏛️ ' + (site
      ? '<a href="' + escapeHtml_(site) + '">' + escapeHtml_(d.venue) + '</a> <i>(сайт)</i>'
      : escapeHtml_(d.venue)));
    if (d.address) block.push('📍 <a href="' + escapeHtml_(routeLink_(d.address, d.mapLink)) + '">' + escapeHtml_(d.address) + '</a> <i>(маршрут)</i>');
    if (d.phone) {
      // Telegram clients detect a plain international phone number more reliably
      // than an HTML tel: link inside a photo caption.
      const digits = d.phone.replace(/\D/g, '');
      const dial = digits.length === 11 && digits[0] === '8' ? '+7' + digits.slice(1)
        : digits.length === 11 && digits[0] === '7' ? '+' + digits : '';
      block.push('📞 ' + (dial || escapeHtml_(d.phone)));
    }
    const separator = lines.length > 2 ? '──────────' : '';
    if ([...lines, separator, ...block, '', footer].join('\n').length > 950) break;
    if (separator) lines.push(separator, '');
    lines.push(...block, '');
  }
  return lines.join('\n').trim();
}

function reminderKeyboard_() {
  return {inline_keyboard: [[{
    text: '🔔 Напомнить мне о выступлении',
    url: 'https://t.me/andrey_spoet_bot?start=reminders'
  }]]};
}

// Only update the buttons under the current pinned post, without changing its photo.
function updateReminderButton() {
  const id = PropertiesService.getScriptProperties().getProperty('CHANNEL_MESSAGE_ID');
  if (!id) throw new Error('CHANNEL_MESSAGE_ID отсутствует');
  telegram_('editMessageReplyMarkup', {
    chat_id: CFG.channel, message_id: Number(id), reply_markup: reminderKeyboard_()
  });
  console.log('Кнопка добавлена к существующей закреплённой афише');
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
          ? {chat_id: CFG.channel, message_id: Number(id), caption: text, parse_mode: 'HTML', reply_markup: reminderKeyboard_()}
          : {chat_id: CFG.channel, message_id: Number(id), text, parse_mode: 'HTML', link_preview_options: {is_disabled: true}});
      } catch (err) {
        if (!String(err).includes('message is not modified')) throw err;
      }
    } else {
      // New photo posts are created only by the explicit one-time setup function.
      throw new Error('CHANNEL_MESSAGE_ID не задан. Автоматически создавать новую афишу нельзя.');
    }
    props.setProperty('CHANNEL_LAST_TEXT', text);
    props.setProperty('LAST_SUCCESS_AT', new Date().toISOString());
  } finally { lock.releaseLock(); }
}

function setupChannelPhotoFromSite() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Другая синхронизация уже выполняется.');
  try {
    const imageUrl = 'https://singer.andreway.ru/images/concert-announcement.webp';
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN');
    console.log('Скачиваю изображение с сайта...');
    const photoResponse = UrlFetchApp.fetch(imageUrl, {
      muteHttpExceptions: true, followRedirects: true
    });
    const status = photoResponse.getResponseCode();
    if (status !== 200) throw new Error('Сайт не отдал изображение: HTTP ' + status);
    const blob = photoResponse.getBlob().setName('concert-announcement.webp');
    console.log('Изображение скачано: ' + blob.getBytes().length + ' байт; MIME=' + blob.getContentType());
    const caption = renderChannel_(publicEvents_());
    const oldId = props.getProperty('CHANNEL_MESSAGE_ID');
    console.log('Загружаю изображение в Telegram напрямую (multipart)...');
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'post',
      payload: {chat_id: CFG.channel, photo: blob, caption: caption, parse_mode: 'HTML', reply_markup: JSON.stringify(reminderKeyboard_())},
      muteHttpExceptions: true
    });
    const parsed = JSON.parse(response.getContentText());
    if (!parsed.ok) throw new Error('Telegram sendPhoto: ' + parsed.description +
      '. Если WebP не поддерживается как фото, разместите JPG по тому же пути с расширением .jpg.');
    const sent = parsed.result;
    console.log('Фотография опубликована, ID: ' + sent.message_id);
    telegram_('pinChatMessage', {chat_id: CFG.channel, message_id: sent.message_id, disable_notification: true});
    const photos = sent.photo || [];
    if (!photos.length) throw new Error('Telegram не вернул идентификатор фотографии');
    props.setProperties({
      CHANNEL_MESSAGE_ID: String(sent.message_id),
      TELEGRAM_PHOTO_FILE_ID: photos[photos.length - 1].file_id,
      CHANNEL_LAST_TEXT: caption
    });
    if (oldId && Number(oldId) !== sent.message_id) {
      try { telegram_('unpinChatMessage', {chat_id: CFG.channel, message_id: Number(oldId)}); }
      catch (err) { console.warn('Не удалось открепить прежнюю афишу: ' + err); }
    }
    console.log('Готово: при дальнейшей синхронизации будет изменяться только подпись.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Explicitly replace the photo in the existing pinned post.
 * Never sends a new channel message or changes its message_id/pin.
 * Not scheduled: invoke only when the hosted photo has changed.
 */
function refreshChannelPhoto() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Другая синхронизация уже выполняется.');
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TELEGRAM_BOT_TOKEN');
    const messageId = props.getProperty('CHANNEL_MESSAGE_ID');
    if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN');
    if (!messageId) throw new Error('Нет CHANNEL_MESSAGE_ID: нечего обновлять.');
    if (!props.getProperty('TELEGRAM_PHOTO_FILE_ID')) {
      throw new Error('Закреплённое сообщение не отмечено как фото. Обновление отменено.');
    }
    const url = 'https://singer.andreway.ru/images/concert-announcement.webp';
    const download = UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true});
    if (download.getResponseCode() !== 200) {
      throw new Error('Ошибка скачивания изображения: HTTP ' + download.getResponseCode());
    }
    const blob = download.getBlob().setName('concert-announcement.webp');
    const caption = renderChannel_(publicEvents_());
    const media = JSON.stringify({
      type: 'photo', media: 'attach://replacement_photo', caption: caption, parse_mode: 'HTML'
    });
    // multipart/form-data: Apps Script constructs the boundary for a blob payload.
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/editMessageMedia', {
      method: 'post',
      payload: {
        chat_id: CFG.channel,
        message_id: String(messageId),
        media: media,
        replacement_photo: blob
      },
      muteHttpExceptions: true
    });
    const result = JSON.parse(response.getContentText());
    if (!result.ok) throw new Error('Telegram editMessageMedia: ' + result.description);
    const photos = (result.result && result.result.photo) || [];
    if (photos.length) props.setProperty('TELEGRAM_PHOTO_FILE_ID', photos[photos.length - 1].file_id);
    props.setProperty('CHANNEL_LAST_TEXT', caption);
    props.setProperty('LAST_SUCCESS_AT', new Date().toISOString());
    console.log('Фото заменено в том же сообщении, ID: ' + messageId);
  } finally {
    lock.releaseLock();
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


/**
 * Private Telegram subscriptions and reminders.
 * Does not change the current webhook until setupSubscriberWebhook() is explicitly run.
 * Telegram cannot enumerate bot users: /start is required to register a subscriber.
 */
function subscribersSheet_(name) {
  const book = SpreadsheetApp.openById(CFG.spreadsheetId);
  const sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Не найдена вкладка «' + name + '»');
  return sheet;
}

function subscriberRows_() {
  const sheet = subscribersSheet_('Подписчики');
  const values = sheet.getDataRange().getValues();
  return {sheet, rows: values.slice(1).map((v,i) => ({
    row: i+2, chatId: String(v[0] || '').trim(), status: String(v[1] || ''),
    dayBefore: v[4] !== false && String(v[4]).toLowerCase() !== 'false',
    dayOf: v[5] !== false && String(v[5]).toLowerCase() !== 'false',
  }))};
}

function updateSubscriber_(chatId, enabled) {
  const {sheet, rows} = subscriberRows_();
  const id = String(chatId);
  const existing = rows.find(r => r.chatId === id);
  const stamp = new Date().toISOString();
  if (existing) {
    sheet.getRange(existing.row, 2).setValue(enabled ? 'active' : 'stopped');
    sheet.getRange(existing.row, 4).setValue(stamp);
    if (enabled) sheet.getRange(existing.row, 7).clearContent();
  } else if (enabled) {
    sheet.appendRow([id, 'active', stamp, stamp, true, true, '']);
  }
}

function doPost(e) {
  // The Telegram webhook must be configured separately, with a per-project
  // random secret in the URL. Never change an existing webhook automatically.
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('SUBSCRIBER_WEBHOOK_SECRET');
  if (!expected || !e || !e.parameter || e.parameter.key !== expected) {
    return ContentService.createTextOutput('ignored');
  }
  try {
    const update = JSON.parse(e.postData.contents || '{}');
    const message = update.message;
    if (!message || !message.chat || message.chat.type !== 'private') {
      return ContentService.createTextOutput('ok');
    }
    const command = String(message.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    const id = String(message.chat.id);
    if (!['/start','/stop','/status','/help'].includes(command)) {
      return ContentService.createTextOutput('ok');
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    let reply;
    try {
      if (command === '/start') {
        updateSubscriber_(id, true);
        reply = '🔔 Вы подписались на напоминания о моих открытых выступлениях! Вы получите сообщения за 48 и за 3 часа до выступления.\n\nОтключить: /stop';
      } else if (command === '/stop') {
        updateSubscriber_(id, false);
        reply = '🔕 Напоминания отключены. Чтобы включить их снова: /start';
      } else if (command === '/status') {
        const found = subscriberRows_().rows.find(r => r.chatId === id);
        reply = found && found.status === 'active' ? '✅ Напоминания включены. Отключить: /stop' : 'Напоминания выключены. Включить: /start';
      } else {
        reply = 'Напоминания о моих открытых выступлениях:\n/start — подписаться\n/status — проверить подписку\n/stop — отписаться';
      }
    } finally {lock.releaseLock();}
    telegram_('sendMessage', {chat_id: id, text: reply});
  } catch (error) {
    console.error('Subscriber webhook: ' + String(error));
    // Return OK to avoid Telegram retry storms; inspect Apps Script execution logs.
  }
  return ContentService.createTextOutput('ok');
}

function moscowTime_(date) {
  return Utilities.formatDate(date, CFG.timezone, 'yyyy-MM-dd HH:mm');
}

function publicShowStart_(e) {
  const heading = publicEventHeading_(e);
  if (!heading.time) return null;
  const startTime = heading.time.split('–')[0].trim();
  // Event day comes from Google Calendar; event start clock time is PRIVATE.
  const day = Utilities.formatDate(new Date(e.start), CFG.timezone, 'yyyy-MM-dd');
  return {day, time: startTime, timestamp: day + ' ' + startTime};
}

function plusLocalDays_(day, days) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function notificationText_(event, kind) {
  const h = publicEventHeading_(event);
  const d = eventDetails_(event);
  const prefix = kind === 'hours_48' ? '🔔 Через два дня выступаю!' : '🎤 Через три часа выступаю!';
  const parts = [prefix, '', '📅 ' + h.date];
  if (h.time) parts.push('🕗 ' + h.time);
  if (d.venue) parts.push('🏛️ ' + d.venue);
  if (d.address) parts.push('📍 ' + d.address);
  parts.push('', 'Актуальная афиша: https://t.me/andrey_spoet');
  return parts.join('\n');
}

function sentNotifications_() {
  const sheet = subscribersSheet_('Отправки');
  const data = sheet.getDataRange().getValues();
  const keys = new Set(data.slice(1).filter(row => String(row[6]) === 'sent')
    .map(row => [String(row[0]), String(row[1]), String(row[2]), String(row[3])].join('|')));
  return {sheet, keys};
}

/**
 * Check every 15 minutes. Reminders at 48h and 3h before the PUBLIC showtime.
 * Never use the private calendar start hour as the performance time.
 * Only active subscribers, including the owner if they explicitly /start the bot.
 */
function sendPerformanceReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const now = Date.now();
    const events = publicEvents_();
    const subscribers = subscriberRows_();
    const sent = sentNotifications_();
    const tasks = [];
    for (const event of events) {
      const show = publicShowStart_(event);
      if (!show) continue;
      // Moscow is UTC+03 year-round. Do not use the private calendar clock time.
      const showAt = Date.parse(show.day + 'T' + show.time + ':00+03:00');
      if (!Number.isFinite(showAt) || now >= showAt) continue;
      for (const item of [
        {kind:'hours_48', before:48},
        {kind:'hours_3', before:3}
      ]) {
        const target = showAt - item.before * 3600000;
        // One-hour delivery window tolerates Apps Script trigger jitter;
        // never send a reminder retroactively days after its target.
        if (now >= target && now < target + 3600000) tasks.push({event, kind:item.kind});
      }
    }
    for (const sub of subscribers.rows) {
      if (sub.status !== 'active') continue;
      for (const item of tasks) {
        if (item.kind === 'hours_48' && !sub.dayBefore) continue;
        if (item.kind === 'hours_3' && !sub.dayOf) continue;
        const key = [item.event.id, item.kind, sub.chatId, item.event.start].join('|');
        if (sent.keys.has(key)) continue;
        try {
          const result = telegram_('sendMessage', {
            chat_id: sub.chatId,
            text: notificationText_(item.event, item.kind),
            link_preview_options: {is_disabled:true}
          });
          sent.sheet.appendRow([item.event.id, item.kind, sub.chatId, item.event.start,
            new Date().toISOString(), result.message_id, 'sent', '']);
          sent.keys.add(key);
        } catch (error) {
          const reason = String(error).slice(0,450);
          sent.sheet.appendRow([item.event.id, item.kind, sub.chatId, item.event.start,
            new Date().toISOString(), '', 'failed', reason]);
          if (/bot was blocked|user is deactivated|chat not found|forbidden/i.test(reason)) {
            subscribers.sheet.getRange(sub.row, 2).setValue('blocked');
            subscribers.sheet.getRange(sub.row, 7).setValue(reason);
            sub.status = 'blocked';
            break;
          }
          console.error('Reminder failed: ' + reason);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function installReminderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendPerformanceReminders')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendPerformanceReminders').timeBased().everyMinutes(15).create();
}

/**
 * Print the Telegram webhook URL only after deploying this script as an
 * Apps Script web app (execute as owner, access anyone). Save a strong random
 * SUBSCRIBER_WEBHOOK_SECRET in Script Properties first.
 * Do not call setWebhook until the current webhook target has been reviewed.
 */
function inspectTelegramWebhook() {
  const info = telegram_('getWebhookInfo', {});
  console.log(JSON.stringify({
    webhook_host: info.url ? (info.url.match(/^https?:\/\/[^/]+/) || ['unknown'])[0] : '',
    pending_update_count: info.pending_update_count,
    last_error_message: info.last_error_message || ''
  }));
}

function activateSubscriberWebhook() {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('SUBSCRIBER_WEBAPP_URL');
  const secret = props.getProperty('SUBSCRIBER_WEBHOOK_SECRET');
  if (!base || !secret) throw new Error('Set SUBSCRIBER_WEBAPP_URL and SUBSCRIBER_WEBHOOK_SECRET first.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(base)) {
    throw new Error('Invalid Apps Script web app URL.');
  }
  // Explicitly replaces existing Telegram webhook. Review getWebhookInfo first.
  const result = telegram_('setWebhook', {url: base + '?key=' + encodeURIComponent(secret),
    allowed_updates: ['message'], drop_pending_updates: false});
  console.log('Webhook activated: ' + JSON.stringify(result));
}
