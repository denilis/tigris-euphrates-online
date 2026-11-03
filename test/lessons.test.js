// Уроки против настоящего движка: файлы совпадают со сборкой, шаги допустимы, текст называет
// клетку хода, причины запрета совпадают с правилами движка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LESSONS } from '../lessons/index.js';
import { buildLesson, at } from '../lessons/kit.js';
import { judgeMove, stepView, nextLabel, handHint, loadDone, saveDone, LAST_LESSON } from '../public/js/lesson-core.js';
import { whyNot } from '../public/js/lesson-why.js';
import { cellName, W, H, FACEDOWN, WONDER, CATASTROPHE } from '../public/js/util.js';

const BUILT = LESSONS.map(buildLesson);
const moveSteps = (l) => l.steps.filter((s) => s.by === 'me');

test('файлы в public/lessons совпадают со сборкой', () => {
  for (const l of BUILT) {
    assert.equal(readFileSync(`public/lessons/${l.id}.json`, 'utf8'), JSON.stringify(l), `урок ${l.id}: запустите node tools/build-lessons.js`);
  }
  const index = JSON.parse(readFileSync('public/lessons/index.json', 'utf8'));
  assert.deepEqual(index.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(index.map((x) => x.steps), BUILT.map((l) => l.steps.length));
});

test('уроков восемь, в каждом шаге есть заголовок и текст, урок заканчивается итогом', () => {
  assert.equal(BUILT.length, 8);
  for (const l of BUILT) {
    assert.ok(l.title && l.goal && l.minutes >= 3 && l.minutes <= 5, `урок ${l.id}`);
    for (const s of l.steps) assert.ok(s.title && s.say, `урок ${l.id}: ${s.title}`);
    assert.equal(l.steps.at(-1).by, null, `урок ${l.id}: последний шаг без хода`);
    assert.ok(moveSteps(l).length >= 2, `урок ${l.id}: игрок должен ходить сам`);
  }
});

test('тексты короткие и без следов машинной типографики', () => {
  for (const l of BUILT) {
    for (const s of l.steps) {
      for (const text of [s.title, s.say, s.why, s.alt, ...(s.wrong || []).map((w) => w.say)].filter(Boolean)) {
        assert.ok(!/[\u2014\u2026\u00a0\u202f\u2009\u00b7\u2192\u201c\u201d\u2018\u2019ёЁ]/.test(text), text);
        assert.ok(!/ {2}/.test(text), text);
        assert.ok(text.length <= 300, `длинно: ${text}`);
      }
    }
  }
});

test('кадр: решает ученик только на своем шаге, часов и отмены нет, счет открыт', () => {
  for (const l of BUILT) {
    assert.equal(l.base.me, 0);
    assert.equal(l.base.isHost, false);
    assert.equal(l.base.options.openScore, true);
    for (const s of l.steps) {
      assert.equal(s.game.clock, null);
      assert.equal(s.game.canUndo, false);
      assert.ok(s.game.players.every((p) => p.score), 'счет виден');
      if (s.by === 'me') assert.ok(s.game.legal.some((m) => JSON.stringify(m) === JSON.stringify(s.move)), s.title);
      else assert.equal(s.game.legal, null, s.title);
    }
  }
});

test('текст шага называет клетку, куда ведет ход', () => {
  for (const l of BUILT) {
    for (const s of l.steps) {
      if (!s.by || !s.move || s.by === 'rival') continue;
      const cell = s.move.pos ?? null;
      if (cell != null) assert.ok(s.say.includes(cellName(cell)), `урок ${l.id}: ${s.say}`);
    }
  }
});

test('подсветка: в ход соперника рука ученика не светится', () => {
  const rival = BUILT.flatMap((l) => l.steps).filter((s) => s.by === 'rival');
  assert.ok(rival.length > 10);
  for (const s of rival) assert.equal(s.pick, null, s.title);
});

test('подсветка: клетки хода и то, что брать из руки', () => {
  const tile = BUILT[0].steps.find((s) => s.by === 'me' && s.move.type === 'tile');
  assert.deepEqual(tile.cells, [at('F4')]);
  assert.deepEqual(tile.pick, { kind: 'tile', color: 0 });
  const mon = BUILT[5].steps.find((s) => s.move?.type === 'monument');
  assert.deepEqual(mon.cells, [at('H6'), at('I6'), at('H7'), at('I7')]);
  assert.equal(mon.pick, null);
  const cat = BUILT[6].steps.find((s) => s.move?.type === 'catastrophe');
  assert.equal(cat.pick.kind, 'cat');
});

test('ход ученика: нужный принимается, другой получает объяснение', () => {
  const step = BUILT[2].steps.find((s) => s.title === 'Не дарите очки');
  assert.equal(judgeMove(step, step.move), null);
  assert.match(judgeMove(step, { type: 'tile', color: 2, pos: at('F5') }), /торговцу соперника/);
  assert.match(judgeMove(step, { type: 'tile', color: 0, pos: at('F5') }), /другая цель/, 'общий ответ называет шаг');
  assert.match(judgeMove(step, { type: 'tile', color: 0, pos: at('F5') }), /F5/);
  const talk = BUILT[2].steps[0];
  assert.match(judgeMove(talk, { type: 'pass' }), /Дальше/);
});

test('каждый шаг: нужный ход принимается в том виде, в каком его дает экран партии', () => {
  for (const l of BUILT) {
    for (const s of moveSteps(l)) {
      let right = 0;
      for (const m of s.game.legal) {
        const copy = structuredClone(m); // экран отдает элемент списка, а не объект шага
        const verdict = judgeMove(s, copy);
        const known = s.wrong.find((w) => Object.entries(w.move).every(([k, v]) => JSON.stringify(m[k]) === JSON.stringify(v)));
        if (verdict === null) right++;
        else if (known) assert.equal(verdict, known.say);
        else assert.match(verdict, /другая цель/);
      }
      assert.equal(right, 1, `урок ${l.id}: ${s.title}`);
    }
  }
});

test('причина запрета совпадает с движком на каждой клетке каждого шага', () => {
  let illegal = 0, legalCells = 0;
  for (const l of BUILT) {
    const view = stepView(l, 0);
    for (const s of moveSteps(l)) {
      const g = s.game;
      if (g.phase !== 'action') continue;
      const v = { ...view, game: g };
      const me = g.players[g.order.indexOf(view.me)];
      const sels = [
        ...[0, 1, 2, 3].filter((c) => g.hand[c] > 0).map((color) => ({ kind: 'tile', color, type: 'tile' })),
        ...[0, 1, 2, 3].map((color) => ({ kind: 'leader', color, type: 'leader' })),
        ...(me.cats > 0 ? [{ kind: 'cat', type: 'catastrophe' }] : []),
      ];
      for (const sel of sels) {
        for (let i = 0; i < W * H; i++) {
          const ok = g.legal.some((m) => m.type === sel.type && m.pos === i && (sel.color == null || m.color === sel.color));
          const why = whyNot(v, sel, i);
          if (ok) { legalCells++; assert.equal(why, null, `${l.id} ${s.title} ${JSON.stringify(sel)} ${cellName(i)}`); }
          else { illegal++; assert.ok(why, `${l.id} ${s.title} ${JSON.stringify(sel)} ${cellName(i)}`); }
        }
      }
    }
  }
  assert.ok(illegal > 1000 && legalCells > 1000, `${illegal} ${legalCells}`);
});

test('причина называет правило: река, храм, два царства, сокровище', () => {
  const step = (lesson, title) => BUILT[lesson - 1].steps.find((s) => s.title === title);
  const v = (lesson, s) => ({ ...stepView(BUILT[lesson - 1], 0), game: s.game });
  const first = step(1, 'Первое действие');
  assert.match(whyNot(v(1, first), { kind: 'tile', color: 1 }, at('F4')), /только на реку/);
  assert.match(whyNot(v(1, first), { kind: 'tile', color: 0 }, at('D7')), /только ферма/);
  assert.match(whyNot(v(1, first), { kind: 'tile', color: 0 }, at('G4')), /занята/);
  const leader = step(2, 'Нельзя соединить царства');
  assert.match(whyNot(v(2, leader), { kind: 'leader', color: 2 }, at('J4')), /соединить два царства/);
  assert.match(whyNot(v(2, leader), { kind: 'leader', color: 2 }, at('A1')), /рядом с храмом/);
  const cat = step(7, 'Катастрофа');
  assert.match(whyNot(v(7, cat), { kind: 'cat' }, at('G4')), /сокровищем/);
  assert.match(whyNot(v(7, cat), { kind: 'cat' }, at('H4')), /лидера/);
  assert.match(whyNot(v(1, first), null, at('F4')), /Сначала/);
});

/** Поле по клеткам, чего нет в кадрах уроков: { name: тайл }, лидеры { name: игрок * 4 + цвет }. */
function board({ tile = {}, leader = {}, building = {}, river = [], leaders = [[-1, -1, -1, -1], [-1, -1, -1, -1]] }) {
  const empty = (v) => new Array(W * H).fill(v);
  const put = (a, map) => { for (const [k, v] of Object.entries(map)) a[at(k)] = v; return a; };
  return {
    me: 0,
    game: {
      order: [0, 1], river: river.map(at), players: leaders.map((l) => ({ leaders: l })),
      board: { tile: put(empty(-1), tile), leader: put(empty(-1), leader), building: put(empty(-1), building), treasure: empty(0) },
    },
  };
}

test('причина запрета: случаи, которых нет в кадрах уроков', () => {
  const three = board({ tile: { B2: 0 }, leader: { C1: 3, D2: 4 + 2, C3: 1 }, leaders: [[-1, at('C3'), -1, at('C1')], [-1, -1, at('D2'), -1]] });
  // клетка C2 касается трех групп с лидерами: C1, C3 и D2 не связаны между собой
  assert.match(whyNot(three, { kind: 'tile', color: 0 }, at('C2')), /тремя царствами/);
  const two = board({ leader: { C1: 3, C3: 1 }, leaders: [[-1, at('C3'), -1, at('C1')], [-1, -1, -1, -1]] });
  assert.equal(whyNot(two, { kind: 'tile', color: 0 }, at('C2')), null, 'два царства тайлом соединить можно');
  assert.match(whyNot(two, { kind: 'leader', color: 3 }, at('C1')), /уже стоит/);
  const cells = board({ tile: { A1: FACEDOWN, B1: WONDER, C1: CATASTROPHE, D1: 3 }, building: { D1: 3 } });
  assert.match(whyNot(cells, { kind: 'cat' }, at('A1')), /монумент/);
  assert.match(whyNot(cells, { kind: 'cat' }, at('B1')), /чудо/);
  assert.match(whyNot(cells, { kind: 'cat' }, at('C1')), /уже лежит катастрофа/);
  assert.match(whyNot(cells, { kind: 'cat' }, at('D1')), /под зданием/);
  assert.match(whyNot(cells, { kind: 'tile', color: 0 }, at('C1')), /закрыта/);
  assert.match(whyNot(cells, { kind: 'leader', color: 0 }, at('C1')), /закрыта/);
  assert.equal(whyNot(cells, { kind: 'cat' }, at('E1')), null, 'пустая клетка');
});

test('надписи: режим и последний шаг', () => {
  const l = BUILT[1], last = l.steps.length - 1;
  const me = l.steps.findIndex((s) => s.by === 'me');
  assert.equal(nextLabel(l, 0, 'play'), 'Дальше');
  assert.equal(nextLabel(l, me, 'watch'), 'Дальше');
  assert.equal(nextLabel(l, me, 'play'), 'Сделать за меня');
  assert.equal(nextLabel(l, last, 'watch'), 'Следующий урок');
  assert.equal(LAST_LESSON, BUILT.length);
  assert.equal(nextLabel(BUILT[6], BUILT[6].steps.length - 1, 'play'), 'Следующий урок');
  assert.equal(nextLabel(BUILT[7], BUILT[7].steps.length - 1, 'play'), 'К списку уроков');
  assert.match(handHint(l.steps[me], 'watch'), /просмотр/i);
  assert.match(handHint(l.steps[me], 'play'), /подсвеч/i);
  assert.match(handHint(l.steps[0], 'play'), /Дальше/);
  const support = BUILT[3].steps.find((s) => s.move?.type === 'support' && s.by === 'me');
  assert.match(handHint(support, 'play'), /панели урока/, 'подсвечивать нечего');
});

test('прогресс: помнится, а без памяти браузера ничего не ломается', () => {
  const box = new Map();
  const store = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  saveDone(() => store, 3);
  saveDone(() => store, 3);
  saveDone(() => store, 5);
  assert.deepEqual([...loadDone(() => store)].sort(), [3, 5]);
  const broken = () => { throw new Error('нет доступа'); };
  assert.deepEqual([...loadDone(broken)], []);
  saveDone(broken, 1);
  store.setItem('tigris.lessons', 'не список');
  assert.deepEqual([...loadDone(() => store)], []);
});

const def = (steps, setup = { hand: { me: 'rrggkk', rival: 'rrggkk' } }) => ({ id: 1, title: 'т', goal: 'ц', minutes: 3, setup, steps });

test('сборка отвергает недопустимый ход, чужую очередь и неверное утверждение', () => {
  assert.throws(() => buildLesson(def([{ title: 'т', say: 'с', me: { type: 'tile', color: 'b', pos: 'F4' } }])), /недопустим/);
  assert.throws(() => buildLesson(def([{ title: 'т', say: 'с', rival: { type: 'pass' } }])), /другой игрок/);
  assert.throws(() => buildLesson(def([{ title: 'т', say: 'с', me: { type: 'pass' }, after: () => assert.equal(1, 2) }])), /шаг 1/);
  assert.throws(() => buildLesson(def([{ title: 'т', say: 'с', me: { type: 'tile', color: 'r', pos: 'F4' }, wrong: [{ move: { type: 'tile', color: 'b', pos: 'F4' }, say: 'н' }] }])), /недопустимому/);
  assert.throws(() => buildLesson(def([{ title: 'т', say: 'с', me: { type: 'pass' }, wrong: [{ move: { type: 'pass' }, say: 'н' }] }])), /накрывает/);
  assert.throws(() => buildLesson(def([{ title: 'т', say: 'с', check: () => assert.equal(1, 2) }])), /шаг 1/);
  assert.throws(() => buildLesson(def([], { hand: { me: 'r', rival: 'r' }, leaders: { me: { k: 'A1' } } })), /позиция/, 'лидер без храма');
  assert.throws(() => buildLesson(def([], { hand: { me: 'r', rival: 'r' }, tiles: { k: ['G4'] } })), /занята/);
});
