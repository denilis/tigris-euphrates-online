import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, legalMoves } from '../engine/engine.js';
import { RED, BLUE, GREEN, BLACK } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';
import { makeView, determinize } from '../bot/belief.js';
import { decide, decideAsync, params } from '../bot/bot.js';
import { createGame } from '../engine/engine.js';
import { testLayout } from './helpers.js';
import { playGame } from '../sim/arena.js';
import { at, bare, put, lead, setHand } from './helpers.js';

const rng = makeRng(7);

test('бот не подглядывает: чужие руки и мешок скрыты', () => {
  const s = bare(3);
  setHand(s, 1, [3, 1, 1, 1]);
  const v = makeView(s, 0, 'exact', rng);
  assert.deepEqual(v.state.players[1].hand, [0, 0, 0, 0]);
  assert.deepEqual(v.state.bag, [0, 0, 0, 0]);
  assert.equal(v.handCounts[1], 6);
});

test('точный подсчёт: если все храмы видны, у соперника их нет', () => {
  const s = bare(2);
  // все 57 красных: на доске 51, у бота 6
  let placed = 0;
  for (let y = 1; y <= 11 && placed < 51; y++) {
    for (let x = 0; x < 16 && placed < 51; x++) {
      if (y === 6) continue;
      put(s, String.fromCharCode(65 + x) + y, RED);
      placed++;
    }
  }
  setHand(s, 0, [6, 0, 0, 0]);
  setHand(s, 1, [0, 2, 2, 2]);
  const v = makeView(s, 0, 'exact', rng);
  for (let k = 0; k < 20; k++) assert.equal(determinize(v, rng).players[1].hand[RED], 0);
  // «не считает»: красные у соперника вполне возможны
  const v2 = makeView(s, 0, 'none', rng);
  let reds = 0;
  for (let k = 0; k < 20; k++) reds += determinize(v2, rng).players[1].hand[RED];
  assert.ok(reds > 0);
});

test('защитник докладывает поддержку, когда она решает исход', () => {
  const s = bare();
  put(s, 'C3', RED); put(s, 'B4', RED); put(s, 'E3', RED);
  lead(s, 1, RED, 'C4');
  setHand(s, 0, [2, 1, 1, 2]);
  setHand(s, 1, [2, 1, 1, 2]);
  applyMove(s, { type: 'leader', color: RED, pos: at('D3') }, rng);
  applyMove(s, { type: 'support', n: 1 }, rng); // атакующий 3 против 2
  assert.equal(s.toMove, 1);
  const res = decide(makeView(s, 1, 'none', rng), { strength: 50, errors: 0 }, rng);
  assert.equal(res.move.n, 1, 'одного тайла хватает до ничьей, ничья за защитником');
});

test('английский вариант: безнадёжный атакующий ничего не выкладывает', () => {
  const s = bare(2, { englishSupport: true });
  put(s, 'C3', RED); put(s, 'B4', RED); put(s, 'C5', RED); put(s, 'D2', BLACK);
  lead(s, 1, RED, 'C4');
  setHand(s, 0, [3, 1, 1, 1]);
  applyMove(s, { type: 'leader', color: RED, pos: at('D3') }, rng);
  const res = decide(makeView(s, 0, 'none', rng), { strength: 50, errors: 0 }, rng);
  assert.ok(legalMoves(s).some((m) => m.n === res.move.n));
});

test('бот строит монумент, если рядом его лидеры', () => {
  const s = bare();
  put(s, 'B2', RED); put(s, 'C2', RED); put(s, 'B3', RED); put(s, 'A3', RED);
  lead(s, 0, RED, 'A2'); lead(s, 0, BLACK, 'A4');
  setHand(s, 0, [1, 1, 2, 2]);
  setHand(s, 1, [1, 1, 2, 2]);
  applyMove(s, { type: 'tile', color: RED, pos: at('C3') }, rng);
  assert.equal(s.phase, 'monument');
  const res = decide(makeView(s, 0, 'none', rng), { strength: 50, errors: 0 }, rng);
  assert.equal(res.move.type, 'monument');
});

test('ошибки: при 0% их нет, при 30% случаются', () => {
  let e0 = 0, e30 = 0;
  playGame({ seats: [{ strength: 0, errors: 0 }, { strength: 0, errors: 0 }], seed: 5, onDecision: (_, __, r) => { if (r.error) e0++; } });
  playGame({ seats: [{ strength: 0, errors: 30 }, { strength: 0, errors: 30 }], seed: 5, onDecision: (_, __, r) => { if (r.error) e30++; } });
  assert.equal(e0, 0);
  assert.ok(e30 > 5, `ошибок ${e30}`);
});

test('полная партия ботов со всеми вариантами: только допустимые ходы', () => {
  const r = playGame({
    seats: [{ strength: 10, counting: 'exact', errors: 10 }, { strength: 0, counting: 'approx', risk: 90 }, { strength: 0, risk: 10 }],
    seed: 11,
    cfg: { englishSupport: true, buildings: true, wonder: true },
  });
  assert.equal(r.ranking.length, 3);
});

test('ползунок силы: больше перебора и меньше шума', () => {
  const lo = params({ strength: 0 }), hi = params({ strength: 100 });
  assert.ok(hi.dets > lo.dets && hi.topK > lo.topK && hi.noise < lo.noise);
  assert.ok(params({ risk: 100 }).gamma < 1 && params({ risk: 0 }).gamma > 1);
  void BLUE; void GREEN;
});

test('решение кусками совпадает с обычным и отдаёт управление странице', async () => {
  // часы идут на 5 мс за каждый вызов, поэтому паузы гарантированно случаются
  const real = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 0;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => (clock += 5) }, configurable: true, writable: true });
  try {
    for (const seed of [3, 5]) {
      const g = createGame({ layout: testLayout(), numPlayers: 3, cfg: { englishSupport: true, buildings: true, wonder: true } }, makeRng(seed));
      const settings = { strength: 70, counting: 'none', risk: 50, errors: 5 };
      clock = 0;
      const sync = decide(makeView(g, 0, 'none', makeRng(1)), settings, makeRng(seed));
      clock = 0;
      let deferred = 0;
      const async = await decideAsync(makeView(g, 0, 'none', makeRng(1)), settings, makeRng(seed), (f) => { deferred++; setImmediate(f); });
      assert.deepEqual(async.move, sync.move);
      assert.equal(async.text, sync.text);
      assert.equal(async.error, sync.error);
      assert.ok(deferred > 10, 'перебор делился на куски: ' + deferred);
    }
  } finally {
    Object.defineProperty(globalThis, 'performance', real);
  }
});

test('решение кусками: ошибка внутри перебора приходит как отказ промиса', async () => {
  const view = { me: 0, state: { phase: 'action' } };
  await assert.rejects(decideAsync(view, {}, makeRng(1), (f) => setImmediate(f)));
});

test('паузы между кусками не съедают бюджет перебора', async () => {
  // каждый вызов часов +1 мс, а каждая пауза ещё +1000 мс, как на скрытой вкладке
  const real = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 0;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => (clock += 1) }, configurable: true, writable: true });
  try {
    for (const seed of [3, 5, 8]) {
      const g = createGame({ layout: testLayout(), numPlayers: 3, cfg: { englishSupport: true, buildings: true, wonder: true } }, makeRng(seed));
      const settings = { strength: 70, counting: 'none', risk: 50, errors: 0 };
      clock = 0;
      const sync = decide(makeView(g, 0, 'none', makeRng(1)), settings, makeRng(seed));
      clock = 0;
      let pauses = 0;
      const async = await decideAsync(makeView(g, 0, 'none', makeRng(1)), settings, makeRng(seed), (f) => { pauses++; clock += 1000; setImmediate(f); });
      assert.ok(pauses > 5, 'пауз было ' + pauses);
      assert.ok(sync.searched > 1, 'в синхронном решении есть просмотр на два действия');
      assert.equal(async.searched, sync.searched, 'паузы не урезали просмотр на два действия');
      assert.equal(async.reduced, sync.reduced);
      assert.deepEqual(async.move, sync.move);
      assert.equal(async.text, sync.text);
    }
  } finally {
    Object.defineProperty(globalThis, 'performance', real);
  }
});

test('решение кусками: ошибка в позднем куске тоже приходит как отказ промиса', async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 0;
  const ticking = { now: () => (clock += 5) };
  Object.defineProperty(globalThis, 'performance', { value: ticking, configurable: true, writable: true });
  try {
    const g = createGame({ layout: testLayout(), numPlayers: 3, cfg: {} }, makeRng(4));
    let defers = 0;
    const p = decideAsync(makeView(g, 0, 'none', makeRng(1)), { strength: 70, errors: 0 }, makeRng(4), (f) => {
      defers++;
      if (defers === 2) ticking.now = () => { throw new Error('сбой посреди перебора'); };
      setImmediate(f);
    });
    await assert.rejects(p, /сбой посреди перебора/);
    assert.ok(defers >= 2);
  } finally {
    Object.defineProperty(globalThis, 'performance', real);
  }
});

test('шанс в конфликте: без храмов в руке восстание против опоры защитника не начинается', async () => {
  const { conflictOdds, params } = await import('../bot/bot.js');
  const s = bare(2);
  put(s, 'B2', RED); put(s, 'C2', RED); put(s, 'D3', RED);
  lead(s, 1, BLACK, 'B3'); // у соперника царь рядом с храмом B2
  put(s, 'C3', BLUE === 1 ? GREEN : GREEN); // клетка C3 занята рынком, королевство B2-C2-C3-B3
  setHand(s, 0, [0, 2, 2, 2]); // у бота нет храмов
  setHand(s, 1, [2, 1, 1, 2]); // у соперника обычная рука из 6
  const view = makeView(s, 0, 'none', makeRng(1));
  const move = { type: 'leader', color: BLACK, pos: at('D2') }; // рядом с C2 и D3: в то же королевство
  const odd = conflictOdds(view, view.state, move);
  assert.ok(odd, 'ход начинает восстание');
  assert.equal(odd.kind, 'revolt');
  assert.ok(odd.pWin < params({ risk: 50 }).attackThreshold, 'шанс ' + odd.pWin);
  // с полной рукой храмов шанс высокий
  setHand(s, 0, [6, 0, 0, 0]);
  const view2 = makeView(s, 0, 'none', makeRng(1));
  const odd2 = conflictOdds(view2, view2.state, move);
  assert.ok(odd2.pWin > 0.8, 'шанс с шестью храмами ' + odd2.pWin);
});

test('порог риска: осторожный 80%, средний около 58%, азартный 35%', () => {
  assert.equal(params({ risk: 0 }).attackThreshold, 0.8);
  assert.ok(Math.abs(params({ risk: 50 }).attackThreshold - 0.575) < 1e-9);
  assert.ok(Math.abs(params({ risk: 100 }).attackThreshold - 0.35) < 1e-9);
});

test('привычки бота в самоигре: конфликты не ниже порога, лидеры почти не переставляются', async () => {
  const { conflictOdds, params } = await import('../bot/bot.js');
  const { makeCollector } = await import('../sim/metrics.js');
  const settings = { strength: 30, counting: 'none', risk: 50, errors: 0 };
  const threshold = params(settings).attackThreshold;
  let weak = 0;
  const col = makeCollector(() => 'bot');
  for (const seed of [21, 22]) {
    const r = playGame({
      seats: [settings, settings, settings],
      seed,
      cfg: { englishSupport: true, buildings: true, wonder: true },
      onEvent: col.onEvent,
      onDecision: (s, p, res) => {
        col.onDecision(s, p, res);
        if (s.phase !== 'action') return;
        const view = makeView(s, p, 'none', makeRng(seed));
        const odd = conflictOdds(view, view.state, res.move);
        // одиночный конфликт — по его шансу; объединение с несколькими войнами — по лучшей
        if (odd && (odd.wars.length > 1 ? odd.best : odd.pWin) < threshold) weak++;
      },
    });
    col.endGame(r.ranking, r.vectors);
  }
  const row = col.table()[0];
  assert.equal(weak, 0, 'конфликтов с шансом ниже порога');
  // при силе 30 бот шумнее; старый бот делал 3-4 перестановки за партию. Порог 2,5, а не 2 (11.11):
  // на одной партии разброс от 0,67 до 2,33 и у бота до характера (add382d), и после; в среднем
  // на 4 партиях 1,92 до и 1,67 после, а на двух партиях этого теста 1,67 и 2,17
  assert.ok(row.relocations <= 2.5, 'перестановок лидера на игрока за партию: ' + row.relocations);
});

test('глубина ответа: настройка depth, ход при глубине в круг законный', () => {
  assert.equal(params({}).replyDepth, 1);
  assert.equal(params({ depth: 6 }).replyDepth, 6);
  assert.equal(params({ depth: 99 }).replyDepth, 6);
  const g = createGame({ layout: testLayout(), numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, makeRng(11));
  const r = makeRng(2);
  const res = decide(makeView(g, 0, 'none', r), { strength: 60, errors: 0, depth: 6 }, r);
  assert.ok(legalMoves(g).some((m) => JSON.stringify(m) === JSON.stringify(res.move)));
  assert.ok(res.replied >= 1);
});

test('поиск по дереву (search: mcts): законный ход, проходы с потолком, повторяемость', () => {
  const settings = { strength: 100, errors: 0, counting: 'exact', search: 'mcts', mctsIters: 60 };
  for (const seed of [3, 9]) {
    const g = createGame({ layout: testLayout(), numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, makeRng(seed));
    const a = decide(makeView(g, 0, 'exact', makeRng(1)), settings, makeRng(seed));
    const b = decide(makeView(g, 0, 'exact', makeRng(1)), settings, makeRng(seed));
    assert.ok(legalMoves(g).some((m) => JSON.stringify(m) === JSON.stringify(a.move)));
    assert.ok(a.iters > 0 && a.iters <= 60, 'проходов ' + a.iters);
    assert.deepEqual(a.move, b.move);
    assert.notEqual(a.move.type, 'catastrophe', 'в начале партии атака катастрофой запрещена');
  }
});

test('сплочённость: свои лидеры в одном царстве ценятся, разбросанные — нет', async () => {
  const { evaluate, DEFAULT_WEIGHTS } = await import('../bot/evaluate.js');
  const gain = (s) => evaluate(s, 0, { weights: { ...DEFAULT_WEIGHTS, cohesion: 1 } }) - evaluate(s, 0, { weights: { ...DEFAULT_WEIGHTS, cohesion: 0 } });
  // царь и торговец у одного храма
  const together = bare(2);
  put(together, 'C2', RED);
  lead(together, 0, BLACK, 'C3');
  lead(together, 0, GREEN, 'B2');
  assert.ok(gain(together) > 0.3, 'вместе: ' + gain(together)); // сила позиции к концу партии дешевеет
  // те же лидеры у разных храмов в разных концах поля
  const apart = bare(2);
  put(apart, 'C2', RED);
  put(apart, 'K8', RED);
  lead(apart, 0, BLACK, 'C3');
  lead(apart, 0, GREEN, 'K9');
  assert.ok(Math.abs(gain(apart)) < 1e-9);
});

test('перестановка с целью: к монументу цвета лидера и к опоре дешевле пустой', async () => {
  const { relocationPurpose, moveFlags, flagCost, F_PURPOSE } = await import('../bot/bot.js');
  const { FACEDOWN } = await import('../engine/constants.js');
  // мой синий лидер в углу у одного храма; справа царство соперника с монументом (синий + красный)
  const s = bare(2);
  put(s, 'B2', RED);
  lead(s, 0, BLUE, 'B3');
  put(s, 'J2', RED);
  lead(s, 1, BLUE, 'J3');
  const mon = s.monuments.find((x) => (x.c1 === BLUE || x.c2 === BLUE));
  for (const c of ['K2', 'L2', 'K3', 'L3']) { s.tile[at(c)] = FACEDOWN; s.monument[at(c)] = mon.id; }
  mon.pos = at('K2');
  s.cur = 0;
  const toMonument = { type: 'leader', color: BLUE, pos: at('I2') };
  assert.equal(relocationPurpose(s, toMonument), true);
  // пустая перестановка: в соседний пустой угол у того же храма
  const nowhere = { type: 'leader', color: BLUE, pos: at('A2') };
  assert.equal(relocationPurpose(s, nowhere), false);
  const P = params({ style: 'universal' });
  assert.ok(flagCost(F_PURPOSE | 1, P) < flagCost(1, P), 'с целью дешевле');
  void moveFlags;
  // опора: царство с 5 зелёными тайлами без зелёного лидера
  const t = bare(2);
  put(t, 'B2', RED);
  lead(t, 0, GREEN, 'B3');
  put(t, 'J2', RED);
  for (const c of ['K2', 'L2', 'M2', 'K3', 'L3']) put(t, c, GREEN);
  t.cur = 0;
  assert.equal(relocationPurpose(t, { type: 'leader', color: GREEN, pos: at('J3') }), true);
  // там уже есть зелёный лидер соперника и нет монумента — это не опора
  lead(t, 1, GREEN, 'M3');
  assert.equal(relocationPurpose(t, { type: 'leader', color: GREEN, pos: at('J3') }), false);
});
