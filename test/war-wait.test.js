// Панель боя у того, кто ждет ответа: не пропадает, решений в ней нет, чужого не показывает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warActive, warWaiting, renderWarDock } from '../public/js/war.js';
import { battlesIn, seenAfterUndo } from '../public/js/battle.js';
import { momentKey } from '../public/js/util.js';

const SEATS = [{ id: 0, name: 'Денис', hero: 'pot' }, { id: 1, name: 'Соня', hero: 'bull' }, { id: 2, name: 'Влад', hero: 'lion' }];
const k = (extra = {}) => ({ color: 1, leaderColor: null, att: 0, def: 1, attPos: 10, defPos: 20, attBoard: 3, defBoard: 4, attN: null, ...extra });

function view(me, { phase = 'warSupport', conflict = k(), legal = null, canUndo = false, toMove = 1 } = {}) {
  const war = phase === 'warSupport' ? conflict : null, revolt = phase === 'revoltSupport' ? conflict : null;
  return {
    me, seats: SEATS, options: { englishSupport: true },
    game: {
      phase, legal, over: false, canUndo, toMove, cur: 0, order: [0, 1, 2], ctx: { war, revolt, unite: false, pos: 5 },
      hand: me == null ? null : [2, 3, 0, 1], preview: null, bagPct: 50, board: { treasure: [] },
      players: SEATS.map((s) => ({ seat: s.id, score: [1, 1, 1, 1], treasures: 0 })),
    },
  };
}

function dock() {
  const bound = {};
  const box = {
    hidden: true, className: '', innerHTML: '',
    querySelector: (sel) => (box.innerHTML.includes(sel.slice(1)) ? { addEventListener: (ev, fn) => { bound[sel] = fn; } } : null),
    querySelectorAll: () => [],
  };
  return { box, bound };
}

const calls = () => ({ move: () => {}, redraw: () => {}, undo: () => {} });

test('панель: у участника, пока решает соперник', () => {
  const v = view(0, { conflict: k({ attN: 2 }) });
  assert.equal(warActive(v), false);
  assert.equal(warWaiting(v), true, 'атакующий ждет защитника');
  assert.equal(warWaiting(view(1, { toMove: 0 })), true, 'защитник ждет атакующего');
});

test('панель: не показывается третьему игроку, зрителю и тому, кто сам решает', () => {
  assert.equal(warWaiting(view(2)), false, 'третий игрок');
  assert.equal(warWaiting(view(null)), false, 'зритель');
  assert.equal(warWaiting(view(0, { legal: [{ n: 0 }] })), false, 'решает сам');
  assert.equal(warWaiting(view(0, { phase: 'action', conflict: null })), false, 'боя нет');
  const over = view(0);
  over.game.over = true;
  assert.equal(warWaiting(over), false, 'партия окончена');
  const stopped = view(0);
  stopped.game.stopped = true;
  assert.equal(warWaiting(stopped), false, 'организатор завершил партию посреди боя');
});

test('панель: восстание берется из своего поля', () => {
  const v = view(0, { phase: 'revoltSupport', conflict: k({ color: 0, leaderColor: 2 }) });
  assert.equal(warWaiting(v), true);
  assert.equal(warWaiting(view(2, { phase: 'revoltSupport', conflict: k({ color: 0, leaderColor: 2 }) })), false);
});

test('панель атакующего: своя поддержка видна, защитник решает, решений и руки нет', () => {
  const { box } = dock();
  const state = renderWarDock(box, view(0, { conflict: k({ attN: 2 }) }), { collapsed: false, chosen: new Set() }, calls());
  assert.equal(state, 'wait');
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /Вы атакуете, защищается Соня/);
  assert.match(box.innerHTML, /<div class="stot">5<\/div>/, 'сила атаки с поддержкой');
  assert.match(box.innerHTML, /4<small>\+\?<\/small>/, 'ответ защитника неизвестен');
  assert.match(box.innerHTML, /<em>решает<\/em>/);
  assert.match(box.innerHTML, /Ждём решения: Соня/);
  for (const hidden of ['class="myhand"', 'id="wSend"', 'id="wZero"', 'class="orows"', 'class="facts"', 'Ваша рука']) {
    assert.ok(!box.innerHTML.includes(hidden), hidden);
  }
});

test('панель защитника: атакующий решает, свою очередь видно, рука не показывается', () => {
  const { box } = dock();
  renderWarDock(box, view(1, { toMove: 0 }), { collapsed: false, chosen: new Set() }, calls());
  assert.match(box.innerHTML, /Атакует Денис, вы защищаетесь/);
  assert.match(box.innerHTML, /3<small>\+\?<\/small>/);
  assert.match(box.innerHTML, /<em>решает<\/em>/);
  assert.match(box.innerHTML, /вы ответите следом/);
  assert.match(box.innerHTML, /Ждём решения: Денис/);
  assert.ok(!box.innerHTML.includes('нажмите тайлы'));
});

test('панель: атакующий ничего не добавил, подсказка про руку не появляется', () => {
  const { box } = dock();
  renderWarDock(box, view(0, { conflict: k({ attN: 0 }) }), { collapsed: false, chosen: new Set() }, calls());
  assert.ok(!box.innerHTML.includes('нажмите тайлы'));
  assert.match(box.innerHTML, /<em>ничего<\/em>/);
});

test('кнопка отмены: только когда сервер разрешил, и зовет отмену', () => {
  const none = dock();
  renderWarDock(none.box, view(0, { conflict: k({ attN: 1 }) }), { collapsed: false, chosen: new Set() }, calls());
  assert.ok(!none.box.innerHTML.includes('Отменить нападение'));

  const yes = dock();
  let undone = 0;
  renderWarDock(yes.box, view(0, { conflict: k({ attN: 1 }), canUndo: true }), { collapsed: false, chosen: new Set() }, { ...calls(), undo: () => undone++ });
  assert.match(yes.box.innerHTML, /Отменить нападение/);
  yes.bound['#wUndo']();
  assert.equal(undone, 1);
});

test('кнопка отмены: есть и в своем окне поддержки', () => {
  const { box } = dock();
  const v = view(0, { legal: [{ type: 'support', n: 0 }, { type: 'support', n: 2 }], canUndo: true, toMove: 0 });
  v.game.preview = { options: [] };
  const state = renderWarDock(box, v, { collapsed: false, chosen: new Set() }, calls());
  assert.equal(state, 'decide');
  assert.match(box.innerHTML, /Отменить нападение/);
  assert.match(box.innerHTML, /id="wSend"/, 'решения на месте');
});

test('кнопка отмены: есть и в выборе войны', () => {
  const { box } = dock();
  const v = view(0, { phase: 'warChoose', conflict: null, legal: [{ type: 'warColor', color: 1 }], canUndo: true, toMove: 0 });
  v.game.preview = { options: [{ color: 1, att: 0, def: 1, attBoard: 2, defBoard: 1 }] };
  assert.equal(renderWarDock(box, v, { collapsed: false, chosen: new Set() }, calls()), 'decide');
  assert.match(box.innerHTML, /Отменить нападение/);
});

test('свернутая панель ожидания называет, кого ждем', () => {
  const { box } = dock();
  const state = renderWarDock(box, view(0, { conflict: k({ attN: 1 }) }), { collapsed: true, chosen: new Set() }, calls());
  assert.equal(state, 'wait');
  assert.equal(box.className, 'modal pill');
  assert.match(box.innerHTML, /Ждём решения: Соня/);
});

test('отмена укоротила журнал: новый бой не считается увиденным', () => {
  const log = [{ ev: 'tile' }, { ev: 'undo' }, { ev: 'revolt' }];
  assert.equal(seenAfterUndo(log, 4), 2, 'метка стояла за новым хвостом журнала');
  assert.deepEqual(battlesIn(log, seenAfterUndo(log, 4)).map((b) => b.i), [2]);
});

test('отмена не возвращает бои, увиденные до нее', () => {
  assert.equal(seenAfterUndo([{ ev: 'war' }, { ev: 'tile' }, { ev: 'undo' }], 1), 1);
  assert.equal(seenAfterUndo([{ ev: 'war' }], 1), 1, 'отмены в журнале нет');
});

test('момент партии: отмена считается новым моментом, даже если ход и фаза те же', () => {
  const v = (logEpoch) => ({ code: 'ABC', game: { turn: 24, actionNo: 1, phase: 'warSupport', toMove: 1, logEpoch } });
  assert.equal(momentKey(v(1)), momentKey(v(1)));
  assert.notEqual(momentKey(v(1)), momentKey(v(2)));
});

test('боя нет: панель скрыта', () => {
  const { box } = dock();
  assert.equal(renderWarDock(box, view(0, { phase: 'action', conflict: null }), { collapsed: false, chosen: new Set() }, calls()), false);
  assert.equal(box.hidden, true);
});
