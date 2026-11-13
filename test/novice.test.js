// Путь новичка (Денис 13.11): опрос после регистрации по ссылке, три партии с ботами, ограничения
// до конца пути, зачет шага сыгранной партией, доступ вручную от администратора.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';
import { STEPS, locked, publicPath, surveyPath, stepPath, pathView } from '../server/novice.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const ENV = { SESSION_SECRET: 'test-secret', CODE_PEPPER: 'test-pepper', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const T0 = 1_800_000_000_000;
const STORES = {
  'память': () => memoryStore(),
  'Upstash': () => redisStore({ exec: fakeUpstash().exec, prefix: 'test:' }),
};

async function setup(store = memoryStore()) {
  const clock = { t: T0 };
  const app = createApp({ store, env: ENV, now: () => clock.t++, botOptions: { timeCap: 20 } });
  const req = async (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query, ip: '1.2.3.4' });
  const denis = (await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const mk = async (name) => {
    const r = await req('POST', 'admin/users', { body: { name }, token: denis.token });
    return (await req('POST', 'activate', { body: { code: r.body.code } })).body;
  };
  const andrey = await mk('Андрей');
  /** Новый игрок по ссылке от Андрея; answer: true играл, false новичок, null без ответа. */
  const join = async (name, answer = null) => {
    const link = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    const reg = (await req('POST', 'join', { body: { token: link.token, name } })).body;
    if (answer !== null) assert.equal((await req('POST', 'me/path', { body: { played: answer }, token: reg.token })).status, 200);
    return reg;
  };
  const path = async (who) => (await req('GET', 'me/path', { token: who.token })).body;
  return { store, req, clock, denis, andrey, mk, join, path };
}

/** Закончить партию напрямую в хранилище: доигрывать каждую в тесте долго. */
async function finish(store, code) {
  const cur = await store.getTable(code);
  cur.doc.status = 'over';
  cur.doc.game.result = { finishedAt: T0 + 5000, endReason: 'treasures', seats: cur.doc.seats.map((x, i) => ({ seatId: x.id, place: i + 1, vector: [1, 1, 1, 1], score: [1, 1, 1, 1], treasures: 0 })) };
  cur.doc.version += 1;
  assert.equal(await store.putTable(cur.doc, cur.version, ''), true);
}

/** Сыграть очередной шаг пути: стол от сервера, конец партии в хранилище, зачет при открытии стола. */
async function playStep(s, who) {
  const r = await s.req('POST', 'me/path/play', { token: who.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await finish(s.store, r.body.code);
  const v = await s.req('GET', `tables/${r.body.code}`, { token: who.token });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { code: r.body.code, view: v.body };
}

test('чистые функции пути: закрыт ли, что видно снаружи, зачет шага', () => {
  assert.equal(locked({}), false, 'без поля path игрок опытный');
  assert.equal(locked({ path: { state: 'ask' } }), true);
  assert.equal(locked({ path: { state: 'novice', steps: 2 } }), true);
  assert.equal(locked({ path: { state: 'done', how: 'steps', at: 1 } }), false);
  assert.equal(publicPath({}), null);
  assert.equal(publicPath({ path: { state: 'done' } }), null);
  assert.deepEqual(publicPath({ path: { state: 'ask' } }), { state: 'ask' });
  assert.deepEqual(publicPath({ path: { state: 'novice', steps: 1, learn: 'skip' } }), { state: 'novice', steps: 1 });
  assert.deepEqual(surveyPath(true, 7), { state: 'done', how: 'played', at: 7 });
  assert.deepEqual(surveyPath(false, 7), { state: 'novice', steps: 0 });
  assert.deepEqual(stepPath({ state: 'novice', steps: 0, learn: 'skip' }, 1, 9), { state: 'novice', steps: 1, learn: 'skip' });
  assert.deepEqual(stepPath({ state: 'novice', steps: 2 }, 3, 9), { state: 'done', how: 'steps', at: 9 });
  assert.equal(stepPath({ state: 'novice', steps: 1 }, 1, 9), null, 'тот же шаг второй раз не в счет');
  assert.equal(stepPath({ state: 'novice', steps: 0 }, 2, 9), null, 'через шаг не перепрыгнуть');
  assert.equal(stepPath({ state: 'ask' }, 1, 9), null);
  assert.equal(stepPath(undefined, 1, 9), null);
  assert.deepEqual(pathView({}), { state: null });
  assert.deepEqual(pathView({ path: { state: 'ask' } }), { state: 'ask' });
  assert.deepEqual(pathView({ path: { state: 'novice', steps: 1 } }, 'ABCDEF').list.map((x) => x.status), ['done', 'now', 'locked']);
});

test('уровни шагов совпадают со ступенями лестницы ботов: слабый, средний, уверенный', async () => {
  const { LADDER } = await import('../public/js/bot-ladder.js');
  assert.deepEqual(STEPS.map((s) => s.bots), [1, 2, 3]);
  for (const s of STEPS) {
    const level = LADDER.levels.find((l) => l.id === s.level);
    assert.deepEqual(s.set, level.set, s.level);
    assert.equal(s.title, level.title);
  }
  const rating = STEPS.map((s) => LADDER.levels.find((l) => l.id === s.level).rating);
  assert.ok(rating[0] < rating[1] && rating[1] < rating[2], 'каждый следующий бот сильнее');
});

for (const [kind, make] of Object.entries(STORES)) {
  test(`${kind}: после регистрации по ссылке опрос; у прежних игроков и выданных кодом его нет`, async () => {
    const s = await setup(make());
    const link = (await s.req('POST', 'joinlinks', { body: {}, token: s.andrey.token })).body;
    const reg = (await s.req('POST', 'join', { body: { token: link.token, name: 'Гоша' } })).body;
    assert.deepEqual(reg.user.path, { state: 'ask' });
    assert.deepEqual((await s.req('GET', 'me', { token: reg.token })).body.path, { state: 'ask' });
    assert.deepEqual(await s.path(reg), { state: 'ask' });
    const again = (await s.req('POST', 'activate', { body: { code: reg.code } })).body;
    assert.deepEqual(again.user.path, { state: 'ask' }, 'на другом устройстве опрос тоже покажется');
    for (const old of [s.denis, s.andrey]) {
      assert.ok(!('path' in old.user));
      assert.deepEqual(await s.path(old), { state: null });
    }
    assert.equal((await s.req('GET', 'me/path')).status, 401);
  });

  test(`${kind}: «играл раньше» открывает все сразу`, async () => {
    const s = await setup(make());
    const gosha = await s.join('Гоша');
    const r = await s.req('POST', 'me/path', { body: { played: true }, token: gosha.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(!('path' in r.body.user), 'в записи игрока пути больше нет');
    assert.deepEqual(r.body.path, { state: 'done' });
    assert.equal((await s.req('POST', 'joinlinks', { body: {}, token: gosha.token })).status, 200);
    assert.equal((await s.req('POST', 'admin/users', { body: { name: 'Миша' }, token: gosha.token })).status, 200);
    const tour = await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [gosha.user.id, s.andrey.user.id] }, token: gosha.token });
    assert.equal(tour.status, 200, JSON.stringify(tour.body));
    const twice = await s.req('POST', 'me/path', { body: { played: false }, token: gosha.token });
    assert.equal(twice.status, 409, 'ответ дается один раз');
    assert.equal(twice.body.error, 'answered');
  });

  test(`${kind}: «новичок»: путь из трех шагов, приглашения и турниры закрыты`, async () => {
    const s = await setup(make());
    const gosha = await s.join('Гоша');
    const r = await s.req('POST', 'me/path', { body: { played: false }, token: gosha.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.user.path, { state: 'novice', steps: 0 });
    assert.deepEqual(r.body.path, {
      state: 'novice', steps: 0, learn: null, table: null,
      list: [
        { n: 1, bots: 1, level: 'Учу правила', status: 'now' },
        { n: 2, bots: 2, level: 'Играю иногда', status: 'locked' },
        { n: 3, bots: 3, level: 'Уверенный игрок', status: 'locked' },
      ],
    });
    for (const [path, body] of [['joinlinks', {}], ['admin/users', { name: 'Миша' }], ['tournaments', { name: 'Кубок', players: [gosha.user.id, s.andrey.user.id] }]]) {
      const no = await s.req('POST', path, { body, token: gosha.token });
      assert.equal(no.status, 403, path);
      assert.equal(no.body.error, 'novice', path);
      assert.match(no.body.message, /трех партий/);
    }
    // и другой игрок не может взять новичка в турнир
    const tour = await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [gosha.user.id, s.andrey.user.id] }, token: s.andrey.token });
    assert.equal(tour.status, 400);
    assert.equal(tour.body.error, 'bad-players');
    // читать можно: свои ссылки (пусто), список игроков, турниры
    assert.deepEqual((await s.req('GET', 'joinlinks', { token: gosha.token })).body, []);
    assert.equal((await s.req('GET', 'tournaments', { token: gosha.token })).status, 200);
    // обычный стол с ботами новичок завести может
    assert.equal((await s.req('POST', 'tables', { token: gosha.token })).status, 200);
  });

  test(`${kind}: шаг засчитывается сыгранной партией один раз; после трех шагов все открыто`, async () => {
    const s = await setup(make());
    const gosha = await s.join('Гоша', false);
    const one = await playStep(s, gosha);
    assert.equal(one.view.step, 1);
    assert.deepEqual((await s.path(gosha)).list.map((x) => x.status), ['done', 'now', 'locked']);
    // тот же стол открывают еще раз: шаг не удваивается
    await Promise.all([1, 2, 3].map(() => s.req('GET', `tables/${one.code}`, { token: gosha.token })));
    assert.equal((await s.path(gosha)).steps, 1);
    // законченную партию второго шага первыми открывают три запроса разом: зачет один (ревью 13.11)
    const two = (await s.req('POST', 'me/path/play', { token: gosha.token })).body.code;
    await finish(s.store, two);
    const views = await Promise.all([1, 2, 3].map(() => s.req('GET', `tables/${two}`, { token: gosha.token })));
    assert.ok(views.every((v) => v.status === 200));
    assert.deepEqual((await s.req('GET', 'me', { token: gosha.token })).body.path, { state: 'novice', steps: 2 });
    assert.equal((await s.store.getTable(two)).doc.step.done, true, 'у стола отметка «шаг засчитан»');
    assert.equal((await s.req('POST', 'joinlinks', { body: {}, token: gosha.token })).status, 403, 'после двух шагов еще закрыто');
    await playStep(s, gosha);
    assert.deepEqual(await s.path(gosha), { state: 'done' });
    assert.ok(!('path' in (await s.req('GET', 'me', { token: gosha.token })).body));
    assert.equal((await s.req('POST', 'joinlinks', { body: {}, token: gosha.token })).status, 200, 'приглашения открыты');
    const tour = await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [gosha.user.id, s.andrey.user.id] }, token: gosha.token });
    assert.equal(tour.status, 200, JSON.stringify(tour.body));
    const end = await s.req('POST', 'me/path/play', { token: gosha.token });
    assert.equal(end.status, 409);
    // три партии пути лежат в истории вне турниров
    const mine = (await s.req('GET', 'stats/player', { token: gosha.token })).body.games;
    assert.equal(mine.length, 3);
  });
}

test('пока на опрос не ответили, закрыто то же, что у новичка, и шаг не запустить', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша');
  assert.equal((await s.req('POST', 'joinlinks', { body: {}, token: gosha.token })).body.error, 'novice');
  const play = await s.req('POST', 'me/path/play', { token: gosha.token });
  assert.equal(play.status, 409);
  assert.equal(play.body.error, 'no-path');
  for (const bad of [{}, { played: 'да' }, { played: 1 }, { played: null }]) {
    assert.equal((await s.req('POST', 'me/path', { body: bad, token: gosha.token })).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(await s.path(gosha), { state: 'ask' }, 'кривой ответ ничего не меняет');
  // опытному игроку отвечать не на что
  assert.equal((await s.req('POST', 'me/path', { body: { played: false }, token: s.andrey.token })).status, 409);
  assert.equal((await s.req('POST', 'me/path/play', { token: s.andrey.token })).status, 409);
});

test('партия шага: сервер сам собирает стол и начинает партию, новичок ходит первым', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const r = await s.req('POST', 'me/path/play', { token: gosha.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.n, 1);
  const v = (await s.req('GET', `tables/${r.body.code}`, { token: gosha.token })).body;
  assert.equal(v.status, 'playing');
  assert.equal(v.step, 1);
  assert.equal(v.isHost, true);
  assert.deepEqual(v.seats.map((x) => x.kind), ['human', 'bot']);
  assert.deepEqual(v.seats[1].bot, { style: 'universal', strength: 10, counting: 'none', risk: 50, errors: 25 });
  assert.ok(v.seats.every((x) => x.hero), 'герои розданы');
  assert.equal(new Set(v.seats.map((x) => x.hero)).size, 2);
  assert.equal(v.options.tournament, 'none');
  assert.equal(v.game.order[0], v.me, 'первым ходит новичок');
  assert.equal(v.game.toMove, v.me);
  assert.match(v.title, /\S/);
  // вторая кнопка «Играть» ведет на тот же стол, пока партия идет
  const again = (await s.req('POST', 'me/path/play', { token: gosha.token })).body;
  assert.equal(again.code, r.body.code);
  assert.equal((await s.path(gosha)).table, r.body.code);
  assert.ok((await s.req('GET', 'tables', { token: gosha.token })).body.some((t) => t.code === r.body.code), 'стол в «Моих столах»');
  // чужой смотрит стол: отметки шага ему не видно
  assert.ok(!('step' in (await s.req('GET', `tables/${r.body.code}`, { token: s.andrey.token })).body));
});

test('состав по шагам: один слабый бот, два средних, три уверенных', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const want = [[10, 25, 'none'], [50, 5, 'none'], [80, 2, 'approx']];
  for (let i = 0; i < 3; i++) {
    const { view } = await playStep(s, gosha);
    const bots = view.seats.filter((x) => x.kind === 'bot');
    assert.equal(view.seats.length, i + 2, `шаг ${i + 1}: мест`);
    assert.equal(bots.length, i + 1, `шаг ${i + 1}: ботов`);
    for (const b of bots) assert.deepEqual([b.bot.strength, b.bot.errors, b.bot.counting], want[i], `шаг ${i + 1}`);
    assert.equal(new Set(view.seats.map((x) => x.hero)).size, view.seats.length, 'герои разные');
    assert.equal(view.step, i + 1);
  }
});

test('досрочно завершенная партия шага не считается, следующая кнопка «Играть» дает новый стол', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const first = (await s.req('POST', 'me/path/play', { token: gosha.token })).body.code;
  const closed = await s.req('POST', `tables/${first}`, { body: { action: 'close' }, token: gosha.token });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.status, 'closed');
  const p = await s.path(gosha);
  assert.equal(p.steps, 0);
  assert.equal(p.table, null);
  const second = (await s.req('POST', 'me/path/play', { token: gosha.token })).body;
  assert.notEqual(second.code, first);
  assert.equal(second.n, 1);
});

test('партия не того шага и обычная партия с ботами шагом не считаются', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  // обычный стол с ботом, сыгран до конца
  const { body: { code } } = await s.req('POST', 'tables', { token: gosha.token });
  const post = (body) => s.req('POST', `tables/${code}`, { body, token: gosha.token });
  await post({ action: 'seatCount', n: 2 });
  await post({ action: 'seatKind', seat: 1, kind: 'bot' });
  await post({ action: 'hero', seat: 0, hero: 'lion' });
  assert.equal((await post({ action: 'start' })).status, 200);
  await finish(s.store, code);
  assert.equal((await s.req('GET', `tables/${code}`, { token: gosha.token })).status, 200);
  assert.equal((await s.path(gosha)).steps, 0, 'обычная партия не шаг');
  // старый стол первого шага доигран после того, как первый шаг уже засчитан другой партией
  const old = (await s.req('POST', 'me/path/play', { token: gosha.token })).body.code;
  const cur = await s.store.getTable(old);
  // вторую партию первого шага заводим в обход кнопки: копия стола под другим кодом
  const twin = { ...structuredClone(cur.doc), code: 'TWIN01' };
  assert.equal(await s.store.putTable(twin, null, ''), true);
  await finish(s.store, old);
  await s.req('GET', `tables/${old}`, { token: gosha.token });
  assert.equal((await s.path(gosha)).steps, 1);
  await finish(s.store, 'TWIN01');
  await s.req('GET', 'tables/TWIN01', { token: gosha.token });
  assert.equal((await s.path(gosha)).steps, 1, 'вторая партия того же шага ничего не добавляет');
});

test('настоящая партия первого шага до конца: ходы человека и бота, шаг засчитан', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const { code } = (await s.req('POST', 'me/path/play', { token: gosha.token })).body;
  const r = makeRng(11);
  let over = null;
  for (let k = 0; k < 4000 && !over; k++) {
    const poll = (await s.req('GET', `tables/${code}/poll`, { token: gosha.token })).body;
    if (poll.botDue) {
      assert.equal((await s.req('POST', `tables/${code}/bot-tick`, { token: gosha.token })).status, 200);
      continue;
    }
    const v = (await s.req('GET', `tables/${code}`, { token: gosha.token })).body;
    if (v.status === 'over') { over = v; break; }
    const m = await s.req('POST', `tables/${code}`, { body: { action: 'move', version: v.version, index: Math.floor(r() * v.game.legal.length) }, token: gosha.token });
    assert.equal(m.status, 200, JSON.stringify(m.body));
  }
  assert.ok(over, 'партия закончилась');
  assert.equal(over.step, 1);
  assert.equal((await s.path(gosha)).steps, 1);
});

test('партия с новичком за столом идет вне турниров; в реванше настройка турнира возвращается', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const { body: { code } } = await s.req('POST', 'tables', { token: s.denis.token });
  const post = (who, body, c = code) => s.req('POST', `tables/${c}`, { body, token: who.token });
  assert.equal((await post(s.denis, { action: 'seatCount', n: 2 })).status, 200);
  const empty = (await s.req('GET', `tables/${code}`, { token: s.denis.token })).body;
  assert.ok(!('novice' in empty), 'без новичка отметки нет');
  assert.equal((await post(gosha, { action: 'sit', seat: 1 })).status, 200, 'играть с людьми новичку можно');
  assert.equal((await post(gosha, { action: 'hero', seat: 1, hero: 'bull' })).status, 200);
  const lobby = (await s.req('GET', `tables/${code}`, { token: s.denis.token })).body;
  assert.equal(lobby.novice, true, 'лобби знает, что за столом новичок');
  assert.equal(lobby.options.tournament, 'auto');
  await s.req('GET', `tables/${code}/poll`, { token: gosha.token, query: { here: '1' } });
  const started = await post(s.denis, { action: 'start' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.options.tournament, 'none');
  await finish(s.store, code);
  const again = await post(s.denis, { action: 'rematch' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const next = (await s.req('GET', `tables/${again.body.next}`, { token: s.denis.token })).body;
  assert.equal(next.options.tournament, 'auto', 'в реванше прежняя настройка: новичок мог уже пройти путь');
  const games = (await s.req('GET', 'stats/player', { token: gosha.token })).body.games;
  assert.equal(games.length, 1);
  assert.equal(games[0].group, 'С людьми вне турниров');
  assert.deepEqual((await s.store.listHistory()).map((e) => e.tour), ['none'], 'в истории партия помечена «не в зачет»');
  // стол без новичка турнир не теряет
  const { body: { code: c2 } } = await s.req('POST', 'tables', { token: s.denis.token });
  await post(s.denis, { action: 'seatCount', n: 2 }, c2);
  await post(s.andrey, { action: 'sit', seat: 1 }, c2);
  await s.req('GET', `tables/${c2}/poll`, { token: s.andrey.token, query: { here: '1' } });
  const ok = await post(s.denis, { action: 'start' }, c2);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.options.tournament, 'auto');
});

test('администратор открывает доступ вручную; пригласивший видит, на каком шаге новичок', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const misha = await s.join('Миша');
  await playStep(s, gosha);
  const rows = (await s.req('GET', 'admin/users', { token: s.andrey.token })).body;
  assert.deepEqual(rows.find((x) => x.name === 'Гоша').path, { state: 'novice', steps: 1 });
  assert.deepEqual(rows.find((x) => x.name === 'Миша').path, { state: 'ask' });
  assert.ok(!('path' in rows.find((x) => x.self)));
  // пригласивший без прав администратора открыть доступ не может, сам новичок тем более
  for (const who of [s.andrey, gosha]) {
    const no = await s.req('POST', `admin/users/${gosha.user.id}/path`, { body: { open: true }, token: who.token });
    assert.equal(no.status, 403, who.user.name);
  }
  for (const who of [gosha, misha]) {
    const ok = await s.req('POST', `admin/users/${who.user.id}/path`, { body: { open: true }, token: s.denis.token });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(await s.path(who), { state: 'done' });
    assert.equal((await s.req('POST', 'joinlinks', { body: {}, token: who.token })).status, 200);
  }
  const after = (await s.req('GET', 'admin/users', { token: s.denis.token })).body;
  assert.ok(after.every((x) => !('path' in x)));
  assert.equal((await s.req('POST', `admin/users/${gosha.user.id}/path`, { body: {}, token: s.denis.token })).status, 400);
  assert.equal((await s.req('POST', `admin/users/${s.andrey.user.id}/path`, { body: { open: true }, token: s.denis.token })).status, 200, 'опытному открывать нечего, но и ошибки нет');
  assert.deepEqual(await s.path(s.andrey), { state: null });
});

test('обучение можно пропустить и вернуть: отметка хранится на сервере', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const skip = await s.req('POST', 'me/path', { body: { learn: 'skip' }, token: gosha.token });
  assert.equal(skip.status, 200, JSON.stringify(skip.body));
  assert.equal(skip.body.path.learn, 'skip');
  assert.equal((await s.path(gosha)).learn, 'skip');
  await playStep(s, gosha);
  assert.equal((await s.path(gosha)).learn, 'skip', 'шаг отметку не стирает');
  assert.equal((await s.req('POST', 'me/path', { body: { learn: null }, token: gosha.token })).body.path.learn, null);
  assert.equal((await s.req('POST', 'me/path', { body: { learn: 'да' }, token: gosha.token })).status, 400);
  assert.equal((await s.path(gosha)).steps, 1, 'отметка обучения шаги не трогает');
});

// --- ревью 13.11

test('ревью 13.11: администратора ограничения новичка не касаются; права сняли, путь вернулся', async () => {
  assert.equal(locked({ admin: true, path: { state: 'novice', steps: 0 } }), false);
  assert.equal(publicPath({ admin: true, path: { state: 'ask' } }), null);
  assert.deepEqual(pathView({ admin: true, path: { state: 'novice', steps: 1 } }), { state: 'done' });
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  assert.equal((await s.req('POST', `admin/users/${gosha.user.id}/admin`, { body: { admin: true }, token: s.denis.token })).status, 200);
  const me = (await s.req('GET', 'me', { token: gosha.token })).body;
  assert.equal(me.admin, true);
  assert.ok(!('path' in me), 'ни опроса, ни пути');
  assert.deepEqual(await s.path(gosha), { state: 'done' });
  assert.equal((await s.req('POST', 'joinlinks', { body: {}, token: gosha.token })).status, 200);
  assert.equal((await s.req('POST', `admin/users/${gosha.user.id}/admin`, { body: { admin: false }, token: s.denis.token })).status, 200);
  assert.deepEqual((await s.req('GET', 'me', { token: gosha.token })).body.path, { state: 'novice', steps: 0 });
});

test('ревью 13.11: стол без настройки турнира (заведен до 31.10) с новичком идет вне турниров, реванш тоже', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const { body: { code } } = await s.req('POST', 'tables', { token: s.denis.token });
  const post = (who, body, c = code) => s.req('POST', `tables/${c}`, { body, token: who.token });
  await post(s.denis, { action: 'seatCount', n: 2 });
  await post(gosha, { action: 'sit', seat: 1 });
  await post(gosha, { action: 'hero', seat: 1, hero: 'bull' });
  // старый стол: поля tournament в настройках нет совсем
  const cur = await s.store.getTable(code);
  delete cur.doc.options.tournament;
  cur.doc.version += 1;
  assert.equal(await s.store.putTable(cur.doc, cur.version, ''), true);
  await s.req('GET', `tables/${code}/poll`, { token: gosha.token, query: { here: '1' } });
  const started = await post(s.denis, { action: 'start' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.options.tournament, 'none');
  await finish(s.store, code);
  const again = await post(s.denis, { action: 'rematch' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const next = again.body.next;
  assert.equal((await s.req('GET', `tables/${next}`, { token: s.denis.token })).body.options.tournament, 'auto');
  // реванш с тем же новичком за столом: при старте снова вне турниров
  await s.req('GET', `tables/${next}/poll`, { token: gosha.token, query: { here: '1' } });
  const second = await post(s.denis, { action: 'start' }, next);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.options.tournament, 'none');
  assert.deepEqual((await s.store.listHistory()).map((e) => e.tour), ['none']);
  assert.equal((await s.req('GET', 'me/profile', { token: gosha.token })).body.rating, null, 'в рейтинг партия не попала');
});

test('ревью 13.11: два экземпляра сервера: пульс отдает новичку свежий путь, лобби и старт видят новичка', async () => {
  const A = await setup();
  const appB = createApp({ store: A.store, env: ENV, now: () => A.clock.t++, botOptions: { timeCap: 20 } });
  const B = (method, path, { body, token, query } = {}) => appB.call({ method, path, body, token, query, ip: '5.6.7.8' });
  const beatB = async (who) => (await B('POST', 'beat', { body: {}, token: who.token })).body.me;
  await beatB(A.denis); // экземпляр B запомнил список людей до регистрации новичка
  const gosha = await A.join('Гоша');
  assert.deepEqual((await beatB(gosha)).path, { state: 'ask' });
  assert.equal((await A.req('POST', 'me/path', { body: { played: false }, token: gosha.token })).status, 200);
  assert.deepEqual((await beatB(gosha)).path, { state: 'novice', steps: 0 }, 'ответ на опрос виден на другом экземпляре сразу');
  await playStep(A, gosha);
  assert.deepEqual((await beatB(gosha)).path, { state: 'novice', steps: 1 }, 'и зачет шага тоже');
  // лобби на B знает про новичка, который только что зарегистрировался на A
  const misha = await A.join('Миша', false);
  const { body: { code } } = await A.req('POST', 'tables', { token: A.denis.token });
  await A.req('POST', `tables/${code}`, { body: { action: 'seatCount', n: 2 }, token: A.denis.token });
  await A.req('POST', `tables/${code}`, { body: { action: 'sit', seat: 1 }, token: misha.token });
  await A.req('POST', `tables/${code}`, { body: { action: 'hero', seat: 1, hero: 'bull' }, token: misha.token });
  assert.equal((await B('GET', `tables/${code}`, { token: A.denis.token })).body.novice, true);
  await B('GET', `tables/${code}/poll`, { token: misha.token, query: { here: '1' } });
  const started = await B('POST', `tables/${code}`, { body: { action: 'start' }, token: A.denis.token });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.options.tournament, 'none', 'старт на другом экземпляре тоже уводит партию из турниров');
  // администратор открыл доступ на A: пульс B больше не возвращает путь
  assert.equal((await A.req('POST', `admin/users/${gosha.user.id}/path`, { body: { open: true }, token: A.denis.token })).status, 200);
  assert.ok(!('path' in (await beatB(gosha))), 'открытое не прячется из-за старого списка людей');
});

test('ревью 13.11: законченную партию шага удалили, не открыв: шаг засчитан', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const { code } = (await s.req('POST', 'me/path/play', { token: gosha.token })).body;
  await finish(s.store, code);
  const del = await s.req('POST', `tables/${code}/delete`, { token: gosha.token });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await s.path(gosha)).steps, 1);
  assert.equal((await s.store.listHistory()).length, 1, 'итог партии в истории');
  // а идущую партию шага удаление не засчитывает
  const live = (await s.req('POST', 'me/path/play', { token: gosha.token })).body.code;
  assert.equal((await s.req('POST', `tables/${live}/delete`, { token: gosha.token })).status, 200);
  assert.equal((await s.path(gosha)).steps, 1);
});

test('ревью 13.11: код отозвали, пока шла партия шага: шаг засчитан, с новым кодом путь продолжается', async () => {
  const s = await setup();
  const gosha = await s.join('Гоша', false);
  const { code } = (await s.req('POST', 'me/path/play', { token: gosha.token })).body;
  assert.equal((await s.req('POST', `admin/users/${gosha.user.id}/revoke`, { token: s.denis.token })).status, 200);
  await finish(s.store, code);
  assert.equal((await s.req('GET', `tables/${code}`, { token: s.denis.token })).status, 200); // стол открыл администратор
  assert.deepEqual((await s.store.getUser(gosha.user.id)).path, { state: 'novice', steps: 1 });
  const fresh = await s.req('POST', `admin/users/${gosha.user.id}/code`, { token: s.denis.token });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  const back = (await s.req('POST', 'activate', { body: { code: fresh.body.code } })).body;
  assert.deepEqual(back.user.path, { state: 'novice', steps: 1 });
  assert.equal((await s.req('POST', 'me/path/play', { token: back.token })).body.n, 2);
});
