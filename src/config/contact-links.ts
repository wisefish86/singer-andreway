/** Single source of public contact destinations shared by site pages. */
export const telegramWeb = 'https://t.me/shevtsov_andrey';
export const whatsapp = 'https://wa.me/79181142693';

export const telegramApp = 'tg://resolve?domain=shevtsov_andrey';

export const contactMessages = {
  event: 'Здравствуйте, Андрей! Хочу обсудить выступление на моём мероприятии.',
  video: 'Здравствуйте, Андрей! Хочу отправить видео с Вашего выступления.',
  feedback: 'Здравствуйте, Андрей! Хочу поделиться впечатлениями о Вашем выступлении.',
  song: 'Здравствуйте, Андрей! Хочу заказать песню во время выступления.'
} as const;

/** Build a direct chat with its own message, not a generic sharing link. */
export function directChatLinks(message: string) {
  const encoded = encodeURIComponent(message);
  return {
    telegramApp: telegramApp + '&text=' + encoded,
    telegramWeb: telegramWeb + '?text=' + encoded,
    whatsapp: whatsapp + '?text=' + encoded
  };
}
