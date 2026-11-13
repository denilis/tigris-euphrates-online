// Путь новичка в браузере (13.11, ревью): опрос и блок на главной вместе с сессией. Окна в node нет:
// подменяем хранилище, запросы и узлы страницы, как в test/end-close.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.location = { search: '', hostname: 'site.test', hash: '#/' };
globalThis.window = { dispatchEvent() {} };
globalThis.scrollTo = () => {};

// сценарий ответов сервера: по одному на запрос, 'network' значит «связи нет»
let script = [];
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
  const r = script.shift();
  if (!r) throw new Error(`лишний запрос ${opts.method} ${url}`);
  if (r === 'network') throw new Error('network');
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

const { session } = await import('../public/js/api.js');
const { renderSurvey, mountPath } = await import('../public/js/path.js');

/** Узел страницы: помнит разметку и отдает кнопки по тем селекторам, которыми пользуется path.js. */
const MARK = { '#svErr': 'id="svErr"', '[data-npplay]': 'data-npplay', '[data-npskip]': 'data-npskip', '[data-npretry]': 'data-npretry', '.npsub': 'class="npsub"' };
function fakeEl() {
  let html = '';
  let stubs = new Map();
  const stub = (key, dataset = {}) => {
    if (!stubs.has(key)) {
      stubs.set(key, { dataset, disabled: false, textContent: '', on: null, addEventListener(type, fn) { this.on = fn; }, click() { return this.on({ currentTarget: this }); } });
    }
    return stubs.get(key);
  };
  return {
    isConnected: true,
    removed: false,
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; stubs = new Map(); },
    remove() { this.removed = true; this.isConnected = false; },
    querySelector(sel) { return html.includes(MARK[sel]) ? stub(sel) : null; },
    querySelectorAll(sel) { return sel === '[data-played]' && html.includes('data-played') ? [stub('yes', { played: '1' }), stub('no', { played: '0' })] : []; },
  };
}

const USER = { id: 'u-1', name: 'Гоша', admin: false, main: false, avatar: null };
const NOVICE = (steps, extra = {}) => ({
  state: 'novice', steps, learn: null, table: null,
  list: [['Учу правила', 1], ['Играю иногда', 2], ['Уверенный игрок', 3]].map(([level, bots], i) => ({ n: i + 1, bots, level, status: i < steps ? 'done' : i === steps ? 'now' : 'locked' })),
  ...extra,
});
function start(path, extra = {}) {
  mem.clear();
  calls.length = 0;
  script = [];
  session.set({ token: 'tok', user: { ...USER, ...(path ? { path } : {}) }, ...extra });
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('опрос: «Нет, я новичок» отправляет ответ, запоминает его в сессии и зовет дальше как новичка', async () => {
  start({ state: 'ask' });
  const app = fakeEl();
  const done = [];
  renderSurvey(app, { done: (novice) => done.push(novice) });
  assert.match(app.innerHTML, /Гоша, вы уже играли/);
  script = [{ status: 200, body: { user: { ...USER, path: { state: 'novice', steps: 0 } }, path: NOVICE(0) } }];
  await app.querySelectorAll('[data-played]')[1].click();
  assert.deepEqual(calls, [{ url: '/api/me/path', method: 'POST', body: { played: false } }]);
  assert.deepEqual(done, [true]);
  const s = session.get();
  assert.equal(s.pathAnswered, true);
  assert.deepEqual(s.user.path, { state: 'novice', steps: 0 });
  assert.equal(s.token, 'tok', 'вход на месте');
});

test('опрос: «Да, правила знаю» убирает путь из сессии и зовет дальше как опытного', async () => {
  start({ state: 'ask' });
  const app = fakeEl();
  const done = [];
  renderSurvey(app, { done: (novice) => done.push(novice) });
  script = [{ status: 200, body: { user: USER, path: { state: 'done' } } }];
  await app.querySelectorAll('[data-played]')[0].click();
  assert.deepEqual(calls[0].body, { played: true });
  assert.deepEqual(done, [false]);
  assert.ok(!('path' in session.get().user));
});

test('опрос: на другом устройстве уже ответили: вопрос уходит, состояние берется с сервера', async () => {
  start({ state: 'ask' });
  const app = fakeEl();
  const done = [];
  renderSurvey(app, { done: (novice) => done.push(novice) });
  script = [{ status: 409, body: { error: 'answered', message: 'На этот вопрос вы уже ответили' } }, { status: 200, body: { ...USER, path: { state: 'novice', steps: 1 } } }];
  await app.querySelectorAll('[data-played]')[0].click();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/me/path', 'GET /api/me']);
  assert.deepEqual(done, [true], 'там назвались новичком: ведем к пути');
  assert.deepEqual(session.get().user.path, { state: 'novice', steps: 1 });
  assert.equal(session.get().pathAnswered, true);
});

test('опрос: нет связи: сообщение на экране, кнопки снова работают, дальше не пускаем', async () => {
  start({ state: 'ask' });
  const app = fakeEl();
  const done = [];
  renderSurvey(app, { done: (novice) => done.push(novice) });
  script = ['network'];
  const [yes, no] = app.querySelectorAll('[data-played]');
  await no.click();
  assert.deepEqual(done, []);
  assert.equal(app.querySelector('#svErr').textContent, 'Нет связи с сервером');
  assert.equal(yes.disabled, false);
  assert.equal(no.disabled, false);
  assert.ok(!session.get().pathAnswered);
  assert.deepEqual(session.get().user.path, { state: 'ask' });
});

test('блок пути: рисует шаги, «Играть» заводит партию шага и ведет на стол', async () => {
  start({ state: 'novice', steps: 0 });
  const box = fakeEl();
  const went = [];
  script = [{ status: 200, body: NOVICE(1) }];
  await mountPath(box, { go: (h) => went.push(h), opened: () => went.push('opened') });
  assert.match(box.innerHTML, /Партия с двумя ботами/);
  assert.deepEqual(session.get().user.path, { state: 'novice', steps: 1 }, 'сессия знает шаг с сервера');
  script = [{ status: 200, body: { code: 'ABCDEF', n: 2 } }];
  const play = box.querySelector('[data-npplay]');
  await play.click();
  assert.deepEqual(calls.at(-1), { url: '/api/me/path/play', method: 'POST', body: null });
  assert.deepEqual(went, ['#/t/ABCDEF']);
  assert.equal(play.disabled, true, 'второе нажатие вторую партию не заведет');
});

test('блок пути: «Пропустить» запоминает пропуск обучения на сервере и перерисовывает строку', async () => {
  start({ state: 'novice', steps: 0 });
  const box = fakeEl();
  script = [{ status: 200, body: NOVICE(0) }];
  await mountPath(box, { go() {}, opened() {} });
  assert.match(box.innerHTML, /data-npskip/);
  script = [{ status: 200, body: { user: { ...USER, path: { state: 'novice', steps: 0 } }, path: NOVICE(0, { learn: 'skip' }) } }];
  await box.querySelector('[data-npskip]').click();
  assert.deepEqual(calls.at(-1).body, { learn: 'skip' });
  assert.match(box.innerHTML, /пропущено/);
  assert.doesNotMatch(box.innerHTML, /data-npskip/);
});

test('блок пути: путь пройден: блок уходит, отметка стирается, поздравление один раз', async () => {
  start({ state: 'novice', steps: 2 });
  const opened = [];
  const box = fakeEl();
  script = [{ status: 200, body: { state: 'done' } }];
  await mountPath(box, { go() {}, opened: () => opened.push(1) });
  assert.equal(box.removed, true);
  assert.ok(!('path' in session.get().user));
  assert.equal(opened.length, 1);
  // старый ответ сервера вернул отметку в сессию: блок снова уйдет, но поздравления второй раз нет
  const s = session.get();
  session.set({ ...s, user: { ...s.user, path: { state: 'novice', steps: 2 } } });
  const again = fakeEl();
  script = [{ status: 200, body: { state: 'done' } }];
  await mountPath(again, { go() {}, opened: () => opened.push(2) });
  assert.equal(again.removed, true);
  assert.equal(opened.length, 1);
});

test('блок пути: ответившему «играл» на другом устройстве поздравление не показываем', async () => {
  start({ state: 'ask' }, { pathAnswered: true });
  const opened = [];
  const box = fakeEl();
  script = [{ status: 200, body: { state: 'done' } }];
  await mountPath(box, { go() {}, opened: () => opened.push(1) });
  assert.equal(box.removed, true);
  assert.ok(!('path' in session.get().user));
  assert.deepEqual(opened, []);
});

test('блок пути: нет связи: вместо пустого места строка «Повторить», и она работает', async () => {
  start({ state: 'novice', steps: 0 });
  const box = fakeEl();
  script = ['network'];
  await mountPath(box, { go() {}, opened() {} });
  assert.equal(box.removed, false, 'блок не исчез: иначе новичок остался бы без кнопки «Играть»');
  assert.match(box.innerHTML, /Не удалось загрузить путь/);
  script = [{ status: 200, body: NOVICE(0) }];
  box.querySelector('[data-npretry]').click();
  await tick();
  await tick();
  assert.match(box.innerHTML, /data-npplay>Играть/);
});
