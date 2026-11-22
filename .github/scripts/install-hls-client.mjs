import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageFile = require.resolve('hls.js/package.json');
const source = join(dirname(packageFile), 'dist', 'hls.min.js');
const target = new URL('../../public/js/hls.min.js', import.meta.url);
mkdirSync(new URL('../../public/js/', import.meta.url), { recursive: true });
copyFileSync(source, target);
console.log('Bundled local hls.js player');
