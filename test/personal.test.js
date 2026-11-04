// Личная статистика (просьба Дениса 04.11): все партии игрока, с ботами и с людьми, по турнирам
// и BGA; расчеты страницы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerGames, SEASON } from '../server/stats.js';
import { BGA_GAMES } from '../server/season-bga.js';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';

const at = Date.UTC(2026, 10, 2, 12);
const seat = (seatId, name, place, score, extra = {}) => ({ seatId, kind: 'human', userId: `u-${name}`, name, place, vector: [score, score + 1, score + 2, score + 3], d: null, ...extra });
const bot = (seatId, place, score) => ({ seatId, kind: 'bot', userId: null, name: 'Бот', place, vector: [score, 20, 20, 20] });
const entry = (id, seats, extra = {}) => ({ id, code: `C${id}`, title: `02.11.2026.${id}`, finishedAt: at + Number(id), tour: 'auto', seats, ...extra });

const HISTORY = [
  entry('1', [seat(0, 'Денис', 1, 15, { d: { c: [15, 16, 17, 18], tr: 2, src: { tile: 20 } } }), bot(1, 2, 9), bot(2, 3, 8), bot(3, 4, 7)]),
  entry('2', [seat(0, 'Денис', 2, 10), seat(1, 'Влад', 1, 12), seat(2, 'Андрей', 3, 9)]),
  entry('3', [seat(0, 'Денис', 1, 11), seat(1, 'Соня', 1, 11)]),
  entry('4', [seat(0, 'Влад', 1, 14), bot(1, 2, 3)]),
];

test('партии игрока: BGA по имени, с ботами, сезон на сайте, с людьми вне турниров', () => {
  const g = playerGames({ id: 'u-Денис', name: 'Денис' }, HISTORY, [SEASON]);
  assert.equal(g.filter((x) => x.source === 'bga').length, BGA_GAMES.length);
  const site = g.filter((x) => x.source === 'site');
  assert.deepEqual(site.map((x) => [x.table, x.kind, x.group, x.place, x.win, x.score]), [
    ['02.11.2026.1', 'bots', 'С ботами', 1, true, 15],
    ['02.11.2026.2', 'people', `${SEASON.name} (сайт)`, 2, false, 10],
    ['02.11.2026.3', 'people', 'С людьми вне турниров', 1, false, 11],
  ]);
  assert.equal(site[2].win, false, 'деленное первое место не победа');
  assert.deepEqual(site[0].d.src, { tile: 20 });
  assert.equal(site[0].date, '2026-11-02');
  assert.ok(g.every((x, i) => i === 0 || g[i - 1].at <= x.at), 'от старых к новым');
});

test('партии игрока: без BGA, если имени нет в сезоне; чужие партии не попадают', () => {
  const g = playerGames({ id: 'u-Соня', name: 'Соня' }, HISTORY, [SEASON]);
  assert.deepEqual(g.map((x) => x.table), ['02.11.2026.3']);
});

test('адрес stats/player: свои партии по умолчанию, чужие по id, список игроков', async () => {
  const store = memoryStore();
  const app = createApp({ store, env: { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' }, now: () => at });
  const denis = (await app.call({ method: 'POST', path: 'activate', body: { code: 'ADMN-TEST-2345' } })).body;
  const r = await app.call({ method: 'POST', path: 'admin/users', body: { name: 'Влад' }, token: denis.token });
  const vlad = (await app.call({ method: 'POST', path: 'activate', body: { code: r.body.code } })).body;
  const mine = await app.call({ method: 'GET', path: 'stats/player', token: denis.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.player.name, 'Денис');
  assert.deepEqual(mine.body.players.map((p) => p.name), ['Влад', 'Денис']);
  assert.equal(mine.body.games.length, BGA_GAMES.length, 'у Дениса партии BGA');
  const his = await app.call({ method: 'GET', path: 'stats/player', query: { id: vlad.user.id }, token: denis.token });
  assert.equal(his.body.player.name, 'Влад');
  assert.equal((await app.call({ method: 'GET', path: 'stats/player' })).status, 401);
  assert.equal((await app.call({ method: 'GET', path: 'stats/player/x', token: denis.token })).body.player, undefined);
});

// --- расчеты страницы
import { pick, summary, byGroup, winStreak, details, pointSources, weakest, monthly, extraRecords, one } from '../public/js/personal.js';

const D = (c, src, extra = {}) => ({ c, tr: 2, src: { tile: 0, building: 0, monument: 0, war: 0, revolt: 0, ...src }, war: [1, 0, 0, 1], revolt: [0, 0, 1, 0], mon: 1, cat: 0, big: 6, ...extra });
const G = [
  { date: '2026-09-10', kind: 'bga', group: 'BGA', place: 1, win: true, score: 15, d: D([15, 18, 20, 16], { tile: 10, war: 6 }) },
  { date: '2026-10-05', kind: 'people', group: 'Сезон', place: 2, win: false, score: 10, d: D([10, 12, 10, 14], { tile: 6, monument: 4 }, { mon: 3 }) },
  { date: '2026-10-20', kind: 'bots', group: 'С ботами', place: 1, win: true, score: 12, d: null },
  { date: '2026-11-02', kind: 'bots', group: 'С ботами', place: 1, win: true, score: 14, d: D([14, 20, 20, 20], { war: 9 }) },
];

test('личная: отбор по периоду и виду', () => {
  assert.equal(pick(G).length, 4);
  assert.deepEqual(pick(G, { kind: 'bots' }).map((g) => g.date), ['2026-10-20', '2026-11-02']);
  assert.deepEqual(pick(G, { from: '2026-10-01', to: '2026-10-31' }).map((g) => g.kind), ['people', 'bots']);
});

test('личная: полоса цифр и «Где играл»', () => {
  const s = summary(G);
  assert.deepEqual([s.n, s.wins, s.pct, s.place, s.score], [4, 3, 75, 1.25, 12.75]);
  assert.deepEqual(byGroup(G).map((r) => [r.group, r.n, r.wins]), [['BGA', 1, 1], ['Сезон', 1, 0], ['С ботами', 2, 2]]);
  assert.deepEqual(summary([]), { n: 0, wins: 0, pct: null, place: null, score: null });
});

test('личная: серия побед, подробности как у турнира из одного игрока', () => {
  assert.equal(winStreak(G), 2);
  const d = details(G);
  assert.equal(d.count, 3, 'партия без подробностей не считается');
  assert.equal(d.players[0].mon, 5);
  assert.deepEqual(d.players[0].war, [3, 0, 0, 3]);
  assert.equal(d.records.streak.v, 2);
  assert.equal(d.records.score.v, 15);
});

test('личная: откуда очки вместе с сокровищами, слабейший цвет, месяцы, рекорды', () => {
  const src = pointSources(G);
  const by = Object.fromEntries(src.map((x) => [x.key, x]));
  assert.equal(by.tile.sum, 16);
  assert.equal(by.tr.sum, 6);
  assert.equal(one(by.tile.perGame), '5,3');
  assert.equal(src.reduce((a, x) => a + x.sum, 0), 16 + 4 + 15 + 6);
  assert.deepEqual(weakest(G), { n: [3, 0, 1, 0], games: 3 }, 'во второй партии красный и зеленый поровну слабейшие');
  assert.deepEqual(monthly(G).map((m) => [m.month, m.n, m.pct]), [['2026-09', 1, 100], ['2026-10', 2, 50], ['2026-11', 1, 100]]);
  const r = extraRecords(G);
  assert.equal(r.war.v, 9);
  assert.equal(r.mon.v, 3);
});
