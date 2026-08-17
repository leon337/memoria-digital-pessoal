import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'apps/web/dist';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const required of [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'logo.svg',
  'pwa-64x64.png',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'maskable-icon-512x512.png',
  'apple-touch-icon-180x180.png',
  'favicon.ico',
]) {
  assert(existsSync(join(dist, required)), `missing PWA build artifact: ${required}`);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
assert(manifest.id === '/', 'manifest id must be /');
assert(manifest.start_url === '/', 'manifest start_url must be /');
assert(manifest.scope === '/', 'manifest scope must be /');
assert(manifest.display === 'standalone', 'manifest display must be standalone');
assert(manifest.lang === 'pt-BR', 'manifest lang must be pt-BR');
assert(
  manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'),
  'manifest must contain 192x192 PNG icon',
);
assert(
  manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'),
  'manifest must contain 512x512 PNG icon',
);
assert(
  manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'),
  'manifest must contain maskable 512x512 icon',
);

const index = readFileSync(join(dist, 'index.html'), 'utf8');
assert(index.includes('manifest.webmanifest'), 'index.html must reference generated manifest');

const javascript = walk(dist)
  .filter((path) => path.endsWith('.js'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

for (const forbidden of [
  'http://127.0.0.1:3000',
  '/memories',
  'BackgroundSyncPlugin',
  'workbox-background-sync',
]) {
  assert(
    !javascript.includes(forbidden),
    `forbidden Service Worker/API cache marker: ${forbidden}`,
  );
}

const serviceWorker = readFileSync(join(dist, 'sw.js'), 'utf8');
assert(
  serviceWorker.includes('index.html'),
  'Service Worker must precache/navigation-fallback index.html',
);
assert(
  serviceWorker.includes('SKIP_WAITING'),
  'prompt update worker must support explicit SKIP_WAITING message',
);

console.log('Slice03 PWA build verification passed.');
