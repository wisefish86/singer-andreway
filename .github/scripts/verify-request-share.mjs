import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../../public/js/request-share.js',import.meta.url),'utf8');
const window={};
runInNewContext(source,{window,URL,encodeURIComponent});
const share=window.SingerRequestShare;
assert.ok(share,'Request share helper must be available');
assert.equal(share.isConfirmed(true),true);
for(const v of [false,undefined,null,'true',0])assert.equal(share.isConfirmed(v),false);

const link='https://singer.andreway.ru/podborka/#key='+'a'.repeat(64);
const base={
 link,name:'Андрей',event:'Юбилей',phone:'+7 (918) 123-45-67',
 whatsappUrl:'https://wa.me/79181142693',telegramWeb:'https://t.me/shevtsov_andrey'
};
for(const purpose of ['wishes','order']){
 const result=share.build({...base,purpose});
 const wa=new URL(result.whatsapp);
 assert.equal(wa.origin,'https://wa.me');
 assert.equal(wa.pathname,'/79181142693');
 assert.equal(wa.searchParams.get('text'),result.message);
 const tg=new URL(result.telegram);
 assert.equal(tg.origin,'https://t.me');
 assert.equal(tg.pathname,'/shevtsov_andrey','Must open direct owner chat');
 assert.equal(tg.searchParams.get('text'),result.message);
 assert.ok(result.message.includes('Подборка песен:')&&result.message.includes(link));
 assert.ok(result.message.includes('Юбилей'));
 assert.ok(result.message.includes('+7 (918) 123-45-67'));
 assert.ok(!result.message.includes('выбрал(а)'));
 assert.equal(result.telegramUsername,'@shevtsov_andrey');
 const max=new URL(result.max);
 assert.equal(max.origin,'https://max.ru');
 assert.equal(max.pathname,'/:share');
 assert.equal(max.searchParams.get('text'),result.message);
 if(purpose==='wishes'){
  assert.match(result.message,/пожелания к (музыкальной )?программе/i);
  assert.doesNotMatch(result.message,/стоимост/i);
 }else{
  assert.match(result.message,/стоимост/i);
 }
}
assert.throws(()=>share.build({...base,link:'https://evil.invalid/#key='+'a'.repeat(64)}),/link/i);
assert.throws(()=>share.build({...base,purpose:'invalid'}),/purpose/i);

const dist=new URL('../../dist/',import.meta.url).pathname;
assert.ok(existsSync(dist+'js/request-share.js'),'Request share script missing from build');
const html=readFileSync(dist+'podborka/index.html','utf8');
for(const term of [
 'src="/js/request-share.js"',
 'src="/js/repertoire-cache.js"',
 'name="purpose"',
 'data-share="telegram"',
 'data-share="whatsapp"',
 'data-share="max"',
 'id="save-link"',
 'id="selected-dialog"',
 'id="show-selected"',
 'Сохранить себе подборку',
])assert.ok(html.includes(term),'Repertoire page missing '+term);
console.log('Request sharing passed: Telegram, WhatsApp, MAX and one-action form');
