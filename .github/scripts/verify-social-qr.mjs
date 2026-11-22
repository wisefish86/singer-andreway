import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';

const source = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');

const platforms = ['telegram', 'whatsapp', 'max', 'instagram'];
for (const platform of platforms) {
  assert.ok(html.includes('data-social-platform="' + platform + '"'),
    'No desktop QR chooser trigger for ' + platform);
  assert.ok(source.includes("platform === '" + platform + "'") ||
    source.includes(platform + ': '), 'Missing QR dialog support for ' + platform);
}
for (const selector of [
  'id="telegram-sheet"', 'id="telegram-qr"', 'id="telegram-open-app"',
  'id="telegram-mobile-url"', 'data-messenger="max"',
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
assert.ok(!html.includes('data-social-platform="vk"'), 'VK must not be a visitor contact channel');
assert.ok(html.includes('data-social-platform="instagram"'), 'Instagram must be available in the final subscription section');
console.log('Shared QR checked for contact messengers and Instagram subscription');

// Mobile media reliability and sticky-header anchor regressions.
const media = readFileSync(new URL('../../public/js/media-gallery.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
assert.ok(media.includes("player.preload='metadata'"), 'Video must not eagerly download an entire clip before playback');
assert.ok(media.includes("player.addEventListener('waiting',showBuffering)") && media.includes("player.addEventListener('error',"), 'Video must explain buffering and network errors');
assert.ok(styles.includes('.section[id]{scroll-margin-top:26px}'), 'Anchor offset must account for sticky header and section padding exactly once');
assert.ok(!styles.includes('scroll-padding-top:82px') && !styles.includes('scroll-padding-top:80px'), 'Do not stack page scroll padding and section scroll margins');
assert.ok(!source.includes('#live{scroll-margin-top:92px}'), 'Guest section must share the same anchor alignment');
