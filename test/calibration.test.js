// Калибровочный турнир ботов (Денис 05.11): ступени совпадают с карточками ботов, рейтинги
// Брэдли-Терри восстанавливают заданные шансы, бот по умолчанию стоит на 1500.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../tools/calibration-levels.mjs';
import { STRENGTH_GUIDE } from '../public/js/bot-steps.js';
import { outcomes, fitRatings, winChance } from '../tools/calibration-report.mjs';

test('ступени турнира: самая слабая и четыре из карточек ботов, по возрастанию силы', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ['min', 'learn', 'casual', 'sure', 'max']);
  assert.deepEqual(LEVELS.slice(1).map((l) => l.set), STRENGTH_GUIDE.map((g) => g.set));
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].set.strength > LEVELS[i - 1].set.strength);
});

test('рейтинги: заданные шансы восстанавливаются, бот по умолчанию 1500', () => {
  // ступень i выигрывает у j с шансом по рейтингам 1100, 1300, 1500, 1650, 1800
  const truth = [1100, 1300, 1500, 1650, 1800];
  const games = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    const wins = Math.round(400 * winChance(truth[a], truth[b]));
    for (let k = 0; k < 400; k++) games.push({ seats: [LEVELS[a].id, LEVELS[b].id], place: k < wins ? [1, 2] : [2, 1] });
  }
  const r = fitRatings(outcomes(games));
  assert.equal(Math.round(r[2]), 1500);
  r.forEach((x, i) => assert.ok(Math.abs(x - truth[i]) < 25, `${i}: ${x} против ${truth[i]}`));
  assert.equal(Math.round(100 * winChance(1500, 1500)), 50);
});

test('ничья идет пополам, партии не вдвоем пропускаются', () => {
  const res = outcomes([
    { seats: ['min', 'max'], place: [1, 1] },
    { seats: ['min', 'max', 'casual'], place: [1, 2, 3] },
  ]);
  assert.deepEqual(res, [{ a: 0, b: 4, sa: 0.5 }]);
});
