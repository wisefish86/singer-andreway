/** Single source of public contact destinations shared by site pages. */
export const telegramWeb = 'https://t.me/shevtsov_andrey';
export const whatsapp = 'https://wa.me/79181142693';

export const telegramApp = 'tg://resolve?domain=shevtsov_andrey';

export const contactMessages = {
  event: 'Здравствуйте, Андрей! Хочу обсудить выступление на моём мероприятии.',
  video: 'Здравствуйте, Андрей! Хочу отправить видео с вашего выступления.',
  feedback: 'Здравствуйте, Андрей! Хочу поделиться впечатлениями о вашем выступлении.',
  song: 'Здравствуйте, Андрей! Хочу заказать песню во время выступления.'
} as const;

/** Build a direct chat with its own message, not a generic sharing link. */
export function directChatLinks(message: string) {
  const encoded = encodeURIComponent(message);
  // Telegram resolve links can reopen an unrelated draft left in the owner's chat.
  // A share composer creates a fresh message and asks the visitor to choose the recipient.
  const site = encodeURIComponent('https://singer.andreway.ru/');
  return {
    telegramApp: 'tg://msg_url?url=' + site + '&text=' + encoded,
    telegramWeb: 'https://t.me/share/url?url=' + site + '&text=' + encoded,
    whatsapp: whatsapp + '?text=' + encoded
  };
}
