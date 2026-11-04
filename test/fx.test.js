// Анимации поля (04.11): что изменилось между видами, возраст эффектов, рисунок эффектов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardChanges, ageFx, takerOf, FX_MS } from '../public/js/fx.js';
import { fxSVG } from '../public/js/board.js';
import { CATASTROPHE, FACEDOWN } from '../public/js/util.js';
import { started, playOut } from './support.js';
import { replay } from '../game/replay.js';

const empty = () => ({ board: { tile: Array(176).fill(-1), treasure: Array(176).fill(0) }, monuments: [{ id: 0, pos: -1 }, { id: 1, pos: -1 }] });
const clone = (v) => JSON.parse(JSON.stringify(v));

test('анимации: первый взгляд на стол без эффектов', () => {
  assert.deepEqual(boardChanges(null, empty()), []);
});

test('анимации: тайл исчез, легла катастрофа, взяли сокровище, построен монумент', () => {
  const a = empty();
  a.board.tile[10] = 2;
  a.board.tile[11] = 0;
  a.board.treasure[11] = 1;
  const b = clone(a);
  b.board.tile[10] = -1; // война сняла зеленый
  b.board.tile[30] = CATASTROPHE; // катастрофа на пустую клетку
  b.board.treasure[11] = 0;
  b.monuments[1].pos = 40;
  for (const i of [40, 41, 56, 57]) b.board.tile[i] = FACEDOWN;
  assert.deepEqual(boardChanges(a, b), [
    { kind: 'gone', pos: 10, c: 2 },
    { kind: 'cube', pos: 11 },
    { kind: 'crack', pos: 30, c: -1 },
    { kind: 'grow', pos: 40 },
  ]);
});

test('анимации: под новым монументом тайлы переворачиваются, ложного «гаснет» нет', () => {
  const a = empty();
  for (const i of [40, 41, 56, 57]) a.board.tile[i] = 1;
  const b = clone(a);
  for (const i of [40, 41, 56, 57]) b.board.tile[i] = FACEDOWN;
  b.monuments[0].pos = 40;
  assert.deepEqual(boardChanges(a, b), [{ kind: 'grow', pos: 40 }]);
});

test('анимации на настоящих партиях: эффект только от своего события движка', () => {
  const cause = { gone: 'war', crack: 'catastrophe', cube: 'treasure', grow: 'monument' };
  const seen = { gone: 0, crack: 0, cube: 0 };
  for (const seed of [2, 4, 8, 13]) {
    const t = started(seed);
    playOut(t, seed);
    let prev = null;
    replay(t.game.rec, (s) => {
      const next = { board: { tile: [...s.tile], treasure: [...s.treasure] }, monuments: s.monuments.map((m) => ({ id: m.id, pos: m.pos })) };
      const evs = new Set(s.log.map((e) => e.ev));
      for (const f of boardChanges(prev, next)) {
        assert.ok(evs.has(cause[f.kind]), `${f.kind} без ${cause[f.kind]}: ${[...evs].join(' ')}`);
        if (f.kind in seen) seen[f.kind]++;
      }
      // и наоборот: каждая катастрофа и каждое сокровище видны
      if (prev && evs.has('catastrophe')) assert.ok(boardChanges(prev, next).some((f) => f.kind === 'crack'));
      if (prev && evs.has('treasure')) assert.ok(boardChanges(prev, next).some((f) => f.kind === 'cube'));
      prev = next;
    });
  }
  assert.ok(seen.gone > 0 && seen.crack > 0 && seen.cube > 0, JSON.stringify(seen));
});

test('анимации: возраст растет, отыгравший эффект уходит', () => {
  let list = ageFx([], [{ kind: 'gone', pos: 1, c: 0 }, { kind: 'grow', pos: 2 }], 1000);
  assert.deepEqual(list.map((f) => f.age), [0, 0]);
  list = ageFx(list, [], 1000 + FX_MS.gone - 1);
  assert.equal(list.length, 2);
  list = ageFx(list, [], 1000 + FX_MS.gone + 1);
  assert.deepEqual(list.map((f) => f.kind), ['grow'], 'тайл догас, монумент еще растет');
  assert.equal(ageFx(list, [], 1000 + FX_MS.grow + 1).length, 0);
});

test('анимации: кто взял сокровище', () => {
  const entries = [{ ev: 'tile', pos: 5 }, { ev: 'treasure', seat: 2, pos: 33 }];
  assert.equal(takerOf(entries, 33), 2);
  assert.equal(takerOf(entries, 34), null);
});

test('анимации: рисунок эффектов с отрицательной задержкой, без цвета тайл не рисуется', () => {
  const s = fxSVG([{ kind: 'gone', pos: 0, c: 1, age: 120 }, { kind: 'crack', pos: 1, c: -1, age: 0 }, { kind: 'cube', pos: 2, age: 50 }, { kind: 'grow', pos: 3, age: 10 }, { kind: 'gone', pos: 4, c: -1, age: 0 }]);
  assert.match(s, /class="fx-gone" href="#tl1"[^>]*animation-delay:-120ms/);
  assert.match(s, /class="fx-crack"/);
  assert.match(s, /class="fx-cube" href="\/img\/treasure\/cube.webp"[^>]*animation-delay:-50ms/);
  assert.match(s, /class="fx-flash"/);
  assert.equal((s.match(/fx-gone/g) || []).length, 1);
});

test('выбор места для здания и сокровища: цели мигают, у сокровища рамка вокруг кубика (04.11)', async () => {
  const { renderBoard } = await import('../public/js/board.js');
  const { readFileSync } = await import('node:fs');
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.river) && o.board && o.players) return o;
    for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  const g = find(JSON.parse(readFileSync(new URL('../public/lessons/1.json', import.meta.url), 'utf8')));
  const draw = (opts) => {
    const dyn = { innerHTML: '' };
    renderBoard({ dataset: {}, innerHTML: '', setAttribute() {}, querySelector: () => dyn }, g, () => 'pot', opts, 'relief');
    return dyn.innerHTML;
  };
  assert.equal((draw({ targets: [5, 6], blink: 'build' }).match(/class="target blink"/g) || []).length, 2);
  const t = draw({ targets: [5, 6], blink: 'treasure' });
  assert.equal((t.match(/class="cube-blink"/g) || []).length, 2);
  assert.doesNotMatch(draw({ targets: [5] }), /blink/, 'обычные цели не мигают');
});

test('ход соперника: сам тайл на поле проявляется, пока отметка свежая (04.11)', async () => {
  const { renderBoard } = await import('../public/js/board.js');
  const { readFileSync } = await import('node:fs');
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.river) && o.board && o.players) return o;
    for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  const g = find(JSON.parse(readFileSync(new URL('../public/lessons/1.json', import.meta.url), 'utf8')));
  const pos = g.board.tile.findIndex((t) => t >= 0 && t <= 3);
  const draw = (trail) => {
    const dyn = { innerHTML: '' };
    renderBoard({ dataset: {}, innerHTML: '', setAttribute() {}, querySelector: () => dyn }, g, () => 'pot', { trail }, 'relief');
    return dyn.innerHTML;
  };
  const mark = { ev: 'tile', pos, size: 1, action: 1, c: g.board.tile[pos] };
  const fresh = draw([{ ...mark, age: 300 }]);
  assert.equal((fresh.match(/class="arrive"/g) || []).length, 1);
  assert.match(fresh, new RegExp(`href="#tl${mark.c}"[^>]*class="arrive" style="animation-delay:-300ms"`));
  assert.doesNotMatch(draw([{ ...mark, age: 5000 }]), /arrive/, 'старый ход не анимируется');
  assert.doesNotMatch(draw([]), /arrive/);
});
