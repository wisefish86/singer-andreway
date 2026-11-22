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
assert.ok(html.includes('href="#reviews"'), 'Homepage reviews controls should scroll to its reviews section');
const homepage = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
assert.ok(homepage.includes('<a href="#reviews">Отзывы</a>'), 'Navigation Reviews must not leave homepage');
assert.ok(homepage.includes('class="quick-card" href="#reviews"'), 'Quick Reviews card must not leave homepage');
assert.ok(homepage.includes('href="/reviews/"'), 'Separate full reviews page stays accessible');
const fullReviews=readFileSync(new URL('../../src/pages/reviews/index.astro', import.meta.url), 'utf8');
assert.ok(fullReviews.includes('Здесь — впечатления гостей о моих выступлениях.'), 'Reviews intro should be concise');

console.log('Shared QR checked for contact messengers and Instagram subscription');

// Mobile media reliability and sticky-header anchor regressions.
const media = readFileSync(new URL('../../public/js/media-gallery.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
assert.ok(media.includes("player.preload='auto'"), 'Opened video must allow progressive buffering ahead of playback');
assert.ok(media.includes("new URLSearchParams(location.search).has('video-debug')"), 'Debug mode must be explicit opt-in only');
assert.ok(media.includes("Array.isArray(mapping?.videos)") && media.includes("mapping.videos.find(entry=>entry?.file===item.file)"), 'Gallery must resolve HLS by exact Google-published filename, including multiple videos');
assert.ok(media.includes("VIDEO_LOG_KEY='andrey-video-debug-v1'") && media.includes("localStorage.setItem(VIDEO_LOG_KEY"), 'Opt-in video test log must persist locally');
assert.ok(media.includes("recordVideoEvent(player,'playing'") && media.includes("recordVideoEvent(player,'seeked'"), 'Real playback and seeking should be recorded, not just planned source');
assert.ok(media.includes("Скопировать журнал тестов") && media.includes("video-diagnostics.json"), 'Owner must be able to export debug results');
const autoHlsWorkflow=readFileSync(new URL('../workflows/prepare-hls.yml',import.meta.url),'utf8');
const autoHlsScript=readFileSync(new URL('../scripts/auto-hls.py',import.meta.url),'utf8');
assert.ok(autoHlsWorkflow.includes("cron: '17,47 * * * *'") && autoHlsWorkflow.includes('auto-hls.py'), 'New or replaced video must be processed on an automatic schedule');
assert.ok(autoHlsScript.includes('hashlib.sha256') && autoHlsScript.includes('sha256') && autoHlsScript.includes('ftp.rename'), 'Automated HLS must detect changed content and publish registry atomically');
assert.ok(autoHlsScript.includes('ENCODE_VERSION = 2') && autoHlsScript.includes('"-level:v", "3.1"') && autoHlsScript.includes('avc1.4d401f'), 'HLS codec compatibility changes must cause a new transcoded asset version');

assert.ok(media.includes("reportVideoSource(player,'HLS · hls.js'") && media.includes("reportVideoSource(player,'MP4 · '"), 'Playback source must be diagnosable without guessing');
assert.ok(media.includes('hls.recoverMediaError()') && media.includes('hls.startLoad(Math.max(0,player.currentTime))'), 'HLS should attempt recovery before falling back');
assert.ok(media.includes("data.details==='manifestIncompatibleCodecsError'") && media.includes("fallback(String(data.details))"), 'Unrecoverable HLS codec mismatch must fall back to MP4 immediately');

assert.ok(styles.includes('.showcase-video-diagnostics'), 'Opt-in stream diagnostics must be readable');

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
assert.ok(html.includes('media-gallery.js?v=20261122-codecfallback5') && !html.includes('data-media-api='), 'Home must use cached media script without Google endpoint');
const videoPage=readFileSync(new URL('../../src/pages/all-videos/index.astro',import.meta.url),'utf8');
const photosPage=readFileSync(new URL('../../src/pages/all-photos/index.astro',import.meta.url),'utf8');
assert.ok(!videoPage.includes('data-media-api=')&&!photosPage.includes('data-media-api='),'Gallery pages must not poll Google');
const publishWorkflow=readFileSync(new URL('../workflows/sync-media.yml',import.meta.url),'utf8');
const mainDeploy=readFileSync(new URL('../workflows/deploy.yml',import.meta.url),'utf8');
assert.ok(publishWorkflow.includes('*/15 * * * *') && mainDeploy.includes('**/data/media.json'),'Media snapshot must refresh independently and survive deployment');

assert.ok(media.includes("player.addEventListener('waiting',()=>{showBuffering();reportBuffer('waiting');})") && media.includes("player.addEventListener('error',"), 'Video must explain buffering and network errors');
assert.ok(styles.includes('.section[id]{scroll-margin-top:26px}'), 'Anchor offset must account for sticky header and section padding exactly once');
assert.ok(!styles.includes('scroll-padding-top:82px') && !styles.includes('scroll-padding-top:80px'), 'Do not stack page scroll padding and section scroll margins');
assert.ok(!source.includes('#live{scroll-margin-top:92px}'), 'Guest section must share the same anchor alignment');
