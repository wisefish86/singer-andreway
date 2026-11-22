import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const home = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
const astro = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../src/config/contact-links.ts', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../../src/components/ContactSheet.astro', import.meta.url), 'utf8');
const reviews = readFileSync(new URL('../../src/pages/reviews/index.astro', import.meta.url), 'utf8');

const expected = {
  event: 'Здравствуйте, Андрей! Хочу обсудить выступление на моём мероприятии.',
  video: 'Здравствуйте, Андрей! Хочу отправить видео с вашего выступления.',
  feedback: 'Здравствуйте, Андрей! Хочу поделиться впечатлениями о вашем выступлении.',
  song: 'Здравствуйте, Андрей! Хочу заказать песню во время выступления.'
};

for (const [kind, message] of Object.entries(expected)) {
  assert.ok(config.includes(kind + ": '" + message + "'"), 'Wrong ' + kind + ' message');
}
const contact = home.match(/<div class="contact-socials"[^>]*>([\s\S]*?)<\/div>/)?.[1];
assert.ok(contact, 'Booking contact area not found');
const bookingSection=home.match(/<section class="section" id="contact">([\s\S]*?)<\/section>/)?.[1];
const finalStay=home.match(/<section class="section stay-connected-section"[^>]*>([\s\S]*?)<\/section>/)?.[1];
assert.ok(bookingSection && finalStay, 'Contact and standalone final subscription sections must exist');
assert.ok(!bookingSection.includes('Останемся на связи'), 'Subscription must not be nested inside booking card');
assert.ok(finalStay.includes('Останемся на связи') && finalStay.includes('Telegram-канал') && finalStay.includes('Instagram') && finalStay.includes('Сохранить контакт'), 'All three follow-up actions must be in the final section');
assert.ok(!bookingSection.includes('Сохранить контакт'), 'Save contact must no longer be in booking card');
assert.ok(!contact.includes('instagram') && !contact.includes('vk'), 'Instagram and VK are not contact messengers');
assert.ok(home.indexOf('id="contact"') < home.indexOf('stay-connected-section'), 'Subscription must follow contacts');

assert.deepEqual([...contact.matchAll(/data-social-platform="([^"]+)"/g)].map(m=>m[1]), ['telegram','whatsapp','max'], 'Booking must offer only responsive messaging channels');
assert.ok(!home.includes('data-social-platform="vk"'), 'VK is not a contact channel');
assert.ok(home.includes('data-social-platform="instagram"'), 'Instagram must remain available for following');
assert.ok(!shared.includes('data-messenger="vk"') && !shared.includes('data-messenger="instagram"'), 'Popup must not include unused social networks');
function fromTag(tag, attribute) {
  return tag.match(new RegExp('\\b' + attribute + '="([^"]*)"'))?.[1]
    ?.replace(/&amp;|&#38;/g, '&');
}
for (const platform of ['telegram', 'whatsapp']) {
  const tag = [...contact.matchAll(/<a\b[^>]*>/g)].map(m => m[0])
    .find(item => item.includes('data-social-platform="' + platform + '"'));
  assert.ok(tag, 'Missing booking link for ' + platform);
  const href = new URL(fromTag(tag, 'href'));
  assert.equal(href.searchParams.get('text'), expected.event,
    'Booking ' + platform + ' must not contain guest/video message');
  if (platform === 'telegram') {
    assert.equal(href.protocol, 'tg:');
    assert.equal(href.hostname, 'msg_url', 'Telegram event link must open a fresh share draft');
    assert.equal(href.searchParams.get('url'), 'https://singer.andreway.ru/');
    const web = new URL(fromTag(tag, 'data-social-web'));
    assert.equal(web.hostname, 't.me');
    assert.equal(web.pathname, '/share/url');
    assert.equal(web.searchParams.get('url'), 'https://singer.andreway.ru/');
    assert.equal(web.searchParams.get('text'), expected.event);
  } else {
    assert.equal(href.hostname, 'wa.me');
    assert.equal(href.pathname, '/79181142693');
  }
}

// Exercise the exact guest sheet script, not just string-search the markup.
const inline = shared.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'Guest contact handler missing');
const telegram = {
  dataset: {
    chatBaseApp: 'tg://resolve?domain=shevtsov_andrey',
    chatBaseWeb: 'https://t.me/shevtsov_andrey'
  },
  href: ''
};
const whatsapp = { dataset: { chatBaseWeb: 'https://wa.me/79181142693' }, href: '' };
const triggers = Object.entries(expected).filter(([kind]) => kind !== 'event').map(([kind, message]) => ({
  dataset: { title: kind, copy: kind, template: message, repertoire: 'false' },
  addEventListener(event, callback) { assert.equal(event, 'click'); this.click = callback; }
}));
const sheet = {
  querySelector(selector) {
    if (selector === '[data-messenger="telegram"]') return telegram;
    if (selector === '[data-messenger="whatsapp"]') return whatsapp;
    if (selector === '#sheet-title') return byId['sheet-title'];
    if (selector === '#sheet-copy') return byId['sheet-copy'];
    if (selector === '#sheet-repertoire') return byId['sheet-repertoire'];
    if (selector === '.sheet-close') return {addEventListener() {}};
    return null;
  },
  showModal() { this.opened = true; },
  addEventListener() {}
};
const byId = {
  'contact-sheet': sheet,
  'sheet-title': { textContent: '' },
  'sheet-copy': { textContent: '' },
  'sheet-repertoire': { hidden: false }
};
const document = {
  getElementById: id => byId[id],
  querySelectorAll: () => triggers
};
runInNewContext(inline, { document, encodeURIComponent, decodeURIComponent, URLSearchParams, location:{search:'',hash:''}, navigator:{userAgent:'Linux x86_64'} });
for (const trigger of triggers) {
  trigger.click();
  const message = trigger.dataset.template;
  assert.equal(new URL(whatsapp.href).searchParams.get('text'), message);
  assert.equal(new URL(telegram.href).hostname, 'msg_url');
  assert.equal(new URL(telegram.href).searchParams.get('url'),'https://singer.andreway.ru/');
  assert.equal(new URL(telegram.href).searchParams.get('text'), message);
  assert.equal(new URL(telegram.dataset.socialWeb).pathname, '/share/url');
  assert.equal(new URL(telegram.dataset.socialWeb).searchParams.get('text'), message);
  assert.ok(!new URL(telegram.href).searchParams.get('text').includes('поделиться впечатлениями') || trigger.dataset.title==='feedback', 'Old feedback message must not leak into another contact intent');
}
assert.ok(sheet.opened, 'Guest sheet never opened');
assert.ok(shared.includes('whatsapp://send?phone=79181142693'), 'Mobile WhatsApp deep link is required');
const selected = [...home.matchAll(/data-title="(Отправить видео|Сказать пару слов|Заказать песню)"/g)];
assert.equal(selected.length, 3, 'Guest action buttons missing');
assert.deepEqual(selected.map(match => match[1]), ['Заказать песню', 'Отправить видео', 'Сказать пару слов'], 'Guest button order');
assert.ok(home.includes('id="guest-video-action"'), 'Missing video shortcut target');
assert.ok(shared.includes("get('guest')==='video'"), 'Missing video QR shortcut');
assert.ok(astro.includes('<ContactSheet />') && reviews.includes('<ContactSheet />'), 'Both pages must reuse the same popup');
assert.ok(shared.includes('data-messenger="max"'), 'MAX must be present in shared popup');
assert.ok(home.includes('Telegram-канал с афишей'), 'Keep the real Telegram channel subscription option');
assert.ok(reviews.includes('data-template={contactMessages.feedback}'), 'Reviews CTA must pass feedback template');
for (const message of [expected.video, expected.feedback, expected.song]) {
  assert.ok(home.includes('data-template="' + message + '"'), 'Guest template missing: ' + message);
}
console.log('Shared popup and contact intent links passed: Telegram, WhatsApp and MAX available on both pages.');
