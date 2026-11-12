// Экономика восстания (Денис 12.11): бот не отдает красные из руки за царство, где нечего взять.
// Позиция из партии Дениса с ботом: на 3-м ходу Универсальный поставил жреца на E11 к одинокому храму
// E10, где стоят жрец и царь Дениса, и отдал в восстание 3 красных. В царстве кроме храма ничего нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RED, BLUE, BLACK } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';
import { makeView } from '../bot/belief.js';
import { params, playableActions, revoltWorth, REVOLT_PRIZE_TILES } from '../bot/bot.js';
import { at, bare, put, lead, setHand } from './helpers.js';

function position({ temples = [], bag } = {}) {
  const s = bare(2);
  put(s, 'E10', RED, { treasure: true });
  // остальные стартовые храмы с сокровищами далеко: начало партии, а не близкий конец по сокровищам
  for (const name of ['A1', 'P1', 'K3', 'A8', 'P9', 'L11']) put(s, name, RED, { treasure: true });
  for (const name of temples) put(s, name, RED);
  lead(s, 1, RED, 'D10');
  lead(s, 1, BLACK, 'F10');
  setHand(s, 0, [3, 1, 1, 1]); // у бота 3 красных
  setHand(s, 1, [0, 4, 0, 2]);
  if (bag) s.bag = bag.slice();
  return s;
}

const revolt = { type: 'leader', color: RED, pos: at('E11') };
const same = (a, b) => a.type === b.type && a.pos === b.pos && a.color === b.color;
const playable = (s) => playableActions(makeView(s, 0, 'none', makeRng(1)), s, params({ style: 'universal' }));

test('пустое царство у одинокого храма: восстание за красные из руки не начинается', () => {
  const s = position();
  const w = revoltWorth(s, revolt);
  assert.equal(w.needHand, true, 'храмов рядом поровну: 1 против 1, победа только красными из руки');
  assert.equal(w.tiles, 1);
  assert.equal(w.ok, false);
  assert.ok(!playable(s).some((m) => same(m, revolt)), 'ход отсеян');
  assert.ok(playable(s).some((m) => m.type === 'leader' && m.color === BLUE), 'другие ходы остались');
});

test('в царстве есть что взять (3 храма): восстание разрешено', () => {
  const s = position({ temples: ['E9', 'F9'] });
  const w = revoltWorth(s, revolt);
  assert.ok(w.tiles >= REVOLT_PRIZE_TILES);
  assert.equal(w.ok, true);
});

test('в конце партии красные уже не нужны: правило не действует', () => {
  const s = position({ bag: [2, 2, 2, 2] });
  const w = revoltWorth(s, revolt);
  assert.equal(w.late, true);
  assert.equal(w.ok, true);
});

test('свой храм рядом сильнее: красные из руки не нужны, правило не мешает', () => {
  const s = position({ temples: ['F11'] }); // у E11 два храма (E10, F11), у D10 один
  const w = revoltWorth(s, revolt);
  assert.equal(w.needHand, false);
  assert.equal(w.ok, true);
});

test('ход без восстания правило не трогает', () => {
  const s = position();
  assert.equal(revoltWorth(s, { type: 'leader', color: BLUE, pos: at('E11') }), null);
});
