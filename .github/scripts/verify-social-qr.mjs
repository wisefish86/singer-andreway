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
assert.ok(media.includes("player.preload='auto'"), 'Opened video must allow progressive buffering ahead of playback');
assert.ok(media.includes('function addMobileSeekControls(') && media.includes('addMobileSeekControls(stage,player)'), 'Touch seeking controls must be attached to actual video player');
assert.ok(media.includes('desired+direction*10') && media.includes('player.currentTime=position'), 'Seek taps must combine before changing playback position');
assert.ok(media.includes('},240)') && media.includes("'(pointer: coarse)'"), 'Seek controls must batch taps on coarse-pointer devices');
assert.ok(styles.includes('.showcase-touch-seek') && styles.includes('@media(pointer:coarse)'), 'Mobile seek overlay must be styled only for touch devices');

assert.ok(media.includes("fetch('/data/video-hls.json'") && media.includes('Hls.isSupported()'), 'HLS must be resolved from server mapping when available');
assert.ok(media.includes('maxBufferLength:45') && media.includes('maxMaxBufferLength:120'), 'HLS should have a meaningful playback buffer');
assert.ok(media.includes("player.src=fileURL('videos',item.file)") && media.includes('activeHls.destroy()'), 'HLS must safely fall back to MP4 and free resources');

assert.ok(media.includes("fetch('/data/media.json',{cache:'no-cache'})"), 'Media must load its public snapshot from the same origin');
assert.ok(!media.includes('kind=media&callback=') && !media.includes('setInterval(refresh,300000)') && !media.includes('data-media-api'), 'Visitors must not poll Google for media');
assert.ok(!media.includes('dialog.requestFullscreen()'), 'Opening a video must not trigger a disruptive fullscreen transition');
assert.ok(html.includes('media-gallery.js?v=20261122-seek2') && !html.includes('data-media-api='), 'Home must use cached media script without Google endpoint');
const videoPage=readFileSync(new URL('../../src/pages/all-videos/index.astro',import.meta.url),'utf8');
const photosPage=readFileSync(new URL('../../src/pages/all-photos/index.astro',import.meta.url),'utf8');
assert.ok(!videoPage.includes('data-media-api=')&&!photosPage.includes('data-media-api='),'Gallery pages must not poll Google');
const publishWorkflow=readFileSync(new URL('../workflows/sync-media.yml',import.meta.url),'utf8');
const mainDeploy=readFileSync(new URL('../workflows/deploy.yml',import.meta.url),'utf8');
assert.ok(publishWorkflow.includes('*/15 * * * *') && mainDeploy.includes('**/data/media.json'),'Media snapshot must refresh independently and survive deployment');

assert.ok(media.includes("player.addEventListener('waiting',showBuffering)") && media.includes("player.addEventListener('error',"), 'Video must explain buffering and network errors');
assert.ok(styles.includes('.section[id]{scroll-margin-top:26px}'), 'Anchor offset must account for sticky header and section padding exactly once');
assert.ok(!styles.includes('scroll-padding-top:82px') && !styles.includes('scroll-padding-top:80px'), 'Do not stack page scroll padding and section scroll margins');
assert.ok(!source.includes('#live{scroll-margin-top:92px}'), 'Guest section must share the same anchor alignment');
