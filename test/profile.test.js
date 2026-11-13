// «Мой профиль» (13.11.2026): сводка партий и рейтинг, свое имя. Имя можно сменить, а сезон BGA, герой
// компании, чат и турниры остаются за человеком: он узнается по учетной записи и прежним именам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { profileSummary } from '../server/profile.js';
import { whoIs, namesOf } from '../server/people.js';
import { playerGames, tourOf, SEASON } from '../server/stats.js';
import { BGA_GAMES } from '../server/season-bga.js';
import { createTable, sit, leave, ownPerson } from '../game/table.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const T0 = 1_800_000_000_000;

function setup({ tg = { on: false, say: async () => false } } = {}) {
  const store = memoryStore();
  let clock = T0;
  const app = createApp({ store, env: ENV, now: () => clock++, tg });
  const req = (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query });
  return { req, store };
}

/** Денис (главный) и еще игроки по именам. */
async function people(s, ...names) {
  const denis = (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const out = { denis };
  for (const name of names) {
    const made = (await s.req('POST', 'admin/users', { body: { name }, token: denis.token })).body;
    out[name] = (await s.req('POST', 'activate', { body: { code: made.code } })).body;
  }
  return out;
}
const rename = (s, who, name) => s.req('POST', 'me/name', { body: { name }, token: who.token });

// --- сводка

const G = (at, kind, place, win, seats = 3) => ({
  at, date: '2026-11-01', kind, group: kind, place, win, code: `C${at}`, table: `T${at}`,
  seats: Array.from({ length: seats }, (_, i) => ({ name: i ? `Соперник ${i}` : 'Я', kind: i === 2 ? 'bot' : 'human', place: i + 1, self: i === 0 })),
});

test('сводка профиля: партии, победы, среднее место, где играл, последние партии', () => {
  const day = 24 * 3600 * 1000;
  const games = [G(T0 - 40 * day, 'bga', 1, true), G(T0 - 20 * day, 'bots', 3, false), G(T0 - 3 * day, 'people', 2, false), G(T0 - day, 'people', 1, true), G(T0 - 1000, 'bots', 1, false)];
  const s = profileSummary(games, T0);
  assert.equal(s.games, 5);
  assert.equal(s.wins, 2);
  assert.equal(s.pct, 40);
  assert.equal(s.avgPlace, 1.6);
  assert.equal(s.week, 3);
  assert.deepEqual(s.where, { people: 2, bots: 2, bga: 1 });
  assert.equal(s.since, T0 - 40 * day);
  assert.deepEqual(s.recent.map((g) => g.code), [`C${T0 - 1000}`, `C${T0 - day}`, `C${T0 - 3 * day}`], 'новые сверху, три штуки');
  assert.deepEqual(s.recent[0].seats[2], { name: 'Соперник 2', place: 3, self: false, bot: true });
  assert.equal(s.recent[0].of, 3);
});

test('сводка профиля без партий: нули и пустые поля', () => {
  assert.deepEqual(profileSummary([], T0), { games: 0, wins: 0, pct: null, avgPlace: null, week: 0, where: { people: 0, bots: 0, bga: 0 }, since: null, recent: [] });
});

// --- страница профиля

test('профиль Дениса: партии сезона BGA, рейтинг и место в нем', async () => {
  const s = setup();
  const P = await people(s, 'Влад', 'Андрей', 'Петя');
  const r = await s.req('GET', 'me/profile', { token: P.denis.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.name, 'Денис');
  assert.equal(r.body.games, BGA_GAMES.length);
  assert.equal(r.body.where.bga, BGA_GAMES.length);
  assert.equal(r.body.recent.length, 3);
  assert.equal(r.body.rating.games, BGA_GAMES.length);
  assert.equal(r.body.rating.of, 3, 'в таблице трое: у Пети партий с людьми нет');
  assert.ok(r.body.rating.rank >= 1 && r.body.rating.rank <= 3);
  assert.ok(r.body.rating.value > 1300 && r.body.rating.value < 1700, `рейтинг ${r.body.rating.value}`);
  // сумма трех рейтингов сохраняется: 3 по 1500
  const three = await Promise.all([P.denis, P['Влад'], P['Андрей']].map(async (x) => (await s.req('GET', 'me/profile', { token: x.token })).body.rating.value));
  assert.ok(Math.abs(three.reduce((a, b) => a + b, 0) - 4500) <= 2, `сумма ${three}`);

  const petya = (await s.req('GET', 'me/profile', { token: P['Петя'].token })).body;
  assert.equal(petya.games, 0);
  assert.equal(petya.rating, null);
  assert.equal((await s.req('GET', 'me/profile')).status, 401, 'без входа нельзя');
  // старый маршрут «кто я» не сломан
  assert.equal((await s.req('GET', 'me', { token: P.denis.token })).body.name, 'Денис');
});

// --- свое имя

test('свое имя: границы длины, занятое имя, удачная смена', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  assert.equal((await s.req('POST', 'me/name', { body: { name: 'Вася' } })).status, 401, 'без входа нельзя');
  assert.equal((await rename(s, P['Петя'], 'Я')).status, 400, 'один знак');
  assert.equal((await rename(s, P['Петя'], 'а'.repeat(31))).status, 400, '31 знак');
  assert.equal((await rename(s, P['Петя'], '   ')).status, 400);
  const taken = await rename(s, P['Петя'], ' денис ');
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code ?? taken.body.error, 'name-taken', JSON.stringify(taken.body));

  const ok = await rename(s, P['Петя'], '  Пётр   Первый ');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.name, 'Пётр Первый', 'пробелы приведены в порядок');
  assert.equal((await s.req('GET', 'me', { token: P['Петя'].token })).body.name, 'Пётр Первый');
  assert.deepEqual((await s.store.getUser(ok.body.user.id)).was, ['петя']);
  // то же имя еще раз: не ошибка и не новая запись в прежних именах
  assert.equal((await rename(s, P['Петя'], 'Пётр Первый')).status, 200);
  assert.deepEqual((await s.store.getUser(ok.body.user.id)).was, ['петя']);
});

test('прежнее имя остается за игроком: другой его не возьмет, сам вернуться может', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  assert.equal((await rename(s, P.denis, 'Den')).status, 200);
  assert.equal((await rename(s, P['Петя'], 'Денис')).status, 409, 'прежнее имя Дениса занято');
  assert.equal((await s.req('POST', 'admin/users', { body: { name: 'денис' }, token: P.denis.token })).status, 409, 'и новому игроку его не дать');
  assert.equal((await rename(s, P.denis, 'Денис')).status, 200, 'к своему прежнему имени вернуться можно');
  assert.deepEqual((await s.store.getUser('u-admin')).was, ['den']);
  assert.equal((await rename(s, P['Петя'], 'DEN')).status, 409, 'и второе прежнее имя занято');
});

test('имя нельзя менять чаще пяти раз в сутки', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  for (let i = 1; i <= 5; i++) assert.equal((await rename(s, P['Петя'], `Петя ${i}`)).status, 200, `смена ${i}`);
  assert.equal((await rename(s, P['Петя'], 'Петя 6')).status, 429);
});

test('после смены имени сезон BGA, турнир и рейтинг остаются за игроком', async () => {
  const s = setup();
  const P = await people(s, 'Влад', 'Андрей');
  const before = (await s.req('GET', 'me/profile', { token: P.denis.token })).body;
  assert.equal((await rename(s, P.denis, 'Den')).status, 200);
  const after = (await s.req('GET', 'me/profile', { token: P.denis.token })).body;
  assert.equal(after.user.name, 'Den');
  assert.equal(after.games, before.games, 'партии BGA на месте');
  assert.deepEqual(after.rating, before.rating);

  // личная статистика: партии те же, и сам игрок в них под новым именем
  const personal = (await s.req('GET', 'stats/player', { token: P.denis.token })).body;
  assert.equal(personal.games.length, BGA_GAMES.length);
  assert.deepEqual(personal.games[0].seats.map((x) => x.name), ['Den', 'Влад', 'Андрей']);
  assert.equal(personal.games[0].seats[0].self, true);

  // турнир сезона: игрок по-прежнему участник (Влад не администратор и видит сезон как участник)
  const season = await s.req('GET', 'stats', { token: P.denis.token });
  assert.equal(season.status, 200);
  assert.deepEqual(season.body.players, ['Den', 'Влад', 'Андрей']);
  assert.equal((await rename(s, P['Влад'], 'Vlad')).status, 200);
  const forVlad = await s.req('GET', 'stats', { token: P['Влад'].token });
  assert.equal(forVlad.status, 200, 'участник сезона и под новым именем');
  assert.deepEqual(forVlad.body.players, ['Den', 'Vlad', 'Андрей']);
  const tours = (await s.req('GET', 'tournaments', { token: P['Влад'].token })).body.tours;
  assert.ok(tours.some((t) => t.id === 'season'), JSON.stringify(tours));
});

test('после смены имени герой компании и чат остаются за игроком', async () => {
  const said = [];
  const s = setup({ tg: { on: true, say: async (m) => { said.push(m); return true; } } });
  const P = await people(s, 'Влад');
  assert.equal((await rename(s, P.denis, 'Den')).status, 200);
  const { body: { code } } = await s.req('POST', 'tables', { token: P.denis.token });
  const { doc } = await s.store.getTable(code);
  assert.equal(doc.seats[0].name, 'Den');
  assert.equal(doc.seats[0].person, 'денис');
  assert.equal(doc.seats[0].hero, 'pot', 'кувшин остался за Денисом');
  // чат только для компании: под новым именем по-прежнему можно позвать
  const call = await s.req('POST', 'invite/chat', { body: { code }, token: P.denis.token });
  assert.equal(call.status, 200, JSON.stringify(call.body));
  assert.equal(said.length, 1);
});

// --- справочник людей и места

test('справочник людей: нынешнее и прежние имена ведут к одному человеку', () => {
  const who = whoIs([{ id: 'u1', name: 'Den', was: ['денис', 'дэн'] }, { id: 'u2', name: 'Влад' }]);
  assert.equal(who.idOf('ДЕНИС '), 'u1');
  assert.equal(who.idOf('den'), 'u1');
  assert.equal(who.idOf('Соня'), null);
  assert.equal(who.owner({ userId: 'u2', name: 'что угодно' }), 'u2');
  assert.equal(who.owner({ userId: null, name: 'Дэн' }), 'u1');
  assert.equal(who.label({ kind: 'human', userId: null, name: 'Денис' }), 'Den', 'в статистике нынешнее имя');
  assert.equal(who.label({ kind: 'bot', userId: null, name: 'Бот Денис' }), 'Бот Денис');
  assert.equal(who.label({ kind: 'human', userId: null, name: 'Соня' }), 'Соня');
  assert.deepEqual(namesOf({ name: ' Den ', was: ['денис'] }), ['den', 'денис']);
});

const V = [10, 10, 10, 10];
const seat = (userId, name, place) => ({ kind: 'human', userId, name, place, vector: V });

test('статистика без справочника считает по именам, как раньше', () => {
  const e = { finishedAt: T0, tour: 'auto', seats: [seat('u1', 'Денис', 1), seat('u2', 'Влад', 2), seat('u3', 'Андрей', 3)] };
  assert.equal(tourOf(e, [SEASON])?.id, 'season');
  const renamed = { ...e, seats: [seat('u1', 'Den', 1), e.seats[1], e.seats[2]] };
  assert.equal(tourOf(renamed, [SEASON]), null, 'без справочника новое имя в сезон не попадает');
  const who = whoIs([{ id: 'u1', name: 'Den', was: ['денис'] }, { id: 'u2', name: 'Влад' }, { id: 'u3', name: 'Андрей' }]);
  assert.equal(tourOf(renamed, [SEASON], who)?.id, 'season', 'со справочником попадает');
  const games = playerGames({ id: 'u1', name: 'Den' }, [renamed], [SEASON], who);
  assert.equal(games.length, BGA_GAMES.length + 1);
  assert.equal(games.at(-1).group, `${SEASON.name} (сайт)`);
});

test('ключ компании на месте: герой по нему, а с уходом человека ключ уходит', () => {
  assert.equal(ownPerson(['den', 'денис']), 'денис');
  assert.equal(ownPerson(['петя']), null);
  const t = createTable({ code: 'AAAAAA', host: { userId: 'u9', name: 'Хозяин', avatar: null }, now: T0 });
  sit(t, { userId: 'u1', name: 'Den', avatar: null, person: 'денис' }, 1, T0);
  assert.equal(t.seats[1].hero, 'pot');
  assert.equal(t.seats[1].person, 'денис');
  leave(t, 'u1', T0);
  assert.equal('person' in t.seats[1], false, 'место свободно, ключа нет');
  sit(t, { userId: 'u2', name: 'Петя', avatar: null, person: null }, 1, T0);
  assert.notEqual(t.seats[1].hero, 'pot', 'новому человеку чужой герой не достается');
  assert.equal('person' in t.seats[1], false);
});

// --- разметка страницы

const { numsHTML, whereHTML, recentHTML, sinceText, oneDec, placeText, signed, shortDay } = await import('../public/js/profile-core.js');
const { readFileSync } = await import('node:fs');

const PAGE = {
  games: 88, wins: 32, pct: 36, avgPlace: 1.9, week: 26, where: { people: 12, bots: 16, bga: 60 }, since: Date.UTC(2026, 2, 20, 12), joinedAt: 5,
  rating: { value: 1540, games: 72, last: -7, rank: 2, of: 3 },
  recent: [{ date: '2026-11-13', group: 'С ботами', kind: 'bots', place: 1, of: 4, code: 'ABCDEF', table: '13.11.2026.2',
    seats: [{ name: 'Денис', place: 1, self: true, bot: false }, { name: '<b>Бот</b>', place: 2, self: false, bot: true }] }],
};

test('страница профиля: четыре числа с рейтингом и без него', () => {
  const html = numsHTML(PAGE);
  for (const part of ['<b>1540</b><span>рейтинг</span>', '2-е место из 3', 'последняя партия -7', '<b>88</b><span>партий</span>', 'за неделю 26', '<b>32</b><span>побед</span>', '36% партий', '<b>1,9</b><span>среднее место</span>']) {
    assert.ok(html.includes(part), `нет «${part}» в ${html}`);
  }
  const fresh = numsHTML({ ...PAGE, games: 0, wins: 0, pct: null, avgPlace: null, week: 0, rating: null });
  assert.ok(fresh.includes('<b>нет</b><span>рейтинг</span>'));
  assert.ok(fresh.includes('появится после партии с людьми'));
  assert.ok(!fresh.includes('за неделю'));
  assert.ok(!fresh.includes('% партий'));
  assert.ok(numsHTML({ ...PAGE, rating: { ...PAGE.rating, last: 0 } }).includes('2-е место из 3</small>'), 'без изменения за партию приписки нет');
});

test('страница профиля: где играл, последние партии, с какого дня', () => {
  assert.ok(whereHTML(PAGE).includes('с людьми <b>12</b> | с ботами <b>16</b> | BGA <b>60</b>'));
  assert.ok(whereHTML({ ...PAGE, games: 0 }).includes('Партий пока нет'));
  const rec = recentHTML(PAGE);
  assert.ok(rec.includes('13.11'));
  assert.ok(rec.includes('<b>Денис 1</b>'), 'свое место выделено');
  assert.ok(rec.includes('&lt;b&gt;Бот&lt;/b&gt; 2'), 'имена не вставляются разметкой');
  assert.ok(rec.includes('1-е из 4'));
  assert.ok(rec.includes('href="#/t/ABCDEF"'));
  assert.equal(recentHTML({ ...PAGE, recent: [] }), '');
  assert.ok(!recentHTML({ ...PAGE, recent: [{ ...PAGE.recent[0], code: null }] }).includes('href='), 'у партии BGA ссылки на стол нет');
  assert.match(sinceText(PAGE), /^играет с \d\d\.03\.2026$/);
  assert.match(sinceText({ since: null, joinedAt: Date.UTC(2026, 10, 13, 12) }), /^на сайте с \d\d\.11\.2026$/);
  assert.equal(sinceText({ since: null, joinedAt: null }), '');
  assert.deepEqual([oneDec(2), placeText(3), signed(12), signed(-3), signed(0), shortDay('2026-11-05')], ['2,0', '3-е', '+12', '-3', '0', '05.11']);
});

test('страница профиля: в подписях нет длинного тире, многоточия и неразрывных пробелов', () => {
  for (const file of ['../public/js/profile.js', '../public/js/profile-core.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    // только строки интерфейса: комментарии кода пишутся как во всем проекте
    const ui = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n').replace(/\/\/.*$/gm, '');
    assert.ok(!/[—…   ]/.test(ui), file);
  }
});

test('страница профиля: кнопка фона поверх сайта остается только гостю, выход и фон есть в настройках', () => {
  const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes("bgToggle.hidden = !on || !SCENE.video || Boolean(session.get()?.token)"));
  assert.match(main, /renderProfile\(app, topbar\(''\), bindTopbar, \{ refresh: route, logout, bg: \{ still: \(\) => still, set: setStill, hasVideo: /);
  const page = readFileSync(new URL('../public/js/profile.js', import.meta.url), 'utf8');
  for (const id of ['id="nName"', 'id="bgSeg"', 'id="pOut"', 'id="pNums"', "api('POST', 'me/name'", "api('GET', 'me/profile')"]) assert.ok(page.includes(id), id);
});

// --- правки по итогам ревью 13.11

test('прежние имена не вытесняются: когда список полон, новое имя взять нельзя, а исходное остается за игроком', async () => {
  const s = setup();
  const P = await people(s, 'Петя', 'Вася');
  const id = P['Петя'].user.id;
  const cur = await s.store.getUser(id);
  await s.store.putUser({ ...cur, name: 'Ник 10', was: ['петя', ...Array.from({ length: 9 }, (_, i) => `ник ${i + 1}`)] });
  const full = await rename(s, P['Петя'], 'Ник 11');
  assert.equal(full.status, 409, JSON.stringify(full.body));
  assert.equal(full.body.code ?? full.body.error, 'too-many-names', JSON.stringify(full.body));
  assert.ok((await s.store.getUser(id)).was.includes('петя'), 'исходное имя на месте');
  assert.equal((await rename(s, P['Вася'], 'Петя')).status, 409, 'и другому его не взять');
  assert.equal((await rename(s, P['Петя'], 'Петя')).status, 200, 'к прежнему имени вернуться можно');
  assert.equal((await s.store.getUser(id)).was.length, 10);
});

test('имена компании закреплены: без учетной записи с таким именем его все равно не взять', async () => {
  const s = setup();
  const P = await people(s, 'Петя'); // Влада и Андрея среди игроков нет
  for (const name of ['Влад', 'андрей', ' ВЛАД ']) assert.equal((await rename(s, P['Петя'], name)).status, 409, name);
  const byPlayer = await s.req('POST', 'admin/users', { body: { name: 'Влад' }, token: P['Петя'].token });
  assert.equal(byPlayer.status, 409, 'обычный игрок не заведет игрока с именем компании');
  const byAdmin = await s.req('POST', 'admin/users', { body: { name: 'Влад' }, token: P.denis.token });
  assert.equal(byAdmin.status, 200, 'администратор заводит');
  const profile = (await s.req('GET', 'me/profile', { token: P['Петя'].token })).body;
  assert.equal(profile.games, 0, 'чужих партий BGA у Пети нет');
});

test('имя: знаки разметки, смесь русских и латинских букв, невидимые и пустые знаки, не строка', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  const bad = ['<img src=x onerror=alert(1)>', 'Петя <b>', 'a"b', 'Том & Джерри', 'a`b', 'Дeнис', 'Bлад', 'Петя Iванов'];
  for (const name of bad) assert.equal((await rename(s, P['Петя'], name)).status, 400, name);
  for (const name of [{ a: 1 }, true, 12345, null, ['Петя']]) assert.equal((await rename(s, P['Петя'], name)).status, 400, JSON.stringify(name));
  // двойники занятого имени: невидимый знак, пустой знак, знак ударения, другой регистр
  for (const name of ['Де\u200bнис', 'Денис\u3164', 'Денис\u2800', 'Дени\u0301с', 'ДЕНИС', 'Денис\u034f']) assert.equal((await rename(s, P['Петя'], name)).status, 409, JSON.stringify(name));
  for (const name of ['Petya', 'Петя 2', 'Петя Ivanov', "Д'Артаньян", 'Петя-младший']) assert.equal((await rename(s, P['Петя'], name)).status, 200, name);
  // те же правила для нового игрока
  assert.equal((await s.req('POST', 'admin/users', { body: { name: '<svg onload=alert(1)>' }, token: P.denis.token })).status, 400);
  assert.equal((await s.req('POST', 'admin/users', { body: { name: 'Coня' }, token: P.denis.token })).status, 400, 'латинские C и o в русском слове');
});

test('имя: старая запись с двумя пробелами не освобождает имя после смены', async () => {
  const s = setup();
  const P = await people(s, 'Иван', 'Вася');
  const id = P['Иван'].user.id;
  await s.store.putUser({ ...(await s.store.getUser(id)), name: 'Иван  Петров' }); // так имя могло попасть в базу раньше
  assert.equal((await rename(s, P['Иван'], 'Ваня')).status, 200);
  assert.deepEqual((await s.store.getUser(id)).was, ['иван петров']);
  assert.equal((await rename(s, P['Вася'], 'Иван Петров')).status, 409);
});

test('имя: попытки считаются, лишние адреса не принимаются', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  assert.equal((await s.req('POST', 'me/name/x/y', { body: { name: 'Вася' }, token: P['Петя'].token })).status, 404);
  assert.equal((await s.req('GET', 'me/profile/x', { token: P['Петя'].token })).status, 404);
  for (let i = 0; i < 20; i++) assert.equal((await rename(s, P['Петя'], 'Денис')).status, 409, `попытка ${i + 1}`);
  assert.equal((await rename(s, P['Петя'], 'Денис')).status, 429, 'занятые имена нельзя перебирать без счета');
});

test('администратор видит прежние имена игрока, остальные нет', async () => {
  const s = setup();
  const P = await people(s, 'Петя');
  assert.equal((await rename(s, P['Петя'], 'Пётр')).status, 200);
  const forAdmin = (await s.req('GET', 'admin/users', { token: P.denis.token })).body;
  assert.deepEqual(forAdmin.find((x) => x.name === 'Пётр').was, ['петя']);
  const forPlayer = (await s.req('GET', 'admin/users', { token: P['Петя'].token })).body;
  assert.ok(forPlayer.every((x) => !('was' in x)), JSON.stringify(forPlayer));
  assert.ok(!('was' in (await s.req('GET', 'me', { token: P['Петя'].token })).body), 'в «кто я» прежних имен нет');
});

test('один человек не закрывает собой двух участников турнира', () => {
  const who = whoIs([{ id: 'x', name: 'Икс', was: ['денис', 'влад'] }, { id: 'u3', name: 'Андрей' }, { id: 'u4', name: 'Петя' }]);
  const e = { finishedAt: T0, tour: 'auto', seats: [seat('x', 'Икс', 1), seat('u4', 'Петя', 2), seat('u3', 'Андрей', 3)] };
  assert.equal(tourOf(e, [SEASON], who), null);
});

/** Закончить партию напрямую в хранилище: доигрывать в тесте долго. */
async function finish(store, code) {
  const cur = await store.getTable(code);
  cur.doc.status = 'over';
  cur.doc.game.result = { finishedAt: T0 + 5000, endReason: 'treasures', seats: cur.doc.seats.map((x, i) => ({ seatId: x.id, place: i + 1, vector: [1, 1, 1, 1], score: [1, 1, 1, 1], treasures: 0 })) };
  cur.doc.version += 1;
  assert.equal(await store.putTable(cur.doc, cur.version, ''), true);
}

test('стол после смены имени: признак чата, номера игроков для турнира, нынешнее имя в реванше', async () => {
  const s = setup({ tg: { on: true, say: async () => true, photo: async () => true } });
  const P = await people(s, 'Влад', 'Андрей');
  const act = (who, code, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  const { body: { code } } = await s.req('POST', 'tables', { token: P.denis.token });
  assert.equal((await act(P['Влад'], code, { action: 'sit', seat: 1 })).status, 200);
  assert.equal((await act(P['Андрей'], code, { action: 'sit', seat: 2 })).status, 200);
  // Влад меняет имя, уже сидя за столом: за столом имя прежнее, а стол по-прежнему свой
  assert.equal((await rename(s, P['Влад'], 'Vlad')).status, 200);
  const view = (await s.req('GET', `tables/${code}`, { token: P['Влад'].token })).body;
  assert.equal(view.seats[1].name, 'Влад');
  assert.equal(view.seats[1].uid, P['Влад'].user.id);
  assert.equal(view.chat, true, 'кнопки чата остаются');
  assert.ok(!('person' in view.seats[1]), 'ключ компании в вид стола не попадает');
  // турнир сезона отдает номера участников: по ним лобби сверяет состав
  const tours = (await s.req('GET', 'tournaments', { token: P['Влад'].token })).body.tours;
  const season = tours.find((t) => t.id === 'season');
  assert.deepEqual(season.players, ['Денис', 'Vlad', 'Андрей']);
  assert.deepEqual(season.ids, [P.denis.user.id, P['Влад'].user.id, P['Андрей'].user.id]);
  const { fitTours } = await import('../public/js/season.js');
  assert.deepEqual(fitTours(tours, view.seats).map((t) => t.id), ['season'], 'состав совпал по номерам, хотя имя за столом прежнее');
  assert.deepEqual(fitTours(tours.map(({ ids, ...t }) => t), view.seats), [], 'по одним именам уже не совпал бы');
  // чужой за столом: стол не свой
  const { body: { code: c2 } } = await s.req('POST', 'tables', { token: P.denis.token });
  const made = (await s.req('POST', 'admin/users', { body: { name: 'Гость' }, token: P.denis.token })).body;
  const guest = (await s.req('POST', 'activate', { body: { code: made.code } })).body;
  assert.equal((await act(guest, c2, { action: 'sit', seat: 1 })).status, 200);
  assert.equal((await s.req('GET', `tables/${c2}`, { token: P.denis.token })).body.chat, false);
  assert.equal((await s.req('GET', `tables/${c2}`, { token: guest.token })).body.chat, false);

  // реванш: места копируются, но имя и ключ компании нынешние
  // партию начинают, когда все на месте: каждый открыл стол
  for (const who of [P.denis, P['Влад'], P['Андрей']]) await s.req('GET', `tables/${code}/poll`, { token: who.token, query: { here: '1' } });
  const started = await act(P.denis, code, { action: 'start' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  await finish(s.store, code);
  const again = await act(P.denis, code, { action: 'rematch' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const next = (await s.store.getTable((await s.store.getTable(code)).doc.next)).doc;
  const vlad = next.seats.find((x) => x.userId === P['Влад'].user.id);
  assert.equal(vlad.name, 'Vlad');
  assert.equal(vlad.person, 'влад');
  assert.equal(vlad.hero, 'lion');
});

test('браузер: свой ли стол, решает сервер; участник турнира на картинке итога по номеру игрока', async () => {
  const { chatAllowed } = await import('../public/js/online.js');
  const { canSendPhoto, tourLine } = await import('../public/js/endshot-core.js');
  const seats = [
    { id: 0, kind: 'human', taken: true, name: 'Денис', uid: 'u1' },
    { id: 1, kind: 'human', taken: true, name: 'Vlad', uid: 'u2' },
    { id: 2, kind: 'bot', taken: true, name: 'Бот' },
  ];
  const view = { me: 0, seats, status: 'lobby', chat: true };
  assert.equal(chatAllowed(view, 'Den'), true, 'имена не из компании, но сервер сказал «свой стол»');
  assert.equal(chatAllowed({ ...view, chat: false }, 'Денис'), false);
  assert.equal(chatAllowed({ me: 0, seats: [seats[0], { ...seats[1], name: 'Влад' }] }, 'Денис'), true, 'без поля chat сверка по именам, как раньше');
  assert.equal(chatAllowed({ me: 0, seats: [seats[0]], chat: true }, 'Денис'), false, 'звать некого');

  const result = { seats: [{ seatId: 0, place: 1, vector: [9], score: [9, 9, 9, 9], treasures: 0 }, { seatId: 1, place: 2, vector: [7], score: [7, 7, 7, 7], treasures: 0 }, { seatId: 2, place: 3, vector: [5], score: [5, 5, 5, 5], treasures: 0 }] };
  const over = { ...view, status: 'over', game: { result }, options: { tournament: 'auto' } };
  assert.equal(canSendPhoto(over, 'Den'), true);
  assert.equal(canSendPhoto({ ...over, chat: false }, 'Денис'), false);
  const tours = [{ id: 'duo', name: 'Дуэль', players: ['Денис', 'Влад'], ids: ['u1', 'u2'] }];
  assert.equal(tourLine(tours, over), 'Дуэль: Денис +4, Vlad +2', 'Vlad участник турнира, хотя в турнире он записан как Влад');
});

test('лобби: имена в строке «Ждем за столом» экранируются', () => {
  const src = readFileSync(new URL('../public/js/lobby.js', import.meta.url), 'utf8');
  assert.ok(src.includes('waiting.map((s) => esc(s.name)).join'), 'имя не должно попадать в разметку как есть');
  assert.ok(!src.includes('waiting.map((s) => s.name).join'));
});
