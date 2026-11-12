// Прикидка монумента внутри перебора (bot/policy.js), 08.11.2026. Разбор партии сайта CBKZZE: бот трижды
// не замкнул квадрат под монумент, и дважды его замкнул соперник (ходы 32 -> 34, 48 -> 51). В прикидке
// монумент строился всегда и считал только своих лидеров, поэтому квадрат в царстве с чужим лидером
// этого цвета казался подарком сопернику. Теперь чужие пары «лидер + монумент» идут в минус.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove } from '../engine/engine.js';
import { RED, GREEN, BLACK } from '../engine/constants.js';
import { autoMove } from '../bot/policy.js';
import { bare, put, lead, setHand, at } from './helpers.js';

const rng = () => 0;

/** Квадрат красных B2 C2 B3, четвертый тайл C3 кладет игрок 0: фаза монумента. */
function square(leaders) {
  const s = bare(2, { englishSupport: true });
  put(s, 'B2', RED); put(s, 'C2', RED); put(s, 'B3', RED); put(s, 'D2', GREEN);
  for (const [p, c, cell] of leaders) lead(s, p, c, cell);
  setHand(s, 0, [2, 1, 2, 1]);
  setHand(s, 1, [2, 1, 2, 1]);
  applyMove(s, { type: 'tile', color: RED, pos: at('C3') }, rng);
  assert.equal(s.phase, 'monument');
  return s;
}
const colorsOf = (s, m) => {
  const mon = s.monuments.find((x) => x.id === m.id);
  return [mon.c1, mon.c2];
};

test('монумент, который кормит только соперника, хуже паса', () => {
  const s = square([[1, RED, 'A2'], [1, BLACK, 'A3']]);
  assert.equal(autoMove(s).type, 'pass');
});

test('монумент под своего лидера, а не под чужого', () => {
  const s = square([[0, BLACK, 'A3'], [1, GREEN, 'E2']]);
  const m = autoMove(s);
  assert.equal(m.type, 'monument');
  assert.deepEqual(colorsOf(s, m).sort(), [RED, BLACK].sort());
});

test('свой и чужой лидер одного цвета: монумент все равно строится, если своих пар больше', () => {
  const s = square([[0, RED, 'A2'], [0, BLACK, 'A3'], [1, GREEN, 'E2']]);
  const m = autoMove(s);
  assert.equal(m.type, 'monument');
  assert.deepEqual(colorsOf(s, m).sort(), [RED, BLACK].sort(), 'две свои пары, ни одной чужой');
});
