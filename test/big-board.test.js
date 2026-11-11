// Большое поле 19x13 (Денис 10.11): стол с таким полем собирается и начинается обычными
// запросами, вид партии несет 247 клеток и порог 3 сокровища, поле рисуется своим размером,
// обычные столы не меняются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { renderBoard } from '../public/js/board.js';
import { useBoard, cellName, W, H, treasureEnd } from '../public/js/util.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const fakeSvg = () => {
  const dyn = { innerHTML: '' }, attrs = {};
  return { dataset: {}, innerHTML: '', attrs, setAttribute(k, v) { attrs[k] = v; }, querySelector: () => dyn };
};

async function startTable(board) {
  const app = createApp({ store: memoryStore(), env: ENV, now: () => 1_800_000_000_000, botOptions: { timeCap: 20 } });
  const req = (method, path, body, token) => app.call({ method, path, body, token });
  const { token } = (await req('POST', 'activate', { code: 'ADMN-TEST-2345' })).body;
  const { code } = (await req('POST', 'tables', undefined, token)).body;
  for (const seat of [1, 2]) await req('POST', `tables/${code}`, { action: 'seatKind', seat, kind: 'bot' }, token);
  const o = await req('POST', `tables/${code}`, { action: 'options', options: { board } }, token);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const r = await req('POST', `tables/${code}`, { action: 'start' }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('большое поле: стол начинается, вид партии на 247 клеток', async () => {
  const view = await startTable('big');
  const g = view.game;
  assert.equal(view.options.board, 'big');
  assert.equal(g.board.tile.length, 247);
  assert.deepEqual([...g.river].sort((a, b) => a - b), BOARDS.big.river);
  assert.equal(g.board.treasure.reduce((a, b) => a + b, 0), 20);
  assert.equal(g.treasureEnd, 3);
  assert.equal(g.bagStart, 215 - 20);
  assert.ok(g.bagPct > 80 && g.bagPct <= 100);
  assert.deepEqual([...g.special].sort((a, b) => a - b), [...BOARDS.big.special].sort((a, b) => a - b));
});

test('обычное поле: вид партии прежний, порога в нем нет', async () => {
  const g = (await startTable('advanced')).game;
  assert.equal(g.board.tile.length, 176);
  assert.ok(!('treasureEnd' in g));
  assert.equal(treasureEnd(g), 2);
  assert.equal(g.bagStart, 153 - 14);
});

test('большое поле: рисуется полотном 19x13 с руслом, потом обычное снова 16x11', async () => {
  const big = (await startTable('big')).game;
  const svg = fakeSvg();
  renderBoard(svg, big, () => 'pot', {}, 'relief');
  assert.deepEqual([W, H], [19, 13]);
  assert.equal(svg.attrs.viewBox, `0 0 ${24 + 19 * 60 + 6} ${24 + 13 * 60 + 6}`);
  assert.match(svg.innerHTML, /class="stream"/, 'река руслом, а не заливкой клеток');
  assert.match(svg.innerHTML, />S<\/text>/, 'подпись столбца S');
  assert.equal(cellName(246), 'S13');
  const small = (await startTable('standard')).game;
  const svg2 = fakeSvg();
  renderBoard(svg2, small, () => 'pot', {}, 'relief');
  assert.deepEqual([W, H], [16, 11]);
  assert.equal(svg2.attrs.viewBox, `0 0 ${24 + 16 * 60 + 6} ${24 + 11 * 60 + 6}`);
  assert.equal(cellName(175), 'P11');
  useBoard(176);
});

test('лобби и шапка партии: большое поле можно выбрать и оно подписано', () => {
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(src('../public/js/lobby.js'), /data-board="big"[^>]*>Большое поле<\/button>/);
  assert.match(src('../public/js/game.js'), /o\.board === 'big' \? 'Большое поле'/);
});
