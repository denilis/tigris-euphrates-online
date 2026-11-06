import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, legalMoves, validate, finalVector, ranking, tileTargets, leaderTargets,
  catastropheTargets, buildingOptions, createGame, cloneState, treasuresOnBoard,
} from '../engine/engine.js';
import { BOARDS } from '../engine/boards.js';
import { RED, BLUE, GREEN, BLACK, FACEDOWN, WONDER, CATASTROPHE, EMPTY } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';
import { at, bare, put, lead, setHand } from './helpers.js';

const rng = makeRng(42);

function play(s, move) {
  const legal = legalMoves(s).map((m) => JSON.stringify(m));
  assert.ok(legal.includes(JSON.stringify(move)), `illegal move ${JSON.stringify(move)} in phase ${s.phase}`);
  applyMove(s, move, rng);
  const errs = validate(s);
  assert.deepEqual(errs, [], errs.join('; '));
}

// --- Размещение тайлов и очки

test('тайл в королевстве со своим лидером даёт очко владельцу лидера', () => {
  const s = bare();
  put(s, 'C3', RED);
  lead(s, 0, RED, 'C2');
  setHand(s, 0, [2, 0, 0, 0]);
  play(s, { type: 'tile', color: RED, pos: at('D3') });
  assert.equal(s.players[0].score[RED], 1);
});

test('без лидера нужного цвета очко получает царь', () => {
  const s = bare();
  put(s, 'E9', RED);
  lead(s, 1, BLACK, 'E8');
  setHand(s, 0, [0, 0, 1, 0]);
  play(s, { type: 'tile', color: GREEN, pos: at('F9') });
  assert.equal(s.players[1].score[GREEN], 1);
  assert.equal(s.players[0].score[GREEN], 0);
});

test('тайл вне королевства очков не даёт', () => {
  const s = bare();
  setHand(s, 0, [0, 0, 0, 1]);
  play(s, { type: 'tile', color: BLACK, pos: at('K3') });
  assert.deepEqual(s.players[0].score, [0, 0, 0, 0]);
});

test('ферма только на реке, остальные тайлы только на суше', () => {
  const s = bare();
  for (const i of tileTargets(s, BLUE)) assert.equal(s.river[i], 1);
  for (const i of tileTargets(s, RED)) assert.equal(s.river[i], 0);
  assert.equal(tileTargets(s, BLUE).length, 16);
});

test('тайл не может объединить три королевства', () => {
  const s = bare();
  put(s, 'C3', RED); lead(s, 0, RED, 'C2');
  put(s, 'E3', RED); lead(s, 1, RED, 'E2');
  put(s, 'D4', RED); lead(s, 1, GREEN, 'D5');
  assert.ok(!tileTargets(s, BLACK).includes(at('D3')));
});

// --- Лидеры

test('лидер ставится только рядом с храмом, не на реку и не объединяя королевства', () => {
  const s = bare();
  put(s, 'C3', RED); lead(s, 0, RED, 'C2');
  put(s, 'E3', RED); lead(s, 1, RED, 'E2');
  const t = leaderTargets(s, 0, GREEN);
  assert.ok(t.includes(at('B3')));
  assert.ok(!t.includes(at('D3')), 'D3 объединил бы два королевства');
  assert.ok(!t.includes(at('K3')), 'нет храма рядом');
  // храм у реки: клетка реки недоступна
  put(s, 'J5', RED);
  assert.ok(!leaderTargets(s, 0, GREEN).includes(at('J6')));
});

// --- Восстание

function revoltSetup(cfg = {}) {
  const s = bare(2, cfg);
  put(s, 'C3', RED); put(s, 'B4', RED); put(s, 'E3', RED);
  lead(s, 1, RED, 'C4');
  setHand(s, 0, [2, 0, 0, 0]);
  setHand(s, 1, [1, 0, 0, 0]);
  return s;
}

test('восстание: ничья в пользу защитника, победитель получает красное очко', () => {
  const s = revoltSetup();
  play(s, { type: 'leader', color: RED, pos: at('D3') });
  assert.equal(s.phase, 'revoltSupport');
  assert.equal(s.toMove, 0);
  assert.equal(s.ctx.revolt.attBoard, 2);
  assert.equal(s.ctx.revolt.defBoard, 2);
  play(s, { type: 'support', n: 1 });
  assert.equal(s.toMove, 1);
  play(s, { type: 'support', n: 1 });
  assert.equal(s.players[0].leaders[RED], -1, 'атакующий снят');
  assert.equal(s.players[1].leaders[RED], at('C4'));
  assert.equal(s.players[1].score[RED], 1);
  assert.equal(s.players[0].hand[RED], 1);
  assert.equal(s.players[1].hand[RED], 0);
  assert.equal(s.removed[RED], 2);
});

test('восстание: атакующий побеждает при перевесе', () => {
  const s = revoltSetup();
  play(s, { type: 'leader', color: RED, pos: at('D3') });
  play(s, { type: 'support', n: 2 });
  play(s, { type: 'support', n: 1 });
  assert.equal(s.players[1].leaders[RED], -1);
  assert.equal(s.players[0].score[RED], 1);
});

test('английский вариант: поддержка только на перевес и только до ничьей', () => {
  const s = revoltSetup({ englishSupport: true });
  play(s, { type: 'leader', color: RED, pos: at('D3') });
  assert.deepEqual(legalMoves(s).map((m) => m.n), [0, 1, 2]);
  play(s, { type: 'support', n: 1 });
  assert.deepEqual(legalMoves(s).map((m) => m.n), [0, 1]);

  const s2 = bare(2, { englishSupport: true });
  put(s2, 'C3', RED); put(s2, 'B4', RED); put(s2, 'C5', RED);
  lead(s2, 1, RED, 'C4');
  put(s2, 'D2', BLACK);
  setHand(s2, 0, [2, 0, 0, 0]);
  play(s2, { type: 'leader', color: RED, pos: at('D3') });
  // атакующий 1 против 3: двух тайлов не хватит на перевес
  assert.deepEqual(legalMoves(s2).map((m) => m.n), [0]);
});

// --- Война

function warSetup() {
  const s = bare();
  put(s, 'B2', RED, { treasure: true }); put(s, 'C2', RED);
  lead(s, 0, RED, 'B3');
  put(s, 'E2', RED); put(s, 'F2', RED);
  lead(s, 1, RED, 'E3');
  setHand(s, 0, [2, 0, 0, 0]);
  return s;
}

test('война: защитник выигрывает ничью, сторонники проигравшего убраны, сокровище остаётся', () => {
  const s = warSetup();
  play(s, { type: 'tile', color: RED, pos: at('D2') });
  assert.equal(s.phase, 'warSupport');
  assert.equal(s.ctx.war.att, 0);
  assert.equal(s.ctx.war.attBoard, 2);
  assert.equal(s.ctx.war.defBoard, 2);
  play(s, { type: 'support', n: 0 });
  play(s, { type: 'support', n: 0 });
  assert.equal(s.players[0].leaders[RED], -1);
  assert.equal(s.tile[at('C2')], EMPTY, 'C2 убран');
  assert.equal(s.tile[at('B2')], RED, 'храм с сокровищем остаётся');
  assert.equal(s.tile[at('D2')], RED, 'объединяющий тайл остаётся');
  assert.equal(s.players[1].score[RED], 2, '1 за лидера + 1 за тайл');
  assert.equal(s.players[0].score[RED], 0, 'объединяющий тайл не приносит очков');
});

test('война: храм рядом с лидером другого цвета не убирается', () => {
  const s = warSetup();
  lead(s, 1, BLACK, 'F3');
  play(s, { type: 'tile', color: RED, pos: at('D2') });
  play(s, { type: 'support', n: 1 });
  play(s, { type: 'support', n: 0 });
  assert.equal(s.players[1].leaders[RED], -1);
  assert.equal(s.tile[at('E2')], EMPTY);
  assert.equal(s.tile[at('F2')], RED, 'F2 охраняет царь на F3');
  assert.equal(s.players[1].leaders[BLACK], at('F3'));
  assert.equal(s.players[0].score[RED], 2);
});

test('война: атакующий по часовой стрелке, если ходящий не участвует', () => {
  const s = bare(3);
  put(s, 'B2', RED); put(s, 'C2', GREEN); lead(s, 0, GREEN, 'B3');
  put(s, 'E2', RED); put(s, 'F2', GREEN); lead(s, 1, GREEN, 'E3');
  s.cur = 2; s.toMove = 2;
  setHand(s, 2, [0, 0, 0, 1]);
  play(s, { type: 'tile', color: BLACK, pos: at('D2') });
  assert.equal(s.ctx.war.att, 0);
  assert.equal(s.ctx.war.def, 1);
});

test('несколько войн: ходящий выбирает порядок', () => {
  const s = bare();
  put(s, 'B2', RED); lead(s, 0, RED, 'B3'); lead(s, 0, GREEN, 'A2');
  put(s, 'E2', RED); lead(s, 1, RED, 'E3'); lead(s, 1, GREEN, 'F2');
  setHand(s, 0, [0, 0, 0, 2]);
  put(s, 'C2', BLACK);
  play(s, { type: 'tile', color: BLACK, pos: at('D2') });
  assert.equal(s.phase, 'warChoose');
  assert.deepEqual(legalMoves(s).map((m) => m.color), [RED, GREEN]);
  play(s, { type: 'warColor', color: GREEN });
  assert.equal(s.ctx.war.color, GREEN);
});

test('объединение без пар лидеров: войны нет и очков нет', () => {
  const s = bare();
  put(s, 'B2', RED); lead(s, 0, RED, 'B3');
  put(s, 'E2', RED); lead(s, 1, GREEN, 'E3');
  setHand(s, 0, [2, 0, 0, 0]);
  play(s, { type: 'tile', color: RED, pos: at('C2') });
  play(s, { type: 'tile', color: RED, pos: at('D2') });
  assert.equal(s.players[0].score[RED], 1, 'только за C2');
});

// --- Монументы

test('монумент: квадрат 2x2, лидер без храма снимается, очки в конце хода', () => {
  const s = bare();
  put(s, 'B2', RED); put(s, 'C2', RED); put(s, 'B3', RED);
  put(s, 'A3', RED);
  lead(s, 0, RED, 'A2');
  lead(s, 0, BLACK, 'A4');
  put(s, 'E9', RED); lead(s, 0, GREEN, 'E8'); // отдельное королевство
  setHand(s, 0, [1, 0, 0, 0]);
  play(s, { type: 'tile', color: RED, pos: at('C3') });
  assert.equal(s.phase, 'monument');
  const ids = legalMoves(s).filter((m) => m.type === 'monument').map((m) => m.id);
  assert.deepEqual(ids, [0, 1, 2]);
  play(s, { type: 'monument', id: 2, tl: at('B2') });
  for (const n of ['B2', 'C2', 'B3', 'C3']) assert.equal(s.tile[at(n)], FACEDOWN);
  assert.equal(s.players[0].leaders[RED], at('A2'), 'A3 ещё держит жреца');
  const red0 = s.players[0].score[RED];
  play(s, { type: 'pass' });
  assert.equal(s.players[0].score[RED], red0 + 1, 'жрец у красно-чёрного монумента');
  assert.equal(s.players[0].score[BLACK], 1, 'царь у чёрного цвета монумента');
  assert.equal(s.players[0].score[GREEN], 0);
});

// --- Сокровища

test('торговец забирает сокровище, особые первыми', () => {
  const s = bare(2, {}, { special: [at('D2')] });
  put(s, 'B2', RED, { treasure: true }); put(s, 'C2', RED); put(s, 'D2', RED, { treasure: true });
  put(s, 'K2', RED, { treasure: true });
  play(s, { type: 'leader', color: GREEN, pos: at('C1') });
  assert.equal(s.phase, 'treasure');
  assert.deepEqual(legalMoves(s).map((m) => m.pos), [at('D2')]);
  play(s, { type: 'treasure', pos: at('D2') });
  assert.equal(s.players[0].treasures, 1);
  assert.equal(s.phase, 'action');
});

// --- Катастрофы

test('катастрофа: нельзя на сокровище и лидера, снимает лидера без храма', () => {
  const s = bare();
  put(s, 'B2', RED, { treasure: true });
  put(s, 'D2', RED); lead(s, 1, BLUE, 'D3');
  const t = catastropheTargets(s);
  assert.ok(!t.includes(at('B2')));
  assert.ok(!t.includes(at('D3')));
  play(s, { type: 'catastrophe', pos: at('D2') });
  assert.equal(s.tile[at('D2')], CATASTROPHE);
  assert.equal(s.players[1].leaders[BLUE], -1);
  assert.equal(s.players[0].cats, 1);
});

// --- Здания цивилизации

test('здание: линия из трёх, удвоение очков, не убирается в войне', () => {
  const s = bare(2, { buildings: true });
  put(s, 'B2', RED); put(s, 'C2', RED);
  lead(s, 0, RED, 'B3');
  setHand(s, 0, [3, 0, 0, 0]);
  play(s, { type: 'tile', color: RED, pos: at('D2') });
  assert.equal(s.phase, 'build');
  assert.deepEqual(buildingOptions(s, at('D2'), RED), [at('B2'), at('C2'), at('D2')]);
  play(s, { type: 'build', pos: at('C2') });
  assert.equal(s.buildingPos[RED], at('C2'));
  const before = s.players[0].score[RED];
  play(s, { type: 'tile', color: RED, pos: at('C1') });
  assert.equal(s.players[0].score[RED] - before, 2, 'C1 в королевстве с библиотекой даёт 2');
});

test('здание переносится только на более длинную линию', () => {
  const s = bare(2, { buildings: true });
  put(s, 'B2', RED); put(s, 'C2', RED); put(s, 'D2', RED);
  s.building[at('C2')] = RED; s.buildingPos[RED] = at('C2');
  put(s, 'B9', RED); put(s, 'C9', RED); put(s, 'D9', RED);
  assert.deepEqual(buildingOptions(s, at('D9'), RED), []);
  put(s, 'E9', RED);
  assert.equal(buildingOptions(s, at('E9'), RED).length, 4);
});

test('тайл со зданием не убирается в войне', () => {
  const s = warSetup();
  s.cfg.buildings = true;
  s.building[at('F2')] = RED; s.buildingPos[RED] = at('F2');
  play(s, { type: 'tile', color: RED, pos: at('D2') });
  play(s, { type: 'support', n: 1 });
  play(s, { type: 'support', n: 0 });
  assert.equal(s.players[1].leaders[RED], -1);
  assert.equal(s.tile[at('F2')], RED);
  assert.equal(s.tile[at('E2')], EMPTY);
});

// --- Чудо

test('чудо: крест из пяти тайлов, царь в королевстве даёт очко на выбор', () => {
  const s = bare(2, { wonder: true });
  put(s, 'J3', GREEN); put(s, 'I3', GREEN); put(s, 'K3', GREEN); put(s, 'J2', GREEN);
  put(s, 'J5', RED); lead(s, 0, BLACK, 'K5');
  setHand(s, 0, [0, 0, 1, 0]);
  play(s, { type: 'tile', color: GREEN, pos: at('J4') });
  assert.equal(s.phase, 'monument');
  const w = legalMoves(s).find((m) => m.type === 'wonder');
  assert.deepEqual(w, { type: 'wonder', center: at('J3') });
  play(s, w);
  for (const n of ['J3', 'I3', 'K3', 'J2', 'J4']) assert.equal(s.tile[at(n)], WONDER);
  play(s, { type: 'pass' });
  assert.equal(s.phase, 'wonderPoint');
  play(s, { type: 'wonderPoint', color: BLUE });
  assert.equal(s.players[0].score[BLUE], 1);
});

// --- Сброс, добор, конец игры

test('сброс: тайлы уходят из игры, добор сразу', () => {
  const s = bare();
  setHand(s, 0, [2, 1, 1, 2]);
  play(s, { type: 'discard', counts: [1, 0, 0, 1] });
  const h = s.players[0].hand;
  assert.equal(h[0] + h[1] + h[2] + h[3], 6);
  assert.equal(s.removed[RED] + s.removed[BLACK], 2);
  assert.equal(s.actionNo, 2);
});

test('конец игры: осталось не больше двух сокровищ', () => {
  const s = bare();
  put(s, 'B2', RED, { treasure: true }); put(s, 'K2', RED, { treasure: true });
  setHand(s, 0, [2, 1, 1, 2]); setHand(s, 1, [2, 1, 1, 2]);
  play(s, { type: 'pass' });
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'treasures');
});

test('конец игры: пустой мешок при доборе', () => {
  const s = bare();
  for (let i = 0; i < 3; i++) put(s, ['B2', 'K2', 'B9'][i], RED, { treasure: true });
  setHand(s, 0, [2, 1, 1, 1]);
  s.removed = s.bag.slice(); s.bag = [0, 0, 0, 0];
  play(s, { type: 'pass' });
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'bag');
});

test('итоговый счёт: сокровища закрывают слабые цвета, ничья по следующему цвету', () => {
  assert.deepEqual(finalVector({ score: [3, 5, 2, 4], treasures: 3 }), [4, 4, 4, 5]);
  const s = bare(3);
  s.players[0].score = [5, 5, 5, 6];
  s.players[1].score = [5, 5, 6, 6];
  s.players[2].score = [4, 9, 9, 9];
  assert.deepEqual(ranking(s), [1, 0, 2]);
});

test('событие боя: стороны, поле и поддержка из руки сходятся с итогом', () => {
  const kinds = { war: 0, revolt: 0 };
  for (let seed = 1; seed <= 30; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 3, cfg: { englishSupport: true, buildings: true, wonder: true } }, r);
    s.log = [];
    for (let k = 0; k < 600 && !s.over; k++) {
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
      for (const e of s.log) {
        if (e.ev !== 'war' && e.ev !== 'revolt') continue;
        kinds[e.ev]++;
        assert.equal(e.attTotal, e.attBoard + e.attN);
        assert.equal(e.defTotal, e.defBoard + e.defN);
        assert.equal(e.winner, e.attTotal > e.defTotal ? e.att : e.def);
        assert.equal(e.loser, e.winner === e.att ? e.def : e.att);
      }
      s.log.length = 0;
    }
  }
  assert.ok(kinds.war > 10 && kinds.revolt > 10, JSON.stringify(kinds));
});

// три сокровища на поле, иначе партия кончается после первого же хода
const withTreasures = (s) => { for (const c of ['N9', 'N10', 'N11']) put(s, c, RED, { treasure: true }); return s; };

test('подтверждение хода: после второго действия ход ждет, добора еще нет', () => {
  const s = withTreasures(bare(2, { confirmTurn: true }));
  setHand(s, 0, [3, 0, 0, 3]);
  setHand(s, 1, [3, 0, 0, 3]);
  play(s, { type: 'tile', color: RED, pos: at('B2') });
  assert.equal(s.phase, 'action');
  play(s, { type: 'tile', color: RED, pos: at('D2') });
  assert.equal(s.phase, 'confirm');
  assert.equal(s.toMove, 0);
  assert.deepEqual(legalMoves(s), [{ type: 'confirm' }]);
  assert.equal(s.players[0].hand[RED], 1, 'рука не добрана до подтверждения');
  play(s, { type: 'confirm' });
  assert.equal(s.cur, 1);
  assert.equal(s.phase, 'action');
  assert.equal(s.players[0].hand.reduce((a, b) => a + b, 0), 6, 'после подтверждения добор');
});

test('подтверждение хода: пас тоже ждет, а без настройки фазы нет', () => {
  const s = withTreasures(bare(2, { confirmTurn: true }));
  play(s, { type: 'pass' });
  assert.equal(s.phase, 'confirm');
  const t = withTreasures(bare(2));
  play(t, { type: 'pass' });
  assert.equal(t.phase, 'action');
  assert.equal(t.cur, 1);
});

test('подтверждение хода: случайные партии доигрываются без нарушений', () => {
  let confirms = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 3, cfg: { englishSupport: true, buildings: true, wonder: true, confirmTurn: true } }, r);
    let k = 0;
    for (; k < 3000 && !s.over; k++) {
      if (s.phase === 'confirm') { confirms++; assert.equal(s.toMove, s.cur); }
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
      assert.deepEqual(validate(s), []);
    }
    assert.ok(s.over, `партия ${seed} закончилась`);
  }
  assert.ok(confirms > 300, `подтверждений ${confirms}`);
});

// --- Застой (cfg.stallTurns, 06.11): сайт кончает партию, в которой ничего не движется

const SITE_CFG = { englishSupport: true, buildings: true, wonder: true };
const stallGame = (cfg = {}) => createGame({ layout: BOARDS.advanced, numPlayers: 2, cfg: { ...SITE_CFG, ...cfg } }, makeRng(7));
const passes = (s, n) => { for (let k = 0; k < n; k++) play(s, { type: 'pass' }); };

test('застой: 12 ходов подряд без движения кончают партию обычным подсчетом', () => {
  const s = stallGame({ stallTurns: 12 });
  passes(s, 11);
  assert.equal(s.over, false);
  assert.equal(s.stall, 11);
  passes(s, 1);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'stall');
  assert.equal(s.phase, 'over');
  assert.equal(s.turn, 12, 'ход не переходит дальше');
  assert.equal(ranking(s).length, 2);
});

test('застой: тайл из мешка сбрасывает счетчик', () => {
  const s = stallGame({ stallTurns: 12 });
  passes(s, 11);
  play(s, legalMoves(s).find((m) => m.type === 'tile'));
  play(s, { type: 'pass' });
  assert.equal(s.stall, 0, 'после добора мешок другой');
  passes(s, 11);
  assert.equal(s.over, false);
  passes(s, 1);
  assert.equal(s.endReason, 'stall');
});

test('застой: сокровище, ушедшее с поля, тоже сбрасывает счетчик', () => {
  const s = stallGame({ stallTurns: 12 });
  passes(s, 5);
  const before = treasuresOnBoard(s);
  const pos = s.treasure.findIndex((v) => v > 0);
  s.treasure[pos] = 0; // как будто торговец забрал его в этом ходу
  s.players[s.cur].treasures++;
  applyMove(s, { type: 'pass' }, rng);
  assert.equal(treasuresOnBoard(s), before - 1);
  assert.equal(s.stall, 0);
});

test('застой: копия позиции помнит счетчик', () => {
  const s = stallGame({ stallTurns: 12 });
  passes(s, 5);
  const c = cloneState(s);
  passes(c, 6);
  assert.equal(c.over, false);
  passes(c, 1);
  assert.equal(c.endReason, 'stall');
  assert.equal(s.stall, 5, 'оригинал не тронут');
});

test('застой: без настройки пасы партию не кончают', () => {
  const s = stallGame();
  assert.equal(s.cfg.stallTurns, 0);
  passes(s, 40);
  assert.equal(s.over, false);
  assert.equal(s.stall, 0);
});

test('застой: случайные партии с правилом доигрываются без нарушений', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 3, cfg: { ...SITE_CFG, stallTurns: 12 } }, r);
    for (let k = 0; k < 3000 && !s.over; k++) {
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
      assert.deepEqual(validate(s), []);
    }
    assert.ok(s.over, `партия ${seed} закончилась`);
  }
});
