import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../../public/js/request-share.js',import.meta.url),'utf8');
const window={};
runInNewContext(source,{window,URL,encodeURIComponent});
const share=window.SingerRequestShare;
assert.ok(share,'Request share helper must be available');
assert.equal(share.isConfirmed(true),true);
for(const v of [false,undefined,null,'true',0]) {
  assert.equal(share.isConfirmed(v),false,'Unconfirmed notification requires fallback');
}
const link='https://singer.andreway.ru/podborka/#key='+'a'.repeat(64);
const values=share.build({
  link,name:'Андрей',event:'Юбилей',phone:'+7 (918) 123-45-67',
  whatsappUrl:'https://wa.me/79181142693',telegramWeb:'https://t.me/shevtsov_andrey'
});
const wa=new URL(values.whatsapp);
assert.equal(wa.origin,'https://wa.me');
assert.equal(wa.pathname,'/79181142693');
assert.ok(wa.searchParams.get('text').includes('Подборка: '+link));
assert.ok(wa.searchParams.get('text').includes('Юбилей'));
assert.ok(wa.searchParams.get('text').includes('+7 (918) 123-45-67'));
const tg=new URL(values.telegram);
assert.equal(tg.origin,'https://t.me');
assert.equal(tg.pathname,'/share/url');
assert.equal(tg.searchParams.get('url'),link);
assert.ok(tg.searchParams.get('text').includes('Здравствуйте, Андрей'));
assert.equal(values.telegramUsername,'@shevtsov_andrey');
assert.throws(()=>share.build({
  link:'https://evil.invalid/#key='+'a'.repeat(64),name:'A',event:'',phone:'',
  whatsappUrl:'https://wa.me/79181142693',telegramWeb:'https://t.me/shevtsov_andrey'
}),/link/i);

const dist=new URL('../../dist/',import.meta.url).pathname;
assert.ok(existsSync(dist+'js/request-share.js'),'Request share script missing from build');
const html=readFileSync(dist+'podborka/index.html','utf8');
for(const term of [
  'src="/js/request-share.js"',
  'id="share-whatsapp"',
  'id="share-telegram"',
  'id="manual-send"',
  'Отправить Андрею',
]) {
  assert.ok(html.includes(term),'Repertoire page missing '+term);
}
console.log('Request sharing tests passed: confirmed/failed notifications, WhatsApp, Telegram and build integration');
