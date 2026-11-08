import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const home = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
const astro = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../src/config/contact-links.ts', import.meta.url), 'utf8');

const expected = {
  event: 'Здравствуйте, Андрей! Хочу обсудить выступление на моём мероприятии.',
  video: 'Здравствуйте, Андрей! Хочу отправить видео с Вашего выступления.',
  feedback: 'Здравствуйте, Андрей! Хочу поделиться впечатлениями о Вашем выступлении.',
  song: 'Здравствуйте, Андрей! Хочу заказать песню во время выступления.'
};

for (const [kind, message] of Object.entries(expected)) {
  assert.ok(config.includes(kind + ": '" + message + "'"), 'Wrong ' + kind + ' message');
}
const contact = home.match(/<div class="contact-socials"[^>]*>([\s\S]*?)<\/div>/)?.[1];
assert.ok(contact, 'Booking contact area not found');
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
    assert.equal(href.searchParams.get('domain'), 'shevtsov_andrey');
    const web = new URL(fromTag(tag, 'data-social-web'));
    assert.equal(web.hostname, 't.me');
    assert.equal(web.pathname, '/shevtsov_andrey');
    assert.equal(web.searchParams.get('text'), expected.event);
  } else {
    assert.equal(href.hostname, 'wa.me');
    assert.equal(href.pathname, '/79181142693');
  }
}

// Exercise the exact guest sheet script, not just string-search the markup.
const inline = astro.match(/<script is:inline data-contact-sheet-script>([\s\S]*?)<\/script>/)?.[1];
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
runInNewContext(inline, { document, encodeURIComponent, decodeURIComponent });
for (const trigger of triggers) {
  trigger.click();
  const message = trigger.dataset.template;
  assert.equal(new URL(whatsapp.href).searchParams.get('text'), message);
  assert.equal(new URL(telegram.href).searchParams.get('text'), message);
  assert.equal(new URL(telegram.dataset.socialWeb).searchParams.get('text'), message);
}
assert.ok(sheet.opened, 'Guest sheet never opened');
const selected = [...home.matchAll(/data-title="(Отправить видео|Сказать пару слов|Заказать песню)"/g)];
assert.equal(selected.length, 3, 'Guest action buttons missing');
for (const message of [expected.video, expected.feedback, expected.song]) {
  assert.ok(home.includes('data-template="' + message + '"'), 'Guest template missing: ' + message);
}
console.log('Contact intent links passed: event booking and all guest messages in both messengers.');
