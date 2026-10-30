// Частота опроса стола: медленнее там, где от других ничего не ждут (лимит команд Upstash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollDelay } from '../public/js/poll.js';

const seats = [{ id: 0, kind: 'human' }, { id: 1, kind: 'human' }, { id: 2, kind: 'human' }, { id: 3, kind: 'bot' }];
const playing = (toMove, me, extra = {}) => ({ status: 'playing', me, seats, game: { toMove, clock: {}, ...extra } });

test('опрос: пока вида нет, обычный темп', () => {
  assert.equal(pollDelay(null, false), 1200);
  assert.equal(pollDelay(null, true), 10000);
});

test('опрос: чужой ход ждем часто, свой ход редко, бота и окно подтверждения не тормозим', () => {
  assert.equal(pollDelay(playing(1, 0), false), 2000, 'ходит другой человек');
  assert.equal(pollDelay(playing(0, 0), false), 5000, 'мой ход: чужие ничего не меняют');
  assert.equal(pollDelay(playing(3, 0), false), 1200, 'ходит бот: его ход нужно подхватить сразу');
  assert.equal(pollDelay(playing(0, 0, { clock: { confirmBy: 1 } }), false), 1200, 'окно подтверждения: срок вышел, кто-то должен завершить ход');
  assert.equal(pollDelay(playing(1, null), false), 2000, 'зритель');
});

test('опрос: лобби, законченный и закрытый стол', () => {
  assert.equal(pollDelay({ status: 'lobby', seats, game: null }, false), 2000);
  assert.equal(pollDelay({ status: 'over', seats, game: {}, next: null }, false), 5000, 'ждем, не нажал ли кто реванш');
  assert.equal(pollDelay({ status: 'over', seats, game: {}, next: 'ABC123' }, false), 30000, 'реванш уже есть');
  assert.equal(pollDelay({ status: 'closed', seats, game: {} }, false), 30000);
});

test('опрос: скрытая вкладка реже, законченный стол еще реже', () => {
  assert.equal(pollDelay(playing(1, 0), true), 10000);
  assert.equal(pollDelay({ status: 'lobby', seats, game: null }, true), 10000);
  assert.equal(pollDelay({ status: 'over', seats, game: {} }, true), 60000);
  assert.equal(pollDelay({ status: 'closed', seats, game: {} }, true), 60000);
});

test('опрос: ни одна пауза не короче секунды и не длиннее минуты', () => {
  const views = [null, playing(1, 0), playing(0, 0), playing(3, 0), { status: 'lobby', seats, game: null }, { status: 'over', seats, game: {} }, { status: 'closed', seats, game: {} }];
  for (const v of views) for (const hidden of [false, true]) {
    const d = pollDelay(v, hidden);
    assert.ok(d >= 1000 && d <= 60000, `${v?.status} hidden=${hidden}: ${d}`);
  }
});
