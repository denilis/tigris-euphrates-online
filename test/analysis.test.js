// Разбор партии ботом (этап 5 пакета 04.11): движок и бот для браузера совпадают с game/vendor,
// разбор повторяет партию по записи и отличает сильную игру от случайной, сервер хранит разбор
// один раз и только в известном виде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { analyzeRecord, seededRng as coreRng, moveText, ANALYSIS_VERSION as CORE_V, EXACT } from '../public/js/analysis-core.js';
import { cleanAnalysis, ANALYSIS_VERSION as SERVER_V } from '../server/analysis.js';
import { seededRng } from '../game/random.js';
import { replayFrames } from '../game/frames.js';
import { botView } from '../game/bots.js';
import { decide } from '../game/vendor/bot/bot.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { stateFromJSON } from '../game/serialize.js';
import { submit, submitSeat } from '../game/table.js';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { started, playOut, makeRng, T0 } from './support.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const humansOf = (t) => t.seats.filter((s) => s.kind === 'human').map((s) => s.id);

test('движок и бот для браузера: public/vendor совпадает с game/vendor', () => {
  for (const dir of ['engine', 'bot']) {
    const src = new URL(`../game/vendor/${dir}/`, import.meta.url), dst = new URL(`../public/vendor/${dir}/`, import.meta.url);
    const files = readdirSync(src).filter((f) => f.endsWith('.js')).sort();
    assert.deepEqual(readdirSync(dst).filter((f) => f.endsWith('.js')).sort(), files, `${dir}: состав, запустите node tools/bot-sync.mjs`);
    // без учета переводов строк: git на Windows может хранить их по-разному в рабочей папке
    const text = (u) => readFileSync(u, 'utf8').split('\r\n').join('\n');
    for (const f of files) assert.equal(text(new URL(f, dst)), text(new URL(f, src)), `${dir}/${f}: запустите node tools/bot-sync.mjs`);
  }
});

test('генератор разбора тот же, что у записи партии', () => {
  const a = coreRng({ rng: 12345 }), b = seededRng({ rng: 12345 });
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
  assert.equal(CORE_V, SERVER_V, 'версия разбора одна у клиента и сервера');
});

test('разбор: у каждого человека действия, точность и до 5 ошибок на своих кадрах', () => {
  const t = started(63);
  playOut(t, 63);
  const res = analyzeRecord(t.game.rec, t.game.order, humansOf(t));
  const frames = replayFrames(t).frames;
  assert.deepEqual(Object.keys(res.players).map(Number).sort(), humansOf(t).sort());
  for (const [seat, p] of Object.entries(res.players)) {
    assert.ok(p.actions > 10);
    assert.ok(p.exact <= p.actions && p.accuracy >= 0 && p.accuracy <= 100);
    assert.ok(p.mistakes.length <= 5);
    p.mistakes.forEach((m, i) => {
      assert.ok(m.loss >= EXACT && m.loss <= 20);
      if (i) assert.ok(m.loss <= p.mistakes[i - 1].loss, 'по убыванию потери');
      const f = frames[m.k - 1];
      assert.equal(f.actor, +seat, 'кадр ошибки принадлежит этому игроку');
      assert.equal(f.turn, m.turn);
      assert.ok(m.played && m.best);
    });
  }
  assert.deepEqual(analyzeRecord(t.game.rec, t.game.order, humansOf(t)), res, 'одинаково при повторе');
  assert.ok(cleanAnalysis(JSON.parse(JSON.stringify(res)), humansOf(t)), 'сервер принимает разбор клиента');
});

test('разбор отличает сильную игру от случайной', () => {
  const t = started(64);
  const r = makeRng(5), draw = makeRng(6), strong = 0;
  for (let k = 0; t.status === 'playing' && k < 3000; k++) {
    const s = stateFromJSON(t.game.state), seatId = t.game.order[s.toMove], seat = t.seats.find((x) => x.id === seatId), legal = legalMoves(s);
    const m = seatId === strong
      ? decide(botView(t, seatId, 'exact', r), { strength: 60, counting: 'exact', risk: 50, errors: 0, style: 'universal', timeMs: 120 }, r).move
      : legal[Math.floor(r() * legal.length)];
    if (seat.kind === 'bot') submitSeat(t, seatId, m, { rng: draw, now: T0 });
    else submit(t, seat.userId, { version: t.version, index: legal.findIndex((x) => JSON.stringify(x) === JSON.stringify(m)) }, { rng: draw, now: T0 });
  }
  const res = analyzeRecord(t.game.rec, t.game.order, humansOf(t));
  const acc = (id) => res.players[id].accuracy;
  for (const id of humansOf(t).filter((x) => x !== strong)) assert.ok(acc(strong) > acc(id) + 30, `бот ${acc(strong)}%, случайный ${acc(id)}%`);
});

test('ход словами', () => {
  assert.equal(moveText({ type: 'tile', color: 0, pos: 52 }), 'красный тайл на E4');
  assert.equal(moveText({ type: 'leader', color: 3, pos: 103, from: 34 }), 'царь с C3 на H7');
  assert.equal(moveText({ type: 'catastrophe', pos: 0 }), 'катастрофа на A1');
  assert.equal(moveText({ type: 'discard', counts: [1, 0, 2, 0] }), 'сброс 3 тайлов');
  assert.equal(moveText({ type: 'pass' }), 'пас');
});

test('сервер: разбор пересобирается только из известных полей, чужое отвергается', () => {
  const good = { v: 1, players: { 0: { actions: 10, exact: 7, accuracy: 70, mistakes: [{ k: 3, turn: 2, action: 1, played: 'пас', best: 'красный тайл на A1', loss: 2.34, bestMove: { type: 'tile', color: 0, pos: 0, junk: 'x' }, extra: 1 }] } }, junk: true };
  const c = cleanAnalysis(good, [0]);
  assert.deepEqual(c, { v: 1, players: { 0: { actions: 10, exact: 7, accuracy: 70, mistakes: [{ k: 3, turn: 2, action: 1, played: 'пас', best: 'красный тайл на A1', loss: 2.3, bestMove: { type: 'tile', color: 0, pos: 0 } }] } } });
  assert.equal(cleanAnalysis({ ...good, v: 2 }, [0]), null, 'другая версия');
  assert.equal(cleanAnalysis(good, [0, 1]), null, 'нет игрока');
  const bad = (patch) => cleanAnalysis({ v: 1, players: { 0: { ...good.players[0], ...patch } } }, [0]);
  assert.equal(bad({ exact: 11 }), null);
  assert.equal(bad({ accuracy: 101 }), null);
  assert.equal(bad({ mistakes: Array(6).fill(good.players[0].mistakes[0]) }), null);
  assert.equal(bad({ mistakes: [{ ...good.players[0].mistakes[0], played: 'x'.repeat(81) }] }), null);
  assert.equal(bad({ mistakes: [{ ...good.players[0].mistakes[0], loss: 50 }] }), null);
});

test('API: запись после конца партии, разбор сохраняется один раз и только игроком, есть в просмотре', async () => {
  const store = memoryStore();
  const app = createApp({ store, env: ENV, now: () => T0, botOptions: { timeCap: 20 } });
  const playing = { ...started(65), code: 'PLAY03' };
  const mine = { ...started(66), code: 'MINE01' };
  playOut(mine, 66);
  const other = { ...started(67), code: 'OTHR01' };
  playOut(other, 67);
  const { token, user } = (await app.call({ method: 'POST', path: 'activate', body: { code: 'ADMN-TEST-2345' } })).body;
  mine.seats = mine.seats.map((s) => (s.name === 'Денис' ? { ...s, userId: user.id } : s));
  for (const t of [playing, mine, other]) assert.ok(await store.putTable(t, null));
  const call = (method, path, body) => app.call({ method, path, body, token });
  assert.equal((await app.call({ method: 'GET', path: 'tables/MINE01/record' })).status, 401);
  assert.equal((await call('GET', 'tables/PLAY03/record')).status, 409);
  assert.deepEqual((await call('GET', 'tables/PLAY03/analysis')).body, { analysis: null, can: false });
  const rec = await call('GET', 'tables/MINE01/record');
  assert.equal(rec.status, 200);
  assert.deepEqual(rec.body.humans, humansOf(mine));
  assert.deepEqual((await call('GET', 'tables/MINE01/analysis')).body, { analysis: null, can: true });
  const res = analyzeRecord(rec.body.rec, rec.body.order, rec.body.humans, { dets: 2 });
  assert.equal((await call('POST', 'tables/OTHR01/analysis', { analysis: res })).status, 403, 'не играл за этим столом');
  assert.equal((await call('POST', 'tables/MINE01/analysis', { analysis: { v: 1, players: {} } })).status, 400);
  const saved = await call('POST', 'tables/MINE01/analysis', { analysis: res });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.saved, true);
  const again = await call('POST', 'tables/MINE01/analysis', { analysis: { ...res, players: {} } });
  assert.equal(again.body.saved, false, 'первый разбор остается');
  assert.deepEqual(again.body.analysis, saved.body.analysis);
  assert.deepEqual((await call('GET', 'tables/MINE01/analysis')).body.analysis, saved.body.analysis);
  assert.deepEqual((await call('GET', 'tables/MINE01/replay')).body.analysis, saved.body.analysis);
});
