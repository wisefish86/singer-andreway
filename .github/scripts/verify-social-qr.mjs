import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';

const source = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');

const platforms = ['telegram', 'whatsapp', 'max', 'vk', 'instagram'];
for (const platform of platforms) {
  assert.ok(html.includes('data-social-platform="' + platform + '"'),
    'No desktop QR chooser trigger for ' + platform);
  assert.ok(source.includes("platform === '" + platform + "'") ||
    source.includes(platform + ': '), 'Missing QR dialog support for ' + platform);
}
for (const selector of [
  'id="telegram-sheet"', 'id="telegram-qr"', 'id="telegram-open-app"',
  'id="telegram-mobile-url"', 'data-messenger="max"',
  'data-messenger="vk"',
]) {
  assert.ok(html.includes(selector), 'Missing shared contact/QR element: ' + selector);
}
const match = source.match(/const max = '(https:\/\/max\.ru\/u\/[^']+)'/);
assert.ok(match, 'MAX needs a real personal-profile URL, not a phone or an invented deep link');
const url = match[1];
const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
assert.ok(qr.modules.size > 0, 'MAX profile link must be QR-encodable');
assert.ok(source.includes('link.closest(\'#contact-sheet\')'),
  'Opening QR from messenger sheet must close that sheet first');
assert.ok(source.includes('drawRoundedQr(socialQr, webUrl'),
  'QR must encode the actual public profile URL');
assert.ok(source.includes("if (isMobileDevice()"),
  'Mobile should follow the normal link without forcing a desktop QR');
console.log('Shared desktop QR checked for Telegram, WhatsApp, MAX, VK and Instagram');
