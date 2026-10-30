// Зачет сезона на сайте: 60 партий с BGA и новые партии, где сели все трое.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BGA_GAMES } from '../server/season-bga.js';
import { seasonGames, seasonPoints, siteGame, SEASON_PLAYERS } from '../server/stats.js';
import { totals, cumulative, inRange, ranking, slot } from '../public/js/season.js';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

const human = (name, place, vector) => ({ kind: 'human', userId: name, name, hero: 'pot', place, vector });
const entry = (over = {}) => ({
  id: 'g1', finishedAt: Date.UTC(2026, 10, 2, 12), company: 'x', board: 'advanced', title: '02.11.2026.3',
  seats: [human('Денис', 2, [10, 12, 13, 14]), human('Влад', 3, [9, 15, 15, 15]), human('Андрей', 1, [11, 11, 12, 20]), { kind: 'bot', userId: null, name: 'Бот Влад', hero: 'bow', place: 4, vector: [1, 2, 3, 4] }],
  ...over,
});

test('перенос: 60 партий, итог совпадает со страницей зачета', () => {
  const games = seasonGames([]);
  assert.equal(games.length, 60);
  assert.deepEqual(SEASON_PLAYERS, ['Денис', 'Влад', 'Андрей']);
  assert.deepEqual(totals(games).pts, [151, 128, 139]);
  assert.equal(games[0].date, '2026-03-20');
  assert.equal(games.at(-1).date, '2026-10-23');
  assert.ok(games.every((g, i) => i === 0 || g.date >= games[i - 1].date), 'от старых к новым');
});

test('шкала 4/2/1 дает те же очки, что записаны в 60 партиях', () => {
  for (const [, table, , place, pts] of BGA_GAMES) assert.deepEqual(seasonPoints(place), pts, String(table));
});

test('деленное первое: по 2, третий 1; деленное второе не наказывает', () => {
  assert.deepEqual(seasonPoints([1, 1, 3]), [2, 2, 1]);
  assert.deepEqual(seasonPoints([3, 1, 2]), [1, 4, 2]);
  assert.deepEqual(seasonPoints([1, 2, 2]), [4, 2, 2]);
  assert.deepEqual(seasonPoints([1, 1, 1]), [2, 2, 2]);
});

test('партия сайта: все трое за столом, бот не считается, места среди людей', () => {
  const g = siteGame(entry());
  assert.equal(g.date, '2026-11-02');
  assert.equal(g.source, 'site');
  assert.equal(g.table, '02.11.2026.3');
  assert.deepEqual(g.score, [10, 9, 11], 'счет это слабейший цвет');
  assert.deepEqual(g.place, [2, 3, 1]);
  assert.deepEqual(g.pts, [2, 1, 4]);
});

test('партия сайта: бот выше людей мест не сдвигает', () => {
  const e = entry();
  e.seats[3].vector = [30, 30, 30, 30];
  e.seats[3].place = 1;
  assert.deepEqual(siteGame(e).place, [2, 3, 1]);
});

test('партия сайта: ничья по всем цветам делит первое место', () => {
  const v = [10, 12, 13, 14];
  const g = siteGame(entry({ seats: [human('Денис', 1, v), human('Влад', 1, v), human('Андрей', 3, [9, 9, 9, 9])] }));
  assert.deepEqual(g.pts, [2, 2, 1]);
});

test('партия сайта: дата по Москве', () => {
  assert.equal(siteGame(entry({ finishedAt: Date.UTC(2026, 10, 2, 21, 30) })).date, '2026-11-03');
});

test('в зачет не идут партии без кого-то из троих и с четвертым человеком', () => {
  const e = entry();
  assert.equal(siteGame({ ...e, seats: e.seats.slice(0, 2) }), null, 'двое');
  assert.equal(siteGame({ ...e, seats: [e.seats[0], e.seats[1], human('Петя', 1, [1, 1, 1, 1])] }), null, 'чужой');
  assert.equal(siteGame({ ...e, seats: [...e.seats.slice(0, 3), human('Петя', 4, [1, 1, 1, 1])] }), null, 'четвертый человек');
});

test('имена сверяются без учета регистра и пробелов по краям', () => {
  const e = entry();
  e.seats[1].name = ' влад ';
  assert.ok(siteGame(e));
});

test('новые партии идут после партий BGA в порядке окончания', () => {
  const later = entry({ id: 'g2', finishedAt: Date.UTC(2026, 10, 3, 12), title: 'поздняя' });
  const games = seasonGames([later, entry()]);
  assert.equal(games.length, 62);
  assert.deepEqual(games.slice(-2).map((g) => g.table), ['02.11.2026.3', 'поздняя']);
});

test('расчеты страницы: места, накопленные очки, период, порядок на пьедестале', () => {
  const games = seasonGames([]);
  const t = totals(games);
  assert.equal(t.places[0].reduce((a, b) => a + b, 0), 60);
  assert.equal(t.places[0][1], 1, 'у Дениса одна делёная победа');
  assert.equal(t.places[1][1], 1, 'у Влада тоже');
  assert.equal(t.places[2][1], 0);
  assert.deepEqual(ranking(t), [0, 2, 1], 'Денис, Андрей, Влад');

  const cum = cumulative(games);
  assert.equal(cum.length, 61);
  assert.deepEqual(cum[0], [0, 0, 0]);
  assert.deepEqual(cum.at(-1), [151, 128, 139]);

  assert.equal(inRange(games, '2026-08-23', '').length, 22, 'после сверки 22.08');
  assert.deepEqual(totals(inRange(games, '2026-08-23', '')).pts, [52, 53, 49]);
  assert.equal(inRange(games, '', '2026-03-20').length, 1);
  assert.equal(inRange(games, '2027-01-01', '').length, 0);
  assert.deepEqual(totals([]).pts, [0, 0, 0]);
});

test('слот места: первое, деленное, второе, третье', () => {
  const g = { place: [1, 1, 3] };
  assert.deepEqual([0, 1, 2].map((i) => slot(g, i)), [1, 1, 3]);
  assert.deepEqual([0, 1, 2].map((i) => slot({ place: [2, 1, 3] }, i)), [2, 0, 3]);
});

for (const [name, make] of [['память', () => memoryStore()], ['Redis', () => redisStore({ exec: fakeUpstash().exec, prefix: 'test:' })]]) {
  test(`хранилище ${name}: партии можно перечислить, повторная запись не дублирует`, async () => {
    const s = make();
    assert.deepEqual(await s.listHistory(), []);
    assert.equal(await s.addHistory(entry()), true);
    assert.equal(await s.addHistory(entry()), false);
    await s.addHistory(entry({ id: 'g2' }));
    assert.deepEqual((await s.listHistory()).map((e) => e.id).sort(), ['g1', 'g2']);
  });
}

test('API: статистика только после входа, в ней 60 партий и новая партия сайта', async () => {
  const store = memoryStore();
  const app = createApp({ store, env: ENV, now: () => Date.UTC(2026, 10, 2, 12), botOptions: { timeCap: 20 } });
  assert.equal((await app.call({ method: 'GET', path: 'stats' })).status, 401);
  const { token } = (await app.call({ method: 'POST', path: 'activate', body: { code: 'ADMN-TEST-2345' } })).body;
  await store.addHistory(entry());
  const r = await app.call({ method: 'GET', path: 'stats', token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.players, SEASON_PLAYERS);
  assert.equal(r.body.games.length, 61);
  assert.equal(r.body.games.at(-1).table, '02.11.2026.3');
});
