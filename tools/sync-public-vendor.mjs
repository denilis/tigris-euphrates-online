// Движок и бот для браузера (разбор партии ботом, этап 5 пакета 04.11): копия game/vendor/engine
// и game/vendor/bot в public/vendor, чтобы разбор считал браузер, а не сервер. Источник правды
// остается tigris-bot через game/vendor (tools/sync-engine.js); после него запустить и этот
// инструмент. Тест test/public-vendor.test.js проверяет, что копия совпадает байт в байт.
//   node tools/sync-public-vendor.mjs
import { mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_VENDOR_DIRS = ['engine', 'bot'];

for (const dir of PUBLIC_VENDOR_DIRS) {
  const src = path.join(root, 'game', 'vendor', dir), dst = path.join(root, 'public', 'vendor', dir);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  const files = readdirSync(src).filter((f) => f.endsWith('.js'));
  for (const f of files) copyFileSync(path.join(src, f), path.join(dst, f));
  console.log(dir, files.length, 'файлов');
}
