// Фон итога партии (Денис 04.11): за итогом картина праздника, у досрочно завершенной партии ее нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEnd } from '../public/js/end.js';

function fakeBox() {
  const cls = new Set();
  return {
    hidden: true, innerHTML: '', dataset: {},
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    // находит только то, что есть в разметке: иначе «нашелся» бы блок разбора и потянул модуль браузера
    querySelector(sel) { return this.innerHTML.includes(`id="${sel.slice(1)}"`) ? { addEventListener() {} } : null; },
    parentElement: { querySelector: () => null, append() {} },
  };
}

const seats = [{ id: 0, name: 'Денис', hero: 'pot' }, { id: 1, name: 'Бот', hero: 'lion', kind: 'bot' }];
const result = { seats: [{ seatId: 0, place: 1, vector: [12], score: [12, 13, 14, 15], treasures: 1 }, { seatId: 1, place: 2, vector: [9], score: [9, 10, 11, 12], treasures: 0 }] };
const ctl = { act: async () => null, go: () => {} };

test('итог партии на фоне праздника', () => {
  const box = fakeBox();
  renderEnd(box, { code: 'ABC', me: 0, status: 'over', seats, game: { result, log: [], order: [0, 1], turn: 3, endReason: 'bag' } }, ctl);
  assert.equal(box.hidden, false);
  assert.equal(box.classList.contains('feast'), true);
  assert.match(box.innerHTML, /Партия окончена/);
});

test('досрочно завершенная партия без праздника', () => {
  const box = fakeBox();
  box.classList.toggle('feast', true); // был итог другой партии
  renderEnd(box, { code: 'ABC', me: 0, status: 'over', seats, game: { stopped: true } }, ctl);
  assert.equal(box.hidden, false);
  assert.equal(box.classList.contains('feast'), false);
  assert.match(box.innerHTML, /Партия завершена/);
});
