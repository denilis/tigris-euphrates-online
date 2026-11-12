// Движок и бот сайта (game/vendor, с 12.11.2026 основной код, tigris-bot закрыт): метка версии в
// version.js совпадает с текстами engine/ и bot/, то есть после правки не забыли node tools/bot-sync.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ENGINE } from '../game/vendor/version.js';
import { codeHash } from '../tools/bot-sync.mjs';

test('метка версии бота совпадает с кодом (иначе node tools/bot-sync.mjs)', () => {
  assert.match(ENGINE.hash, /^[0-9a-f]{64}$/);
  assert.equal(ENGINE.hash, codeHash(), 'код движка или бота изменен, запустите node tools/bot-sync.mjs');
});

test('связки с tigris-bot больше нет', () => {
  assert.equal(existsSync(new URL('../game/vendor/MANIFEST.json', import.meta.url)), false);
  assert.equal(existsSync(new URL('../tools/sync-engine.js', import.meta.url)), false);
});
