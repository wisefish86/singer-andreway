/* Build opt-in messenger links for a saved repertoire request. No automatic sends. */
(() => {
  'use strict';

  function isConfirmed(ownerNotified) {
    return ownerNotified === true;
  }

  function build({ link, name, event, phone, whatsappUrl, telegramWeb }) {
    if (!/^https:\/\/wa\.me\/\d+$/.test(whatsappUrl)) {
      throw new Error('Invalid WhatsApp destination');
    }
    const recipient = new URL(telegramWeb).pathname.replace(/^\/+|\/+$/g, '');
    if (!/^[A-Za-z0-9_]{5,32}$/.test(recipient)) {
      throw new Error('Invalid Telegram destination');
    }
    if (!/^https:\/\/singer\.andreway\.ru\/podborka\/#key=[a-f0-9]{64}$/.test(link)) {
      throw new Error('Request link is unavailable');
    }
    const lines = [
      'Здравствуйте, Андрей! Хочу отправить подборку песен.',
      'Имя: ' + name.trim(),
      event.trim() ? 'Мероприятие: ' + event.trim() : '',
      phone.trim() ? 'Телефон: ' + phone.trim() : '',
    ].filter(Boolean);
    const intro = lines.join('\n');
    return {
      whatsapp: whatsappUrl + '?text=' + encodeURIComponent(intro + '\nПодборка: ' + link),
      telegram: 'https://t.me/share/url?url=' + encodeURIComponent(link) +
        '&text=' + encodeURIComponent(intro),
      telegramUsername: '@' + recipient,
    };
  }

  window.SingerRequestShare = Object.freeze({ build, isConfirmed });
})();
