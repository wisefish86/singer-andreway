import { readFile, writeFile, mkdir } from 'node:fs/promises';

const parts = [
  '.asset-source/hero-v2.b64.00',
  '.asset-source/hero-v5.b64.01',
  '.asset-source/hero-v5.b64.02',
  '.asset-source/hero-v5.b64.03'
];

const chunks = await Promise.all(parts.map((p) => readFile(p, 'utf8')));
const data = Buffer.from(chunks.join('').replace(/\s+/g, ''), 'base64');

if (data.length < 50000 || data.subarray(0, 4).toString('ascii') !== 'RIFF' || data.subarray(8, 12).toString('ascii') !== 'WEBP') {
  throw new Error('Hero WebP reconstruction failed validation');
}

await mkdir('public/images', { recursive: true });
await writeFile('public/images/hero-main.webp', data);

console.log('hero-main.webp restored:', data.length, 'bytes');
