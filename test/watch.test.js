// Наблюдение за столом: ответ, пришедший после ухода со стола, не должен затирать другую страницу.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// api.js при загрузке читает адрес и хранилище браузера
const memory = { getItem: () => null, setItem() {}, removeItem() {} };
Object.assign(globalThis, {
  location: { search: '', hostname: 'example.test' },
  localStorage: memory,
  sessionStorage: memory,
  document: { hidden: false, addEventListener() {}, removeEventListener() {} },
  window: { dispatchEvent() {} },
});
const { watchTable } = await import('../public/js/api.js');

const answer = (body) => ({ ok: true, status: 200, json: async () => body });
const flush = () => new Promise((r) => setTimeout(r, 0));

test('пока наблюдаем, вид доходит до страницы', async () => {
  globalThis.fetch = async () => answer({ version: 1 });
  const seen = [];
  const w = watchTable('ABCDEF', (v) => seen.push(v.version));
  await flush();
  w.stop();
  assert.deepEqual(seen, [1]);
});

test('вид, пришедший после остановки, отбрасывается', async () => {
  let release;
  globalThis.fetch = () => new Promise((r) => { release = () => r(answer({ version: 1 })); });
  const seen = [];
  const w = watchTable('ABCDEF', (v) => seen.push(v.version));
  w.stop();
  release();
  await flush();
  assert.deepEqual(seen, []);
});
