// Built-site regression test: every Astro page must expose the same site icons.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../../dist/', import.meta.url).pathname;
for (const asset of ['favicon-96x96.png', 'apple-touch-icon.png', 'site.webmanifest']) {
  assert.ok(existsSync(join(dist, asset)), 'Missing public favicon asset: ' + asset);
}
function htmlFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const filename = join(directory, name);
    return statSync(filename).isDirectory()
      ? htmlFiles(filename)
      : (name.endsWith('.html') ? [filename] : []);
  });
}
const pages = htmlFiles(dist);
assert.ok(pages.some(p => relative(dist, p) === 'index.html'), 'Homepage missing');
assert.ok(pages.some(p => relative(dist, p) === 'podborka/index.html'), 'Repertoire page missing');
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const icon of [
    'href="/favicon-96x96.png"',
    'href="/apple-touch-icon.png"',
    'href="/site.webmanifest"',
  ]) {
    assert.ok(html.includes(icon), `Missing ${icon} in ${relative(dist, page)}`);
  }
}
console.log(`Verified favicon links and assets in ${pages.length} generated HTML pages`);
