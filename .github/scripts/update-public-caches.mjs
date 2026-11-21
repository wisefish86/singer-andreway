import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const base = 'https://script.google.com/macros/s/AKfycbzCtHUBRaC3c_Tovx6We58tVElMRn1w6FUkcLCdNZAVhDyLnVj8hut-_gKTXgov086tlg/exec';
const root = process.cwd();
const safeFile = name => typeof name === 'string' &&
  name.length > 0 && name.length < 241 && !/[\\/<>"|?*]/.test(name) && !name.includes('..');
async function get(kind) {
  const url = base+'?kind='+kind+'&v='+Date.now();
  const result = await fetch(url,{signal:AbortSignal.timeout(70000),redirect:'follow',headers:{accept:'application/json'}});
  if (!result.ok) throw Error(kind+' returned HTTP '+result.status);
  const json = await result.json();
  if (!json || typeof json !== 'object') throw Error('Invalid '+kind+' payload');
  return json;
}
async function save(path, data) {
  const contents = JSON.stringify(data, null, 2)+'\n';
  await mkdir(join(root,'public','data'),{recursive:true});
  await writeFile(join(root,'public','data',path),contents);
}
const [events,media] = await Promise.all([get('events'),get('media')]);
if (!Array.isArray(events.events) || !Array.isArray(media.videos) || !Array.isArray(media.photos)) throw Error('Missing public arrays');
const allowed = (list,kind) => list.filter(row => safeFile(row.file)
  && (kind==='videos'?/\.(mp4|webm)$/i:/\.(jpe?g|png|webp|avif)$/i).test(row.file))
  .map(row => ({
    title:String(row.title||'').slice(0,120),
    file:row.file,
    description:String(row.description||'').slice(0,280),
    cover:kind==='videos' && safeFile(row.cover)?row.cover:''
  }));
const catalog={videos:allowed(media.videos,'videos'),photos:allowed(media.photos,'photos')};
const list=events.events.filter(e => Number.isFinite(Date.parse(e.start)) && Number.isFinite(Date.parse(e.end)))
  .map(e=>({
    title:String(e.title||'').slice(0,160).replace(/\s*\(\s*\d+\s*[кk]\s*\)/gi,''),
    start:e.start, end:e.end,
    location:String(e.location||'').slice(0,320)
  }))
  .sort((a,b)=>a.start.localeCompare(b.start));
await save('afisha.public.json',{events:list});
await writeFile(join(root,'public','media-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
console.log('Updated public snapshots:',list.length,'events;',catalog.videos.length,'videos;',catalog.photos.length,'photos');
