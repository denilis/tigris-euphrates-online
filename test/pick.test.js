// Что можно нажать на поле: свой лидер берется щелчком, как в нижней панели, а курсор-рука
// стоит только там, где щелчок что-то делает. Денис принял молчащий щелчок по лидеру за запрет хода.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickableLeader, hitCells, squareCells } from '../public/js/pick.js';
import { createTable, sit, setHero, setSeatCount, start, submit } from '../game/table.js';
import { viewFor } from '../game/view.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const me = { leaders: [20, -1, 77, -1] };
const legal = [{ type: 'tile', color: 1, pos: 5 }, { type: 'leader', color: 0, pos: 11 }, { type: 'withdraw', color: 0 }, { type: 'withdraw', color: 2 }];

test('свой лидер на поле берется, пустая клетка и чужой лидер нет', () => {
  assert.equal(pickableLeader(me, legal, 20), 0);
  assert.equal(pickableLeader(me, legal, 77), 2, 'хватает возврата в руку: панель пускает так же');
  assert.equal(pickableLeader(me, legal, 21), null, 'пусто или чужой лидер');
});

test('лидер в руке не находится на клетке -1', () => {
  assert.equal(pickableLeader(me, legal, -1), null);
});

test('лидера без единого хода не взять', () => {
  assert.equal(pickableLeader(me, [{ type: 'tile', color: 1, pos: 5 }], 20), null);
});

test('рабочие клетки: цели, все четыре клетки монумента, центр чуда, лидеры', () => {
  const hit = hitCells({ targets: [1, 2], squares: [40], crosses: [90] }, [20]);
  assert.deepEqual([...hit].sort((a, b) => a - b), [1, 2, 20, 40, 41, 56, 57, 90]);
  assert.deepEqual(squareCells(40), [40, 41, 56, 57]);
});

test('рабочих клеток нет, если нечего нажимать', () => {
  assert.equal(hitCells({}).size, 0);
});

test('вид стола: после постановки лидера ходящий берет его с поля, соперник нет', () => {
  const now = 0;
  const t = createTable({ code: 'PICK', host: { userId: 'a', name: 'А' }, now });
  setSeatCount(t, 'a', 3, now);
  sit(t, { userId: 'b', name: 'Б' }, 1, now);
  sit(t, { userId: 'c', name: 'В' }, 2, now);
  ['pot', 'bull', 'lion'].forEach((h, i) => setHero(t, ['a', 'b', 'c'][i], i, h, now));
  start(t, 'a', { rng: makeRng(3), now });

  const uid = (seat) => ['a', 'b', 'c'][seat];
  const who = uid(t.game.toMove);
  const v0 = viewFor(t, who);
  const index = v0.game.legal.findIndex((m) => m.type === 'leader');
  const m = v0.game.legal[index];
  submit(t, who, { version: t.version, index }, { rng: makeRng(4), now });

  const v = viewFor(t, who);
  const p = v.game.order.indexOf(v.me);
  assert.ok(v.game.legal, 'первое из двух действий: ход все еще за ним');
  assert.equal(pickableLeader(v.game.players[p], v.game.legal, m.pos), m.color);

  const other = ['a', 'b', 'c'].find((u) => u !== who);
  const vo = viewFor(t, other);
  assert.equal(vo.game.legal, null, 'чужой ход: выбирать нечего');
  const po = vo.game.order.indexOf(vo.me);
  assert.equal(vo.game.players[po].leaders.includes(m.pos), false, 'лидер на этой клетке не его');
});
