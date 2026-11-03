// Сигналы «ваш ход»: когда звучит щелчок и звон, что пишется в заголовке вкладки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapOf, soundsFor, titleFor } from '../public/js/signals.js';

const view = (turn, cur, legal = null, extra = {}) => ({ code: 'AAAAAA', game: { turn, cur, legal, over: false, stopped: false, ...extra } });

test('звуки: при первом взгляде на стол тишина', () => {
  assert.deepEqual(soundsFor(null, snapOf(view(5, 1, [{}]))), { tick: false, chime: false });
  const other = { ...snapOf(view(5, 1)), code: 'BBBBBB' };
  assert.deepEqual(soundsFor(other, snapOf(view(6, 2, [{}]))), { tick: false, chime: false }, 'другой стол');
});

test('звуки: щелчок на смене хода, звон, когда решать вам (без щелчка поверх)', () => {
  const a = snapOf(view(5, 1));
  assert.deepEqual(soundsFor(a, snapOf(view(5, 1))), { tick: false, chime: false }, 'ничего не изменилось');
  assert.deepEqual(soundsFor(a, snapOf(view(5, 2))), { tick: true, chime: false }, 'ход перешел к другому');
  assert.deepEqual(soundsFor(a, snapOf(view(6, 0, [{}]))), { tick: false, chime: true }, 'ход перешел ко мне');
  const mine = snapOf(view(6, 0, [{}]));
  assert.deepEqual(soundsFor(mine, snapOf(view(6, 0, [{}]))), { tick: false, chime: false }, 'второе действие того же хода');
  assert.deepEqual(soundsFor(a, snapOf(view(5, 1, [{}]))), { tick: false, chime: true }, 'решать в чужом ходу: защита в бою');
  assert.equal(snapOf(view(6, 0, [{}], { over: true })).mine, false, 'партия кончилась: решать нечего');
});

test('заголовок: свой ход отмечен, просрочка мигает, чужой ход возвращает прежний заголовок', () => {
  const base = 'Тигр и Евфрат';
  assert.equal(titleFor(base, false, false, 0), base);
  assert.equal(titleFor(base, true, false, 0), '● Ваш ход | ' + base);
  assert.equal(titleFor(base, true, true, 1000), 'Сделайте ход! | ' + base);
  assert.equal(titleFor(base, true, true, 2000), '● Ваш ход | ' + base);
  assert.equal(titleFor('Сделайте ход! | ' + base, false, false, 0), base, 'ход сделан: метка уходит');
  const invite = '(1) Приглашение | ' + base;
  assert.equal(titleFor(invite, true, false, 0), '● Ваш ход | ' + invite, 'приглашение не теряется');
});
