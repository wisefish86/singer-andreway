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

function renderChannel_(events) {
  const lines = ['🎤 Ближайшие открытые выступления Андрея Шевцова', ''];
  if (!events.length) lines.push('Новых дат пока нет. Следите за обновлениями!');
  events.slice(0, 6).forEach(e => {
    lines.push('📅 ' + formatDate_(e.start));
    lines.push(e.title || 'Выступление');
    if (e.location) lines.push('🏛️ ' + e.location);
    lines.push('');
  });
  lines.push('🔔 Хотите получать напоминания о выступлениях? Подпишитесь на уведомления: https://t.me/andrey_spoet_bot');
  return lines.join('\n').slice(0, 950);
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
          ? {chat_id: CFG.channel, message_id: Number(id), caption: text}
          : {chat_id: CFG.channel, message_id: Number(id), text});
      } catch (err) {
        if (!String(err).includes('message is not modified')) throw err;
      }
    } else {
      const sent = photoId
        ? telegram_('sendPhoto', {chat_id: CFG.channel, photo: photoId, caption: text})
        : telegram_('sendMessage', {chat_id: CFG.channel, text});
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
