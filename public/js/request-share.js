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
    return {
      whatsapp: whatsappUrl + '?text=' + encodeURIComponent(message),
      // Official Telegram public-username deep link, unlike share/url,
      // opens the owner's chat rather than asking the visitor to select one.
      telegram: telegram.origin + '/' + recipient + '?text=' + encodeURIComponent(message),
      // MAX supports prefilled sharing, but requires selecting the recipient.
      max: 'https://max.ru/:share?text=' + encodeURIComponent(message),
      telegramUsername: '@' + recipient,
      message,
    };
  }

  window.SingerRequestShare = Object.freeze({ build, isConfirmed });
})();
