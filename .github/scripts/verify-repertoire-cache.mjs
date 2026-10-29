import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../../public/js/repertoire-cache.js',import.meta.url),'utf8');
let clock=100000000;
const items=new Map();
const localStorage={
 getItem(key){return items.get(key)||null},
 setItem(key,val){items.set(key,val)},
};
const window={};
runInNewContext(source,{window,localStorage,Date:{now:()=>clock}});
const cache=window.SingerRepertoireCache;
const catalogue={schema_version:5,generated_at:'2026-10-29T11:28:09',song_count:1,
 songs:[{id:'a',artist:'A',name:'Song'}],facets:{language:[]}};
assert.equal(cache.read(),null);
assert.equal(cache.write(catalogue),true);
assert.equal(cache.read().songs[0].name,'Song');
assert.equal(cache.updated(catalogue,catalogue),false);
assert.equal(cache.updated(catalogue,{...catalogue,generated_at:'2026-10-30T11:00:00'}),true);
assert.equal(cache.write({songs:[],facets:{}}),false);
clock+=25*60*60*1000;
assert.equal(cache.read(),null,'Expired catalogues must not stay pinned');
items.set('singer-repertoire:catalogue:v1','{invalid');
assert.equal(cache.read(),null,'Broken storage must not prevent network fallback');

const disabled={getItem(){throw Error('Storage disabled')},setItem(){throw Error('Storage disabled')}};
const isolated={};
runInNewContext(source,{window:isolated,localStorage:disabled,Date:{now:()=>clock}});
assert.equal(isolated.SingerRepertoireCache.read(),null);
assert.equal(isolated.SingerRepertoireCache.write(catalogue),false);

const dist=new URL('../../dist/',import.meta.url).pathname;
assert.ok(existsSync(dist+'js/repertoire-cache.js'));
const page=readFileSync(dist+'podborka/index.html','utf8');
for(const text of ['src="/js/repertoire-cache.js"','id="player-state"','id="purpose"','preload="metadata"']) {
 assert.ok(page.includes(text),'Missing optimization '+text);
}
assert.ok(!page.includes("cache:'no-store'"),'Catalogue must not bypass HTTP cache');
assert.ok(page.includes("cache:'no-cache'"),'Network revalidation must remain enabled');
console.log('Repertoire cache and progressive audio markup tests passed');
