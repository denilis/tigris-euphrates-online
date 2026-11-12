// Окно итога (Денис 12.11): крестик «Закрыть» и Esc делают то же, что «Посмотреть поле»,
// шапка партии с меню остается над итогом, окно начинается под ней.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEnd } from '../public/js/end.js';

// в node нет окна: подменяем то, чем пользуется end.js
const keys = [];
let scrolled = 0;
let shotOpen = false;
globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
globalThis.scrollTo = () => { scrolled++; };
globalThis.document = {
  querySelector: (sel) => (sel === '.shot' && shotOpen ? {} : null),
  createElement: () => ({ addEventListener() {}, remove() {} }),
};

function fakeBox() {
  const cls = new Set();
  const on = {};
  const box = {
    hidden: true, innerHTML: '', dataset: {}, isConnected: true, on, reopen: null,
    classList: { toggle: (c, v) => (v ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    querySelector(sel) {
      const id = sel.slice(1);
      return this.innerHTML.includes(`id="${id}"`) ? { addEventListener: (t, fn) => { on[id] = fn; } } : null;
    },
    parentElement: { querySelector: () => null, append: (el) => { box.reopen = el; } },
  };
  return box;
}

const seats = [{ id: 0, name: 'Денис', hero: 'pot' }, { id: 1, name: 'Бот', hero: 'lion', kind: 'bot' }];
const result = { seats: [{ seatId: 0, place: 1, vector: [12], score: [12, 13, 14, 15], treasures: 1 }, { seatId: 1, place: 2, vector: [9], score: [9, 10, 11, 12], treasures: 0 }] };
const over = () => ({ code: 'ABC', me: 0, status: 'over', seats, game: { result, log: [], order: [0, 1], turn: 3, endReason: 'bag' } });
const stopped = () => ({ code: 'ABC', me: 0, status: 'over', seats, game: { stopped: true } });
const ctl = { act: async () => null, go: () => {} };
const esc = (key = 'Escape') => keys.at(-1)?.({ key, preventDefault() {} });

test('у итога и у досрочно завершенной партии есть крестик «Закрыть»', () => {
  for (const view of [over(), stopped()]) {
    const box = fakeBox();
    renderEnd(box, view, ctl);
    assert.match(box.innerHTML, /<button[^>]*id="eX"[^>]*aria-label="Закрыть"/);
    assert.ok(box.on.eX, 'крестик слушает нажатие');
  }
});

test('крестик закрывает итог, как «Посмотреть поле», и оставляет кнопку «Итог партии»', () => {
  const box = fakeBox();
  renderEnd(box, over(), ctl);
  assert.equal(box.hidden, false);
  box.on.eX();
  assert.equal(box.hidden, true);
  assert.equal(box.dataset.closed, 'ABC');
  assert.equal(box.reopen?.textContent, 'Итог партии');
});

test('Esc закрывает итог, другие клавиши нет', () => {
  const box = fakeBox();
  renderEnd(box, over(), ctl);
  esc('Enter');
  assert.equal(box.hidden, false);
  esc();
  assert.equal(box.hidden, true);
  assert.equal(box.dataset.closed, 'ABC');
});

test('Esc не закрывает итог, пока сверху открыта «Картинка итога»', () => {
  const box = fakeBox();
  renderEnd(box, over(), ctl);
  shotOpen = true;
  esc();
  shotOpen = false;
  assert.equal(box.hidden, false);
});

test('слушатель Esc один, сколько бы раз ни перерисовывали итог', () => {
  const box = fakeBox();
  for (let k = 0; k < 5; k++) renderEnd(box, over(), ctl);
  assert.equal(keys.length, 1);
});

test('при открытии итога страница встает наверх, к шапке, а при перерисовке нет', () => {
  const box = fakeBox();
  const before = scrolled;
  renderEnd(box, over(), ctl);
  assert.equal(scrolled, before + 1);
  renderEnd(box, over(), ctl);
  assert.equal(scrolled, before + 1);
});

test('шапка над окном итога, окно начинается под шапкой', () => {
  const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.endwrap\{[^}]*top:var\(--toph,0px\)/);
  assert.match(css, /\.app:has\(> \.endwrap:not\(\[hidden\]\)\) > \.top\{position:relative;z-index:61\}/);
  const game = readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
  assert.match(game, /setProperty\('--toph', /);
});
