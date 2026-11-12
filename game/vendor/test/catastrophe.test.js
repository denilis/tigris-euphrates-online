// Правила катастроф (bot/catastrophe.js): защита всегда, атака с середины
// партии, вторая катастрофа в запасе, своих лидеров не выселять.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RED, BLACK } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';
import { makeView } from '../bot/belief.js';
import { params, playableActions } from '../bot/bot.js';
import { catastropheRule, catastropheDefense, gameProgress } from '../bot/catastrophe.js';
import { at, bare, put, lead, setHand } from './helpers.js';

/** Чужой царь у единственного храма C2: катастрофа на C2 выселяет его. */
function evictPosition({ bag, cats = 2, ownNearby = false } = {}) {
  const s = bare(2);
  put(s, 'C2', RED);
  lead(s, 1, BLACK, 'C3');
  put(s, 'K8', RED);
  lead(s, 0, BLACK, ownNearby ? 'B2' : 'K9');
  setHand(s, 0, [1, 1, 2, 2]);
  setHand(s, 1, [2, 1, 1, 2]);
  s.players[0].cats = cats;
  if (bag) s.bag = bag.slice();
  return s;
}

const rule = (s, pos, opts) => catastropheRule(makeView(s, 0, 'none', makeRng(1)), s, { type: 'catastrophe', pos: at(pos) }, opts);

test('атака раньше середины партии запрещена, с середины разрешена', () => {
  const early = evictPosition();
  assert.ok(gameProgress(makeView(early, 0, 'none', makeRng(1))) < 0.1);
  assert.equal(rule(early, 'C2').ok, false);
  const mid = evictPosition({ bag: [10, 10, 10, 10] });
  const r = rule(mid, 'C2');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'offense');
  assert.equal(r.evicts.opp, 1);
});

test('с настройкой «запас» последняя катастрофа в середине партии — в запасе, в конце можно', () => {
  const reserve = { reserve: true };
  assert.equal(rule(evictPosition({ bag: [10, 10, 10, 10], cats: 1 }), 'C2', reserve).ok, false);
  assert.equal(rule(evictPosition({ bag: [2, 2, 2, 2], cats: 1 }), 'C2', reserve).ok, true);
  // по умолчанию запаса нет: в турнире он стоил силы
  assert.equal(rule(evictPosition({ bag: [10, 10, 10, 10], cats: 1 }), 'C2').ok, true);
});

test('катастрофа, выселяющая своего лидера, запрещена', () => {
  const s = evictPosition({ bag: [10, 10, 10, 10], ownNearby: true });
  const r = rule(s, 'C2');
  assert.equal(r.evicts.own, 1);
  assert.equal(r.ok, false);
});

/** Моё царство B2..D3 (царь, 2 поселения) и чужое F2..I2 (царь, 5 поселений) через пустую E3. */
function unionPosition(myBlackInHand = 0) {
  const s = bare(2);
  put(s, 'B2', RED);
  lead(s, 0, BLACK, 'B3');
  put(s, 'C3', BLACK); put(s, 'D3', BLACK);
  for (const c of ['F3', 'G3', 'H3', 'F2', 'G2']) put(s, c, BLACK);
  put(s, 'H2', RED);
  lead(s, 1, BLACK, 'I2');
  setHand(s, 0, [2, 2, 2 - Math.min(2, myBlackInHand), myBlackInHand]);
  setHand(s, 1, [2, 1, 1, 2]);
  return s;
}

test('защита от объединения: клетка, через которую соперник выиграет войну', () => {
  const s = unionPosition(0);
  assert.equal(catastropheDefense(s, 0, at('E3')), 'union');
  const r = rule(s, 'E3');
  assert.equal(r.ok, true, 'защита разрешена и в начале партии');
  assert.equal(r.kind, 'defense');
  // с запасом поселений в руке бот войну отобьёт: закрывать нечего
  assert.equal(catastropheDefense(unionPosition(5), 0, at('E3')), null);
});

test('защита от чужого монумента: последняя клетка квадрата 2x2 соперника', () => {
  const s = bare(2);
  put(s, 'C2', RED);
  lead(s, 1, BLACK, 'C3');
  put(s, 'D3', BLACK); put(s, 'E3', BLACK); put(s, 'D4', BLACK);
  assert.equal(catastropheDefense(s, 0, at('E4')), 'monument');
  // если там же мой лидер нужного цвета, а у соперника нет — монумент мне выгоден
  const s2 = bare(2);
  put(s2, 'C2', RED);
  lead(s2, 0, BLACK, 'C3');
  put(s2, 'D3', BLACK); put(s2, 'E3', BLACK); put(s2, 'D4', BLACK);
  assert.equal(catastropheDefense(s2, 0, at('E4')), null);
});

test('вторым действием атака без выселения не рассматривается, защита — да', () => {
  const s = unionPosition(0);
  s.bag = [10, 10, 10, 10];
  s.actionNo = 2;
  const view = makeView(s, 0, 'none', makeRng(1));
  const P = params({ strength: 50 });
  const cats = playableActions(view, view.state, P).filter((m) => m.type === 'catastrophe');
  assert.ok(cats.some((m) => m.pos === at('E3')), 'защитная катастрофа на E3 в кандидатах');
  for (const m of cats) {
    const r = catastropheRule(view, view.state, m);
    assert.ok(r.kind === 'defense' || r.evicts.opp > 0, 'атака вторым действием только с выселением');
  }
});
