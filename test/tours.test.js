// Турниры: у каждого своя статистика, партия попадает в турнир по составу или по выбору организатора.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';
import { SEASON, seasonPoints, tourOf, tourGames } from '../server/stats.js';
import { createTable, setOptions, TableError, DEFAULT_OPTIONS } from '../game/table.js';
import { totals, cumulative, ranking, slot, fitTours, tourChoice } from '../public/js/season.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

function setup(store = memoryStore()) {
  let clock = 1_800_000_000_000;
  const app = createApp({ store, env: ENV, now: () => clock++ });
  const req = (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query });
  return { req, store };
}

async function people(s, ...names) {
  const denis = (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const out = { Денис: denis };
  for (const name of names) {
    const r = await s.req('POST', 'admin/users', { body: { name }, token: denis.token });
    out[name] = (await s.req('POST', 'activate', { body: { code: r.body.code } })).body;
  }
  return out;
}

const human = (user, place, vector) => ({ kind: 'human', userId: user.user.id, name: user.user.name, place, vector });
const bot = { kind: 'bot', userId: null, name: 'Бот', place: 4, vector: [0, 0, 0, 0] };
let n = 0;
const game = (seats, extra = {}) => ({ id: `g${++n}`, title: `31.10.2026.${n}`, finishedAt: 1_900_000_000_000, seats, ...extra });

test('шкала: четвертое место без очков, двое как обычно', () => {
  assert.deepEqual(seasonPoints([1, 2, 3, 4]), [4, 2, 1, 0]);
  assert.deepEqual(seasonPoints([2, 1]), [2, 4]);
  assert.deepEqual(seasonPoints([1, 1]), [2, 2]);
});

test('сезон всегда первый в списке, люди для окна турнира без кодов', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  const r = (await s.req('GET', 'tournaments', { token: P.Петя.token })).body;
  assert.equal(r.tours[0].id, 'season');
  assert.deepEqual(r.tours[0].players, ['Денис', 'Влад', 'Андрей']);
  assert.deepEqual(r.people.map((p) => p.name).sort(), ['Денис', 'Петя']);
  assert.ok(r.people.every((p) => Object.keys(p).sort().join() === 'id,name'), 'только имя и номер');
  assert.equal((await s.req('GET', 'tournaments')).status, 401);
});

test('турнир заводит любой вошедший, неверный отклоняется', async () => {
  const s = setup();
  const P = await people(s, 'Петя', 'Вася', 'Коля', 'Женя');
  const id = (k) => P[k].user.id;
  const add = (body) => s.req('POST', 'tournaments', { body, token: P.Петя.token });
  const ok = await add({ name: '  Кубок двора ', players: [id('Петя'), id('Вася')] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.name, 'Кубок двора');
  assert.deepEqual(ok.body.players, ['Петя', 'Вася']);
  assert.equal((await add({ name: '', players: [id('Петя'), id('Вася')] })).status, 400, 'без названия');
  assert.equal((await add({ name: 'x'.repeat(41), players: [id('Петя'), id('Вася')] })).status, 400, 'длинное');
  assert.equal((await add({ name: 'кубок двора', players: [id('Петя'), id('Вася')] })).status, 409, 'такое название есть');
  assert.equal((await add({ name: 'Один', players: [id('Петя')] })).status, 400, 'один человек');
  assert.equal((await add({ name: 'Двое', players: [id('Петя'), id('Петя')] })).status, 400, 'повтор');
  assert.equal((await add({ name: 'Пятеро', players: Object.values(P).map((x) => x.user.id) })).status, 400, 'пятеро');
  assert.equal((await add({ name: 'Чужой', players: [id('Петя'), 'u-нет'] })).status, 400, 'нет такого человека');
  assert.equal((await add({ name: 'Строка', players: 'все' })).status, 400);
  await s.req('POST', `admin/users/${id('Коля')}/revoke`, { body: {}, token: P.Денис.token });
  assert.equal((await add({ name: 'Отозван', players: [id('Петя'), id('Коля')] })).status, 400, 'отозванный код');
  assert.equal((await s.req('GET', 'tournaments', { token: P.Петя.token })).body.tours.length, 2);
});

for (const [name, make] of [['память', memoryStore], ['Redis', () => redisStore({ exec: fakeUpstash().exec, prefix: 't:' })]]) {
  test(`своя статистика у каждого турнира: ${name}`, async () => {
    const s = setup(make());
    const P = await people(s, 'Петя', 'Вася', 'Влад', 'Андрей');
    const made = (await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [P.Петя.user.id, P.Вася.user.id] }, token: P.Петя.token })).body;
    await s.store.addHistory(game([human(P.Петя, 2, [3, 4, 5, 6]), human(P.Вася, 1, [7, 7, 7, 7]), bot]));
    await s.store.addHistory(game([human(P.Денис, 1, [9, 9, 9, 9]), human(P.Влад, 2, [5, 5, 5, 5]), human(P.Андрей, 3, [1, 1, 1, 1])]));

    const cup = (await s.req('GET', 'stats', { query: { tour: made.id }, token: P.Денис.token })).body;
    assert.deepEqual(cup.players, ['Петя', 'Вася']);
    assert.equal(cup.tour.name, 'Кубок');
    assert.equal(cup.games.length, 1);
    assert.deepEqual(cup.games[0].score, [3, 7]);
    assert.deepEqual(cup.games[0].pts, [2, 4]);

    const season = (await s.req('GET', 'stats', { token: P.Денис.token })).body;
    assert.equal(season.tour.id, 'season');
    assert.deepEqual(season.players, ['Денис', 'Влад', 'Андрей']);
    assert.equal(season.games.filter((g) => g.source === 'bga').length, 60, 'партии BGA остаются в сезоне');
    assert.equal(season.games.filter((g) => g.source === 'site').length, 1);

    const none = (await s.req('GET', 'stats', { query: { tour: 'нет' }, token: P.Денис.token })).body;
    assert.equal(none.tour.id, 'season', 'неизвестный турнир открывает сезон');
  });
}

test('новый турнир без партий пуст, партии BGA только в сезоне', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  const made = (await s.req('POST', 'tournaments', { body: { name: 'Пусто', players: [P.Денис.user.id, P.Петя.user.id] }, token: P.Петя.token })).body;
  assert.deepEqual((await s.req('GET', 'stats', { query: { tour: made.id }, token: P.Петя.token })).body.games, []);
});

test('выбор организатора: авто, свой турнир или не в зачет', () => {
  const a = { id: 't-a', players: [{ id: 'u1', name: 'А' }, { id: 'u2', name: 'Б' }] };
  const b = { id: 't-b', players: [{ id: 'u2', name: 'Б' }, { id: 'u1', name: 'А' }] };
  const c = { id: 't-c', players: [{ id: 'u1', name: 'А' }, { id: 'u3', name: 'В' }] };
  const tours = [SEASON, a, b, c];
  const seats = [{ kind: 'human', userId: 'u1', name: 'А', place: 1, vector: [5, 5, 5, 5] }, { kind: 'human', userId: 'u2', name: 'Б', place: 2, vector: [1, 1, 1, 1] }];
  assert.equal(tourOf({ seats }, tours).id, 't-a', 'старая запись без выбора: первый по составу');
  assert.equal(tourOf({ seats, tour: 'auto' }, tours).id, 't-a');
  assert.equal(tourOf({ seats, tour: 't-b' }, tours).id, 't-b', 'второй подходящий');
  assert.equal(tourOf({ seats, tour: 'none' }, tours), null, 'не в зачет');
  assert.equal(tourOf({ seats, tour: 't-c' }, tours).id, 't-a', 'чужой состав не подходит, партия идет по составу');
  assert.equal(tourOf({ seats: [...seats, { kind: 'human', userId: 'u3', name: 'В' }] }, tours), null, 'третий человек лишний');
  assert.equal(tourOf({ seats: [...seats, bot] }, tours).id, 't-a', 'бот не считается');
  assert.deepEqual(tourGames(b, tours, [game(seats, { tour: 't-b' })])[0].score, [1, 5], 'порядок игроков как в турнире');
});

test('турнир считает партии только с момента создания', () => {
  const players = [{ id: 'u1', name: 'А' }, { id: 'u2', name: 'Б' }];
  const cup = { id: 't-a', players, createdAt: 1000 };
  const seats = [{ kind: 'human', userId: 'u1', name: 'А', place: 1, vector: [5, 5, 5, 5] }, { kind: 'human', userId: 'u2', name: 'Б', place: 2, vector: [1, 1, 1, 1] }];
  assert.equal(tourOf({ seats, finishedAt: 999 }, [SEASON, cup]), null, 'партия раньше турнира');
  assert.equal(tourOf({ seats, finishedAt: 1000 }, [SEASON, cup]).id, 't-a');
  assert.equal(tourOf({ seats: [{ kind: 'human', userId: 'x', name: 'Денис' }, { kind: 'human', userId: 'y', name: 'Влад' }, { kind: 'human', userId: 'z', name: 'Андрей' }], finishedAt: 1 }, [SEASON]).id, 'season', 'сезон принимает партии любой даты');
});

test('партия с троими из сезона не в зачет, если организатор снял галочку', () => {
  const season = (name, place) => ({ kind: 'human', userId: name, name, place, vector: [place, 1, 1, 1] });
  const seats = [season('Денис', 1), season('Влад', 2), season('Андрей', 3)];
  assert.equal(tourOf({ seats }, [SEASON]).id, 'season');
  assert.equal(tourOf({ seats, tour: 'none' }, [SEASON]), null);
});

test('настройка стола: турнир по умолчанию сам, значение проверяется', () => {
  assert.equal(DEFAULT_OPTIONS.tournament, 'auto');
  const t = createTable({ code: 'ABCDEF', title: null, host: { userId: 'u1', name: 'Денис' }, now: 1 });
  setOptions(t, 'u1', { tournament: 'none' }, 2);
  assert.equal(t.options.tournament, 'none');
  setOptions(t, 'u1', { tournament: 't-0a1b2c3d4e' }, 3);
  for (const bad of [5, '', 'x'.repeat(40), 'нет-такого']) {
    assert.throws(() => setOptions(t, 'u1', { tournament: bad }, 4), TableError, String(bad));
  }
});

test('строка лобби: какие турниры подходят к людям за столом', () => {
  const season = { id: 'season', players: ['Денис', 'Влад', 'Андрей'] };
  const cup = { id: 't-1', players: ['Денис', 'Петя'] };
  const cup2 = { id: 't-2', players: ['Петя', 'Денис'] };
  const seat = (name, kind = 'human', taken = true) => ({ kind, name, taken });
  const seats = [seat('Денис'), seat(' петя '), seat('Бот', 'bot'), seat('', 'human', false)];
  assert.deepEqual(fitTours([season, cup, cup2], seats).map((t) => t.id), ['t-1', 't-2'], 'бот и пустое место не мешают');
  assert.deepEqual(fitTours([season], seats), []);
  assert.equal(tourChoice([cup, cup2]).id, 't-1', 'по умолчанию первый');
  assert.equal(tourChoice([cup, cup2], 't-2').id, 't-2');
  assert.equal(tourChoice([cup, cup2], 'none'), null, 'не в зачет');
  assert.equal(tourChoice([cup], 't-9').id, 't-1', 'выбранный больше не подходит');
});

test('расчеты страницы работают для двоих и четверых', () => {
  const four = [{ place: [1, 2, 3, 4], pts: [4, 2, 1, 0] }, { place: [4, 3, 2, 1], pts: [0, 1, 2, 4] }];
  const t = totals(four);
  assert.deepEqual(t.pts, [4, 3, 3, 4]);
  assert.deepEqual(t.places[0], [1, 0, 0, 0, 1], 'пятая колонка это четвертое место');
  assert.equal(slot(four[0], 3), 4);
  assert.equal(cumulative(four)[0].length, 4);
  assert.equal(ranking(t).length, 4);
  const two = [{ place: [1, 2], pts: [4, 2] }];
  assert.deepEqual(totals(two).pts, [4, 2]);
  assert.equal(totals(two).places[0].length, 4);
  assert.deepEqual(totals([], 2).pts, [0, 0], 'пустой турнир');
  assert.deepEqual(cumulative([], 2), [[0, 0]]);
});
