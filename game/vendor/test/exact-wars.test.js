// Точные веса исходов войн (13.11.2026, вопрос Дениса: почему бот идет в войну с шансом 27%, когда ее
// можно обойти). Клетку объединения и порядок войн бот выбирал по среднему из 6 случайных догадок о чужой
// руке; если в догадках у соперника случайно не было нужного цвета, слабая война казалась выгодной. Теперь
// догадки взвешиваются долями исходов («у защитника хватает тайлов цвета» / «не хватает»), а недостающий
// исход получает свою догадку. План и замеры: plans/2026-11-13-бот-точные-веса-войн.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, cloneState } from '../engine/engine.js';
import { RED, BLUE, GREEN, BLACK } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';
import { makeView, determinize, sampleHands, handStrata, stratifiedDets, strataKey } from '../bot/belief.js';
import { decide, aggregate, params, conflictOdds, conflictFeats, warOrderFeats, warOrderSample, WAR_ORDER_DETS } from '../bot/bot.js';
import { at, bare, put, lead, setHand } from './helpers.js';

/**
 * Позиция-образец. Бот (игрок 0): храмов 5, поселений 5, рынков 2, в руке один зеленый. Соперник: храмов 2,
 * поселений 2, рынков 2, в руке один зеленый. Царства соединяет синий тайл на реке. Через E6 и F6 мост
 * держится на чужом царе и его поселениях: после красной и черной войн он исчезает, и зеленой войны нет.
 */
function greenTrap({ actionNo = 2, botHand = [2, 1, 1, 2] } = {}) {
  const s = bare(2);
  for (const n of ['A1', 'P1', 'A11', 'P11', 'A9']) put(s, n, RED, { treasure: true });
  for (const n of ['E4', 'F4', 'G4', 'H4', 'I4']) put(s, n, RED);
  for (const n of ['E5', 'F5', 'G5', 'H5', 'I5']) put(s, n, BLACK);
  for (const n of ['J4', 'J5']) put(s, n, GREEN);
  lead(s, 0, RED, 'F3'); lead(s, 0, GREEN, 'G3'); lead(s, 0, BLACK, 'H3');
  for (const n of ['G7', 'H7']) put(s, n, RED);
  for (const n of ['E7', 'E8']) put(s, n, BLACK);
  for (const n of ['J7', 'J8']) put(s, n, GREEN);
  lead(s, 1, BLACK, 'F7'); lead(s, 1, GREEN, 'I7'); lead(s, 1, RED, 'G8');
  setHand(s, 0, botHand);
  setHand(s, 1, [2, 1, 1, 2]);
  const gone = [16, 10, 6, 8]; // середина партии: часть тайлов уже вышла
  for (let c = 0; c < 4; c++) { s.bag[c] -= gone[c]; s.removed[c] += gone[c]; }
  s.players[0].score = [6, 5, 5, 6];
  s.players[1].score = [6, 5, 5, 6];
  s.turn = 25; s.cur = 0; s.toMove = 0; s.actionNo = actionNo; s.phase = 'action';
  return s;
}

/** Ход бота до конца; соперник в войне докладывает ровно столько, сколько нужно для ничьей. */
function playBotTurn(s, settings, seed) {
  const rng = makeRng(seed * 101 + 7), draw = makeRng(seed * 977 + 3);
  let united = false, green = false, guard = 0;
  while (!s.over && s.cur === 0 && guard++ < 40) {
    let move;
    if (s.toMove === 0) {
      move = decide(makeView(s, 0, 'none', rng), settings, rng).move;
      if (s.phase === 'action' && move.type === 'tile') {
        const x = cloneState(s);
        applyMove(x, move, () => 0.5);
        if (x.phase === 'warChoose' || x.phase === 'warSupport') united = true;
      }
    } else {
      const w = s.ctx.war, have = s.players[1].hand[w.color];
      const need = w.attBoard + w.attN - w.defBoard;
      move = { type: 'support', n: need > 0 && need <= have ? need : 0 };
    }
    if (s.phase === 'warSupport' && s.ctx.war.color === GREEN) green = true;
    applyMove(s, move, draw);
  }
  return { united, green };
}

const SETTINGS = { strength: 100, risk: 50, errors: 0, style: 'universal', counting: 'none', timeMs: Infinity };
const RUNS = 16;

function tally(extra, position = {}) {
  let united = 0, green = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = playBotTurn(greenTrap(position), { ...SETTINGS, ...extra }, seed);
    if (r.united) united++;
    if (r.green) green++;
  }
  return { united, green };
}

test('позиция-образец: с точными весами бот объединяет царства и обходит зеленую войну', () => {
  for (const style of ['universal', 'denis']) {
    const r = tally({ style });
    assert.ok(r.united >= RUNS - 1, `${style}: объединений ${r.united} из ${RUNS}`);
    assert.ok(r.green <= 1, `${style}: зеленая война ${r.green} из ${RUNS}, ждали не больше 1`);
  }
});

test('позиция-образец с двумя действиями: то же, когда объединение можно сделать вторым действием', () => {
  const r = tally({}, { actionNo: 1 });
  assert.ok(r.united >= RUNS - 1, `объединений ${r.united} из ${RUNS}`);
  assert.ok(r.green <= 2, `зеленая война ${r.green} из ${RUNS}, ждали не больше 2`);
});

// Контроль: показывает, что образец ловит ошибку выборки. Если старый режим (exactWars: false) когда-нибудь
// починят или уберут, этот тест убрать вместе с ним.
test('позиция-образец, контроль: без точных весов бот часто идет в зеленую войну', () => {
  const r = tally({ exactWars: false });
  assert.ok(r.green >= 4, `зеленая война ${r.green} из ${RUNS}: образец перестал ловить ошибку выборки`);
});

test('настройка exactWars: включена по умолчанию при 4 достройках и больше, выключается явно', () => {
  assert.equal(params({ strength: 100 }).exactWars, true);
  assert.equal(params({ strength: 50 }).exactWars, true);
  assert.equal(params({ strength: 100, exactWars: true }).exactWars, true);
  for (const off of [false, 'false', 0, '0']) assert.equal(params({ strength: 100, exactWars: off }).exactWars, false);
  // слабые ступени (одна-две достройки) оценивают войны по-старому, даже если настройку включить
  assert.equal(params({ strength: 40 }).exactWars, false);
  assert.equal(params({ strength: 10, exactWars: true }).exactWars, false);
});

test('conflictOdds отдает защитника и перевес по каждой войне', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(1));
  const odd = conflictOdds(view, view.state, { type: 'tile', color: BLUE, pos: at('F6') });
  const by = Object.fromEntries(odd.wars.map((w) => [w.color, w]));
  assert.deepEqual([by[RED].def, by[RED].margin], [1, 5]); // 5 храмов + 2 в руке против 2
  assert.deepEqual([by[GREEN].def, by[GREEN].margin], [1, 1]); // 2 рынка + 1 в руке против 2
  assert.deepEqual([by[BLACK].def, by[BLACK].margin], [1, 5]);
});

test('признаки исхода хода: война с неясным исходом дает признак, решенная заранее не дает', () => {
  const unite = { type: 'tile', color: BLUE, pos: at('F6') };
  const feats = (botHand) => {
    const view = makeView(greenTrap({ botHand }), 0, 'none', makeRng(1));
    return conflictFeats(view, conflictOdds(view, view.state, unite));
  };
  assert.deepEqual(feats([2, 1, 1, 2]), [
    { def: 1, color: RED, margin: 5 }, { def: 1, color: GREEN, margin: 1 }, { def: 1, color: BLACK, margin: 5 },
  ]);
  // четыре храма в руке: перевес 7, у защитника всего 6 тайлов, красную войну проиграть нельзя
  // зеленых в руке нет: перевес 0, зеленую войну выиграть нельзя
  assert.deepEqual(feats([4, 1, 0, 1]), [{ def: 1, color: BLACK, margin: 4 }]);
  assert.deepEqual(conflictFeats(makeView(greenTrap(), 0, 'none', makeRng(1)), null), []);
});

test('признаки исхода: восстание дает признак по храмам', () => {
  const s = bare();
  put(s, 'C3', RED); put(s, 'B4', RED); put(s, 'E3', RED);
  lead(s, 1, RED, 'C4');
  setHand(s, 0, [2, 1, 1, 2]);
  setHand(s, 1, [2, 1, 1, 2]);
  const view = makeView(s, 0, 'none', makeRng(1));
  const odd = conflictOdds(view, view.state, { type: 'leader', color: RED, pos: at('D3') });
  // у D3 храмы C3 и E3, у защитника C3 и B4: 2 + 2 в руке против 2
  assert.deepEqual(conflictFeats(view, odd), [{ def: 1, color: RED, margin: 2 }]);
});

/** Образец после объединения через F6: бот выбирает, какая война первая. */
function atWarChoice(botHand) {
  const s = greenTrap({ botHand });
  applyMove(s, { type: 'tile', color: BLUE, pos: at('F6') }, makeRng(2));
  assert.equal(s.phase, 'warChoose');
  return s;
}

test('признаки исхода при выборе порядка войн: перевес считается с тайлами руки', () => {
  const view = makeView(atWarChoice(), 0, 'none', makeRng(1));
  assert.deepEqual(warOrderFeats(view), [
    { def: 1, color: RED, margin: 5 }, { def: 1, color: GREEN, margin: 1 }, { def: 1, color: BLACK, margin: 5 },
  ]);
  const view2 = makeView(atWarChoice([4, 1, 0, 1]), 0, 'none', makeRng(1));
  assert.deepEqual(warOrderFeats(view2), [{ def: 1, color: BLACK, margin: 4 }]);
});

test('порядок войн: достроек не меньше 24, и они взвешены долями исходов', () => {
  const view = makeView(atWarChoice(), 0, 'none', makeRng(1));
  const { dets, weights } = warOrderSample(view, params({ strength: 100 }), makeRng(9));
  assert.ok(dets.length >= WAR_ORDER_DETS);
  assert.ok(weights, 'веса есть');
  assert.equal(weights.length, dets.length);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // вес исходов «у соперника есть зеленый» близок к 73%, а не к доле в случайной выборке
  const feats = [{ def: 1, color: GREEN, margin: 1 }];
  let has = 0;
  dets.forEach((d, i) => { if (strataKey(d.players.map((pl) => pl.hand), feats) === '1') has += weights[i]; });
  assert.ok(Math.abs(has - 0.73) < 0.04, `вес исходов с зеленым у соперника ${has}`);
});

test('среднее с весами: вес исхода вместо равных долей, разброс тоже с весами', () => {
  assert.equal(aggregate([0, 10], 0), 5);
  assert.equal(aggregate([0, 10], 0, [0.9, 0.1]), 1);
  // разброс: 0,9 * 1 + 0,1 * 81 = 9, корень 3
  assert.ok(Math.abs(aggregate([0, 10], 0.5, [0.9, 0.1]) - 2.5) < 1e-9);
  // без весов как раньше: среднее 5, разброс 5
  assert.equal(aggregate([0, 10], 0.5), 7.5);
});

test('sampleHands: те же руки, что достраивает determinize при том же генераторе', () => {
  const s = greenTrap();
  for (const counting of ['none', 'approx', 'exact']) {
    const view = makeView(s, 0, counting, makeRng(3));
    for (let k = 1; k <= 5; k++) {
      const hands = sampleHands(view, makeRng(k));
      const det = determinize(view, makeRng(k));
      assert.equal(hands[0], null, 'своя рука не достраивается');
      assert.deepEqual(hands[1], det.players[1].hand, `${counting}, сид ${k}`);
    }
  }
});

test('determinize с заданными руками: руки как заданы, мешок нужного размера', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(3));
  const det = determinize(view, makeRng(4), [null, [0, 0, 6, 0]]);
  assert.deepEqual(det.players[1].hand, [0, 0, 6, 0]);
  assert.deepEqual(det.players[0].hand, s.players[0].hand);
  assert.equal(det.bag.reduce((a, b) => a + b, 0), view.bagTotal);
});

test('доли исходов: сумма 1, пример рук подходит под исход, доля близка к расчетной', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(3));
  const feats = [{ def: 1, color: GREEN, margin: 1 }];
  const st = handStrata(view, feats, makeRng(11), 4000);
  let sum = 0;
  for (const [key, e] of st) {
    sum += e.p;
    assert.equal(strataKey(e.hands, feats), key);
  }
  assert.ok(Math.abs(sum - 1) < 1e-9);
  // «не считает»: зеленых 30 из 153, рука 6 тайлов: хотя бы один зеленый примерно в 73% раздач
  assert.ok(Math.abs(st.get('1').p - 0.73) < 0.04, `доля ${st.get('1').p}`);
  assert.ok(Math.abs(st.get('0').p - 0.27) < 0.04, `доля ${st.get('0').p}`);
});

test('взвешенные достройки: недостающий исход получает достройку, веса исходов равны их долям', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(3));
  const feats = [{ def: 1, color: GREEN, margin: 1 }];
  // шесть догадок, и во всех у соперника есть зеленый
  const rng = makeRng(21);
  const base = Array.from({ length: 6 }, () => determinize(view, rng, [null, [2, 1, 1, 2]]));
  const { dets, weights } = stratifiedDets(view, base, feats, makeRng(5), { n: 4000 });
  assert.equal(dets.length, 7, 'добавлена одна достройка под исход «зеленых нет»');
  assert.equal(dets[6].players[1].hand[GREEN], 0);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(weights[6] - 0.27) < 0.04, `вес исхода «зеленых нет» ${weights[6]}`);
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(weights[i] - 0.73 / 6) < 0.01);
});

test('взвешенные достройки: без признаков исхода достройки те же и весов нет', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(3));
  const rng = makeRng(21);
  const base = Array.from({ length: 6 }, () => determinize(view, rng));
  const r = stratifiedDets(view, base, [], makeRng(5));
  assert.equal(r.dets, base);
  assert.equal(r.weights, null);
});

test('взвешенные достройки: исходы на месте, лишних достроек нет', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(3));
  const feats = [{ def: 1, color: GREEN, margin: 1 }];
  const rng = makeRng(21);
  const base = [
    determinize(view, rng, [null, [2, 1, 1, 2]]),
    determinize(view, rng, [null, [3, 1, 0, 2]]),
    determinize(view, rng, [null, [2, 2, 0, 2]]),
  ];
  const { dets, weights } = stratifiedDets(view, base, feats, makeRng(5), { n: 4000 });
  assert.equal(dets.length, 3);
  assert.ok(Math.abs(weights[0] - 0.73) < 0.04);
  assert.ok(Math.abs(weights[1] - 0.135) < 0.02);
  assert.ok(Math.abs(weights[2] - 0.135) < 0.02);
});

test('взвешенные достройки, три войны: каждый исход с долей от 2% получает достройку', () => {
  const s = greenTrap();
  const view = makeView(s, 0, 'none', makeRng(3));
  const feats = [{ def: 1, color: RED, margin: 2 }, { def: 1, color: GREEN, margin: 1 }, { def: 1, color: BLACK, margin: 1 }];
  const rng = makeRng(21);
  const base = Array.from({ length: 6 }, () => determinize(view, rng, [null, [2, 1, 1, 2]])); // все с исходом 111
  // stratifiedDets первым делом считает доли тем же генератором: повторяем расчет, чтобы знать исходы
  const strata = handStrata(view, feats, makeRng(5));
  const big = [...strata].filter(([, e]) => e.p >= 0.02).map(([k]) => k);
  assert.ok(big.length >= 5, `исходов с долей от 2%: ${big.length}`);
  const { dets, weights } = stratifiedDets(view, base, feats, makeRng(5));
  const keys = dets.map((d) => strataKey(d.players.map((pl) => pl.hand), feats));
  for (const k of big) assert.ok(keys.includes(k), `исход ${k} без достройки`);
  assert.equal(dets.length, 6 + big.length - 1);
  // вес каждого исхода равен его доле среди покрытых исходов
  const covered = big.reduce((a, k) => a + strata.get(k).p, 0);
  for (const k of big) {
    const w = weights.reduce((a, x, i) => a + (keys[i] === k ? x : 0), 0);
    assert.ok(Math.abs(w - strata.get(k).p / covered) < 1e-9, `исход ${k}: вес ${w}`);
  }
  // при малом пределе достроек часть исходов остается без достройки
  const few = stratifiedDets(view, base, feats, makeRng(5), { maxExtra: 2 });
  assert.equal(few.dets.length, 8);
});

test('взвешенные достройки: два защитника, признак у каждого по своей руке', () => {
  const s = bare(3);
  setHand(s, 0, [2, 1, 1, 2]);
  setHand(s, 1, [2, 1, 1, 2]);
  setHand(s, 2, [2, 1, 1, 2]);
  const view = makeView(s, 0, 'none', makeRng(3));
  const feats = [{ def: 1, color: GREEN, margin: 1 }, { def: 2, color: BLACK, margin: 2 }];
  assert.equal(strataKey([null, [0, 0, 1, 5], [0, 0, 5, 1]], feats), '10');
  assert.equal(strataKey([null, [6, 0, 0, 0], [0, 0, 0, 6]], feats), '01');
  const rng = makeRng(21);
  const base = Array.from({ length: 4 }, () => determinize(view, rng, [null, [0, 0, 1, 5], [0, 0, 0, 6]])); // исход 11
  const { dets, weights } = stratifiedDets(view, base, feats, makeRng(5));
  const keys = dets.map((d) => strataKey(d.players.map((pl) => pl.hand), feats));
  assert.deepEqual([...new Set(keys)].sort(), ['00', '01', '10', '11']);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
