// Сборка из GitHub выключена (15.11): push в main собирал Production без видео (public/media нет в git),
// так было 13.11 и 14.11. Выкладка только через vercel deploy --prod из копии коммита с видео.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('vercel.json: Vercel не собирает сайт из GitHub', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(cfg.git?.deploymentEnabled, false);
});
