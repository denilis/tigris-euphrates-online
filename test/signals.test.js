// Сигналы «ваш ход»: когда звучит щелчок и звон, что пишется в заголовке вкладки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapOf, soundsFor, titleFor, newEntries, eventSounds } from '../public/js/signals.js';

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

// Звуки событий (просьба Дениса 04.11): только новое в журнале, не больше трех, по важности.

const withLog = (log, extra = {}) => ({ code: 'AAAAAA', game: { turn: 3, cur: 0, legal: null, over: false, stopped: false, log, logTotal: log.length, logEpoch: 0, ...extra } });

test('звуки событий: только записи, появившиеся с прошлого взгляда', () => {
  const a = [{ ev: 'tile' }, { ev: 'tile' }];
  const b = [...a, { ev: 'war', winner: 1 }, { ev: 'score' }];
  assert.deepEqual(newEntries(null, withLog(b)), [], 'первый взгляд');
  assert.deepEqual(newEntries(snapOf(withLog(a)), withLog(b)).map((e) => e.ev), ['war', 'score']);
  assert.deepEqual(newEntries(snapOf(withLog(b)), withLog(b)), [], 'ничего нового');
  assert.deepEqual(newEntries(snapOf(withLog(a)), withLog(b, { logEpoch: 1 })), [], 'отмена: журнал перечитан');
  assert.deepEqual(newEntries({ ...snapOf(withLog(a)), code: 'BBBBBB' }, withLog(b)), [], 'другой стол');
  assert.deepEqual(newEntries(snapOf(withLog(a)), withLog(b.slice(0, 3), { logTotal: 4 })), [], 'журнал пришел не целиком');
});

test('звуки событий: бой, своя победа, монумент, катастрофа, сокровище, конец', () => {
  assert.deepEqual(eventSounds([{ ev: 'war', winner: 2 }], 1), ['battle']);
  assert.deepEqual(eventSounds([{ ev: 'revolt', winner: 1 }], 1), ['battle', 'victory']);
  assert.deepEqual(eventSounds([{ ev: 'monument' }, { ev: 'treasure' }], 0), ['monument', 'treasure']);
  assert.deepEqual(eventSounds([{ ev: 'catastrophe' }], null), ['catastrophe']);
  assert.deepEqual(eventSounds([{ ev: 'tile' }, { ev: 'score' }], 0), []);
  const all = [{ ev: 'treasure' }, { ev: 'catastrophe' }, { ev: 'monument' }, { ev: 'war', winner: 0 }, { ev: 'gameOver' }];
  assert.deepEqual(eventSounds(all, 0), ['gameover', 'battle', 'victory'], 'не больше трех, важное первым');
});
