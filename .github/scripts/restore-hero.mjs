import { readFile, writeFile, mkdir } from 'node:fs/promises';

const parts = [
  '.asset-source/hero-v5.b64.00',
  '.asset-source/hero-v5.b64.01',
  '.asset-source/hero-v5.b64.02',
  '.asset-source/hero-v5.b64.03'
];

const chunks = await Promise.all(parts.map((p) => readFile(p, 'utf8')));
const data = Buffer.from(chunks.join('').replace(/\s+/g, ''), 'base64');

await mkdir('public/images', { recursive: true });
await writeFile('public/images/hero-main.webp', data);

console.log('hero-main.webp restored:', data.length, 'bytes');
