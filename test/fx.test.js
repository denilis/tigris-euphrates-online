// Анимации поля (04.11): что изменилось между видами, возраст эффектов, рисунок эффектов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardChanges, ageFx, takerOf, FX_MS, BURN_STEP, BURN_RINGS } from '../public/js/fx.js';
import { RUIN_S } from '../public/js/ruin.js';
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

// --- огонь войны и падение лидера (схема одобрена Денисом 06.11)
const war = (loser, color) => ({ ev: 'war', winner: 9, loser, color, att: 9, def: loser });

test('огонь войны: снятые войной тайлы горят волной от тайла, что объединил царства', () => {
  const a = empty();
  for (const i of [20, 21, 22, 40]) a.board.tile[i] = 2; // E2, F2, G2 и I3
  const b = clone(a);
  for (const i of [20, 21, 22, 40]) b.board.tile[i] = -1;
  b.board.tile[19] = 0; // тайл объединения (D2) лег этим же ходом
  const entries = [{ ev: 'tile', pos: 19, c: 0 }, { ev: 'warStart' }, war(1, 2)];
  assert.deepEqual(boardChanges(a, b, entries), [
    { kind: 'burn', pos: 20, c: 2, delay: 0, seat: 9 },
    { kind: 'burn', pos: 21, c: 2, delay: BURN_STEP, seat: 9 },
    { kind: 'burn', pos: 22, c: 2, delay: 2 * BURN_STEP, seat: 9 },
    { kind: 'burn', pos: 40, c: 2, delay: 4 * BURN_STEP, seat: 9 },
  ]);
  // тайл лег прошлым обновлением, игрок решал поддержку: место стычки из метки объединения
  assert.deepEqual(boardChanges({ ...a, unite: 19 }, b, [war(1, 2)]).map((f) => f.delay), [0, BURN_STEP, 2 * BURN_STEP, 4 * BURN_STEP]);
  // места не знаем: горят разом
  assert.deepEqual(boardChanges(a, b, [war(1, 2)]).map((f) => f.delay), [0, 0, 0, 0]);
});

test('огонь войны: без боя тайлы гаснут как раньше (отмена хода), волна не тянется дольше 10 шагов', () => {
  const a = empty();
  a.board.tile[1] = 3;
  a.board.tile[175] = 3; // дальний угол
  const b = clone(a);
  b.board.tile[1] = -1;
  b.board.tile[175] = -1;
  assert.deepEqual(boardChanges(a, b, [{ ev: 'undo' }]).map((f) => f.kind), ['gone', 'gone']);
  assert.deepEqual(boardChanges(a, b).map((f) => f.kind), ['gone', 'gone']);
  assert.deepEqual(boardChanges(a, b, [{ ev: 'tile', pos: 0, c: 3 }, war(1, 3)]).map((f) => f.delay), [0, BURN_RINGS * BURN_STEP]);
});

test('падение лидера: проигравший в войне и восстании, лидер без храма; свой уход лидера не анимируется', () => {
  const a = empty();
  a.board.leader = Array(176).fill(-1);
  a.board.leader[50] = 1 * 4 + 2; // место 3 (индекс движка 1), зеленый
  a.board.leader[60] = 0 * 4 + 0; // место 7, красный
  a.board.leader[70] = 0 * 4 + 1; // место 7, синий: уходит сам
  const b = clone(a);
  b.order = [7, 3];
  for (const i of [50, 60, 70]) b.board.leader[i] = -1;
  const entries = [war(3, 2), { ev: 'leaderReturned', seat: 7, c: 0, pos: 60 }, { ev: 'leaderWithdraw', seat: 7, c: 1 }];
  assert.deepEqual(boardChanges(a, b, entries), [
    { kind: 'fall', pos: 50, c: 2, seat: 3 },
    { kind: 'fall', pos: 60, c: 0, seat: 7 },
  ]);
  assert.deepEqual(boardChanges(a, b, [{ ev: 'revolt', winner: 3, loser: 7, color: 1 }]), [{ kind: 'fall', pos: 70, c: 1, seat: 7 }]);
  assert.deepEqual(boardChanges(a, b, []), [], 'без боя лидеры уходят без анимации');
  // лидер переставлен на другую клетку: не падение
  const m = clone(a);
  m.order = [7, 3];
  m.board.leader[50] = -1;
  m.board.leader[51] = 1 * 4 + 2;
  assert.deepEqual(boardChanges(a, m, [war(3, 2)]), []);
});

test('огонь и падение на настоящих партиях: каждая война жжет снятые тайлы, каждый проигравший падает', () => {
  const seen = { burn: 0, fall: 0 };
  for (const seed of [2, 4, 8, 13]) {
    const t = started(seed);
    playOut(t, seed);
    let prev = null;
    replay(t.game.rec, (s) => {
      const next = {
        board: { tile: [...s.tile], treasure: [...s.treasure], leader: [...s.leader] },
        monuments: s.monuments.map((m) => ({ id: m.id, pos: m.pos })),
        order: s.players.map((_, p) => p),
        unite: s.ctx?.unite && s.ctx.pos != null ? s.ctx.pos : null,
      };
      const entries = s.log.map((e) => ('p' in e ? { ...e, seat: e.p } : e)); // как журнал сайта: место вместо индекса
      const ch = boardChanges(prev, next, entries);
      if (prev) {
        const removed = entries.filter((e) => e.ev === 'score' && e.why === 'war').reduce((x, e) => x + e.n - 1, 0);
        assert.equal(ch.filter((f) => f.kind === 'burn').length, removed, 'горит ровно то, что сняла война');
        const out = entries.filter((e) => ['war', 'revolt', 'leaderReturned'].includes(e.ev)).length;
        assert.equal(ch.filter((f) => f.kind === 'fall').length, out, 'падает каждый снятый лидер');
        for (const f of ch.filter((x) => x.kind === 'burn')) assert.ok(f.delay >= 0 && f.delay <= BURN_RINGS * BURN_STEP);
      }
      for (const f of ch) if (f.kind in seen) seen[f.kind]++;
      prev = next;
    });
  }
  assert.ok(seen.burn > 0 && seen.fall > 0, JSON.stringify(seen));
});

test('огонь: эффект с задержкой волны живет дольше на эту задержку', () => {
  const list = ageFx([], [{ kind: 'burn', pos: 1, c: 0, delay: 320 }, { kind: 'fall', pos: 2, c: 1, seat: 0 }], 0);
  assert.equal(ageFx(list, [], FX_MS.fall + 1).length, 1, 'лидер уже улетел');
  assert.equal(ageFx(list, [], FX_MS.burn + 319).length, 1);
  assert.equal(ageFx(list, [], FX_MS.burn + 321).length, 0);
});

test('трофей (06.11): снятый войной тайл поле не рисует, его рисует холст ruin.js; лидер падает', () => {
  const s = fxSVG([
    { kind: 'burn', pos: 0, c: 2, delay: 160, age: 40, seat: 1 },
    { kind: 'fall', pos: 5, c: 1, seat: 0, hero: 'lion', age: 100 },
  ]);
  assert.doesNotMatch(s, /fx-burn|href="#tl2"/);
  assert.match(s, /class="fx-fall"[^>]*animation-delay:-100ms/);
  assert.match(s, /href="#tk_lion_1"/);
});

test('трофей (06.11): победитель у каждой войны свой, монеты летят медленно, к очку своего цвета', () => {
  const a = empty();
  a.board.tile[20] = 2;
  a.board.tile[60] = 3;
  const b = clone(a);
  b.board.tile[20] = -1;
  b.board.tile[60] = -1;
  const ch = boardChanges(a, b, [{ ev: 'war', winner: 4, loser: 1, color: 2 }, { ev: 'war', winner: 6, loser: 4, color: 3 }]);
  assert.deepEqual(ch.map((f) => [f.pos, f.seat]), [[20, 4], [60, 6]]);
  assert.ok(RUIN_S.trophy > 1, 'монета успевает долететь');
  const game = readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
  assert.match(game, /const TROPHY_SLOW = 3;/, 'в 3 раза медленнее (Денис 06.11)');
  assert.match(game, /play\('trophy'/, 'на поле стоит трофей');
  assert.match(game, /<span data-c="\$\{c\}"/, 'у очков в карточке есть цвет: туда летит монета');
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
