// «Что бы сделал бот?» (15.11): два хода в начале хода, только своему игроку, в его ход и вне зачета.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { hintText, hintMarks } from '../public/js/hint-core.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const first = async (view) => ({ move: legalMoves(view.state)[0] }); // быстрый «бот» для проверок прав

async function setup(botOptions = { timeCap: 20 }) {
  const app = createApp({ store: memoryStore(), env: ENV, now: () => 1_800_000_000_000, botOptions });
  const req = (method, path, body, token, query) => app.call({ method, path, body, token, query });
  const denis = (await req('POST', 'activate', { code: 'ADMN-TEST-2345' })).body;
  const mk = async (name) => (await req('POST', 'activate', { code: (await req('POST', 'admin/users', { name }, denis.token)).body.code })).body;
  return { req, denis, mk };
}

async function table(s, { other = null, tournament = null } = {}) {
  const { req, denis } = s;
  const { code } = (await req('POST', 'tables', undefined, denis.token)).body;
  const act = (b, tok = denis.token) => req('POST', `tables/${code}`, b, tok);
  await act({ action: 'seatCount', n: 2 });
  if (other) {
    await act({ action: 'sit', seat: 1 }, other.token);
    await act({ action: 'hero', seat: 1, hero: 'bull' }, other.token);
    await req('GET', `tables/${code}/poll`, undefined, other.token, { here: '1' }); // на месте за столом
  } else await act({ action: 'seatKind', seat: 1, kind: 'bot' });
  await act({ action: 'options', options: { order: 'custom', ...(tournament ? { tournament } : {}) } });
  const r = await act({ action: 'start' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { code, view: r.body };
}

test('стол с ботом: два хода настоящего бота, оба допустимы по очереди', async () => {
  const s = await setup();
  const { code, view } = await table(s);
  assert.equal(view.hintOk, true);
  assert.equal(view.game.toMove, 0, 'первым ходит человек');
  const r = await s.req('POST', `tables/${code}/hint`, {}, s.denis.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.moves.length, r.body.moves[0].type === 'discard' ? 1 : 2);
  assert.ok(view.game.legal.some((m) => JSON.stringify(m) === JSON.stringify(r.body.moves[0])), 'первый ход есть среди допустимых');
  const idx = view.game.legal.findIndex((m) => JSON.stringify(m) === JSON.stringify(r.body.moves[0]));
  const after = await s.req('POST', `tables/${code}`, { action: 'move', version: view.version, index: idx }, s.denis.token);
  assert.equal(after.status, 200, JSON.stringify(after.body));
  if (r.body.moves[1] && after.status === 200 && after.body.game.phase === 'action') {
    assert.ok(after.body.game.legal.some((m) => JSON.stringify(m) === JSON.stringify(r.body.moves[1])), 'второй ход допустим после первого');
  }
});

test('подсказка не меняет стол', async () => {
  const s = await setup({ timeCap: 20, hintDecide: first });
  const { code } = await table(s);
  const before = (await s.req('GET', `tables/${code}`, undefined, s.denis.token)).body;
  await s.req('POST', `tables/${code}/hint`, {}, s.denis.token);
  const after = (await s.req('GET', `tables/${code}`, undefined, s.denis.token)).body;
  assert.equal(after.version, before.version);
  assert.deepEqual(after.game.players, before.game.players);
});

test('двое людей: в зачете подсказки нет, без галочки зачета есть', async () => {
  const s = await setup({ timeCap: 20, hintDecide: first });
  const petya = await s.mk('Петя');
  const rated = await table(s, { other: petya });
  assert.equal(rated.view.hintOk, undefined);
  assert.equal((await s.req('POST', `tables/${rated.code}/hint`, {}, s.denis.token)).status, 403);
  const free = await table(s, { other: petya, tournament: 'none' });
  assert.equal(free.view.hintOk, true);
  assert.equal((await s.req('POST', `tables/${free.code}/hint`, {}, s.denis.token)).status, 200);
  assert.equal((await s.req('POST', `tables/${free.code}/hint`, {}, petya.token)).status, 409, 'не его ход');
});

test('чужому и слишком часто нельзя', async () => {
  const s = await setup({ timeCap: 20, hintDecide: first });
  const { code } = await table(s);
  const vasya = await s.mk('Вася');
  assert.equal((await s.req('POST', `tables/${code}/hint`, {}, vasya.token)).status, 403);
  assert.equal((await s.req('POST', `tables/${code}/hint`)).status, 401);
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await s.req('POST', `tables/${code}/hint`, {}, s.denis.token)).status;
  assert.equal(last, 429);
});

test('ход словами и метки на поле', () => {
  assert.equal(hintText({ type: 'tile', color: 0, pos: 20 }), 'храм на E2');
  assert.equal(hintText({ type: 'leader', color: 3, pos: 33 }), 'царь на B3');
  assert.equal(hintText({ type: 'catastrophe', pos: 0 }), 'катастрофа на A1');
  assert.equal(hintText({ type: 'discard', counts: [1, 0, 2, 0] }), 'сбросить 3 тайла');
  assert.equal(hintText({ type: 'pass' }), 'пас');
  assert.deepEqual(hintMarks([{ type: 'tile', color: 0, pos: 20 }, { type: 'pass' }, { type: 'monument', id: 1, tl: 5 }]), [{ pos: 20, n: 1 }, { pos: 5, n: 3 }]);
});
