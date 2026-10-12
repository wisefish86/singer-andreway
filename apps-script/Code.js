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

function eventDetails_(event) {
  const desc = event.description || '';
  const read = (labels) => {
    const pattern = new RegExp('(?:^|\\n)\\s*(?:' + labels + ')\\s*[:：]\\s*(.+)', 'im');
    const match = desc.match(pattern);
    return match ? match[1].trim() : '';
  };
  return {
    venue: read('Заведение|Площадка|Место|Venue') || event.title,
    address: read('Адрес|Address') || event.location,
    website: read('Сайт|Website|URL'),
    phone: read('Телефон|Тел\\.?|Phone'),
  };
}

function renderChannel_(events) {
  const lines = ['<b>Ближайшие открытые выступления</b>', ''];
  if (!events.length) lines.push('Новых дат пока нет. Следите за обновлениями!');
  events.slice(0, 6).forEach(e => {
    const details = eventDetails_(e);
    lines.push('📅 ' + escapeHtml_(formatDate_(e.start)));
    if (details.venue) lines.push('🏛️ ' + escapeHtml_(details.venue));
    if (details.address) lines.push('📍 ' + escapeHtml_(details.address));
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
  const compact = ['<b>Ближайшие открытые выступления</b>', ''];
  events.slice(0, 3).forEach(e => {
    const d = eventDetails_(e);
    compact.push('📅 ' + escapeHtml_(formatDate_(e.start)));
    if (d.venue) compact.push('🏛️ ' + escapeHtml_(d.venue));
    if (d.address) compact.push('📍 ' + escapeHtml_(d.address));
    if (d.website) {
      const url = /^https?:\/\//i.test(d.website) ? d.website : 'https://' + d.website;
      if (/^https?:\/\/[^\s<>"]+$/i.test(url)) compact.push('🌐 <a href="' + escapeHtml_(url) + '">Сайт</a>');
    }
    if (d.phone) compact.push('📞 ' + escapeHtml_(d.phone));
    compact.push('');
  });
  compact.push('🔔 Напоминания: https://t.me/andrey_spoet_bot');
  return compact.join('\n').slice(0, 1000);
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
