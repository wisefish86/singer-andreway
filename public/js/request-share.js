/* Open a direct conversation with a prepared, gender-neutral repertoire message. */
(() => {
  'use strict';

  function isConfirmed(ownerNotified) {
    return ownerNotified === true;
  }

  function build({ link, name, event, phone, purpose = 'wishes', whatsappUrl, telegramWeb }) {
    if (!/^https:\/\/wa\.me\/\d+$/.test(whatsappUrl)) {
      throw new Error('Invalid WhatsApp destination');
    }
    const telegram = new URL(telegramWeb);
    const recipient = telegram.pathname.replace(/^\/+|\/+$/g, '');
    if (telegram.protocol !== 'https:' || telegram.hostname !== 't.me' ||
        !/^[A-Za-z0-9_]{5,32}$/.test(recipient)) {
      throw new Error('Invalid Telegram destination');
    }
    if (!/^https:\/\/singer\.andreway\.ru\/podborka\/#key=[a-f0-9]{64}$/.test(link)) {
      throw new Error('Request link is unavailable');
    }
    if (!['wishes', 'order'].includes(purpose)) {
      throw new Error('Unknown request purpose');
    }
    const intro = purpose === 'order'
      ? 'Хочу заказать исполнение этих песен во время вашего выступления. Подскажите, пожалуйста, стоимость.'
      : 'Направляю пожелания к музыкальной программе предстоящего мероприятия. Будет здорово, если получится учесть эти песни.';
    const message = [
      'Андрей, здравствуйте!',
      '',
      intro,
      '',
      '🎵 Подборка песен:',
      link,
      '',
      event.trim() ? 'Мероприятие: ' + event.trim() : '',
      name.trim() ? 'Имя: ' + name.trim() : '',
      phone.trim() ? 'Телефон для связи: ' + phone.trim() : '',
    ].filter(line => line !== null && line !== undefined).join('\n').trim();
    // Telegram's official share flow starts with a fresh draft instead of reusing
    // an old draft from the owner's existing chat (e.g. a previous feedback form).
    // Telegram displays its recipient chooser; the visitor selects @${recipient}.
    const telegramMessage = message.replace('🎵 Подборка песен:' + String.fromCharCode(10) + link, '').trim();
    return {
      smsMessage: 'Подборка песен: ' + link,
      sms: 'sms:+79181142693?body=' + encodeURIComponent('Подборка песен: ' + link),
      whatsapp: whatsappUrl + '?text=' + encodeURIComponent(message),
      // A fresh Telegram share draft, with the editable playlist link as the URL.
      // Direct username links may reopen unrelated cloud drafts in an existing chat.
      telegram: telegram.origin + '/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(telegramMessage),
      telegramApp: 'tg://msg_url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(telegramMessage),
      whatsappApp: 'whatsapp://send?phone=' + new URL(whatsappUrl).pathname.slice(1) + '&text=' + encodeURIComponent(message),
      // Verified public profile URL; MAX cannot prefill a particular recipient chat.
      maxDirect: 'https://max.ru/u/f9LHodD0cOJuO0xwTsWmcH790HmZrPc21wP-BOoIgfgdGy5HKaHMK3ejGSQ',
      // MAX supports prefilled sharing, but requires selecting the recipient.
      max: 'https://max.ru/:share?text=' + encodeURIComponent(message),
      telegramUsername: '@' + recipient,
      message,
    };
  }

  // Use the venue's Krasnodar clock, not the visitor's device time zone.
  function defaultPurpose(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    const weekday = parts.find(part => part.type === 'weekday')?.value;
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    return (weekday === 'Fri' || weekday === 'Sat') && hour >= 20 && hour < 23
      ? 'order' : 'wishes';
  }

  window.SingerRequestShare = Object.freeze({ build, isConfirmed, defaultPurpose });
})();
