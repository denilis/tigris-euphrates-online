// Окно кадрирования фото в работе (13.11, ревью): сохранение, отмена, закрытие посреди отправки,
// мышь и пальцы. Окна в node нет: подменяем узлы страницы, как в test/end-close.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function emitter(o = {}) {
  const L = new Map();
  o.addEventListener = (t, f) => { (L.get(t) || L.set(t, []).get(t)).push(f); };
  o.removeEventListener = (t, f) => { const a = L.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); };
  o.fire = (t, e = {}) => {
    const ev = { type: t, prevented: false, preventDefault() { this.prevented = true; }, ...e };
    for (const f of [...(L.get(t) || [])]) f(ev);
    return ev;
  };
  o.count = (t) => (L.get(t) || []).length;
  return o;
}

let failContext = false;
const draws = []; // вызовы drawImage на холстах
function canvas(extra = {}) {
  const c = emitter({ width: 300, height: 150, dataset: {}, disabled: false, ...extra });
  const g = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'drawImage') draws.push(a); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  c.getContext = () => (failContext ? null : g);
  c.toDataURL = (type) => `data:${type};base64,AAAA`;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300 });
  c.setPointerCapture = () => {};
  c.focus = () => {};
  return c;
}

const dialogs = [];
function dialog() {
  const el = {};
  const d = emitter({ open: false, removed: false });
  const get = (sel) => (el[sel] ||= sel === '[data-cropview]' ? canvas() : emitter({ disabled: false, textContent: '', value: '0', dataset: {} }));
  d.querySelector = get;
  d.querySelectorAll = (sel) => (sel === '[data-prev]' ? [120, 52, 26].map((n) => canvas({ dataset: { prev: String(n) } })) : sel === '[data-cropcancel]' ? [get('x'), get('cancel')] : []);
  d.showModal = () => { d.open = true; };
  d.close = () => { if (!d.open) return; d.open = false; queueMicrotask(() => d.fire('close')); };
  d.remove = () => { d.removed = true; };
  d.el = el;
  dialogs.push(d);
  return d;
}

globalThis.window = emitter({ devicePixelRatio: 2 });
globalThis.location = { hash: '#/me' };
// как в браузере: функции кадра, вызванные оторванными от окна, бросают «Illegal invocation».
// Так в тесте ловится ошибка, из-за которой окно перестало перерисовываться и закрываться (13.11)
globalThis.requestAnimationFrame = function (fn) {
  if (this !== globalThis) throw new TypeError('Illegal invocation');
  return setTimeout(fn, 0);
};
globalThis.cancelAnimationFrame = function (id) {
  if (this !== globalThis) throw new TypeError('Illegal invocation');
  clearTimeout(id);
};
globalThis.document = {
  createElement: (t) => (t === 'dialog' ? dialog() : canvas()),
  body: { append() {} },
  querySelector: (sel) => (sel === 'dialog.picker.crop' ? dialogs.find((d) => d.open && !d.removed) || null : null),
};
let hashOnLoad = null; // куда человек ушел, пока фото открывалось
globalThis.Image = class {
  set src(_) {
    this.naturalWidth = 4000;
    this.naturalHeight = 3000;
    queueMicrotask(() => { if (hashOnLoad) globalThis.location.hash = hashOnLoad; this.onload(); });
  }
};
URL.createObjectURL = () => 'blob:x';
URL.revokeObjectURL = () => {};

const { openCrop } = await import('../public/js/avatar-crop.js');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const settled = async (p) => Promise.race([p.then((v) => ({ v })), tick(40).then(() => 'ждет')]);
/** Последняя отрисовка фото в окне: [сдвиг x, сдвиг y, ширина]. */
const view = () => {
  const a = [...draws].reverse().find((x) => x.length === 5 && x[3] > 0);
  return a ? [a[1], a[2], a[3]].map((n) => Math.round(n * 100) / 100) : null;
};
const start = async (save) => {
  draws.length = 0;
  globalThis.location.hash = '#/me';
  const p = openCrop({}, { title: 'Фото профиля', save });
  await tick();
  const d = dialogs.at(-1);
  return { p, d, stage: d.el['[data-cropview]'], ok: d.el['[data-cropok]'], cancel: d.el.cancel };
};

test('«Сохранить фото»: картинка уходит в save, окно закрывается, ответ true, слушателей не остается', async () => {
  const sent = [];
  const { p, d, ok } = await start(async (image) => { sent.push(image); });
  assert.equal(d.open, true);
  ok.fire('click');
  assert.equal(await p, true);
  assert.deepEqual(sent, ['data:image/webp;base64,AAAA']);
  assert.equal(d.removed, true);
  assert.equal(window.count('resize'), 0);
});

test('«Отмена»: ничего не отправлено, ответ false', async () => {
  let calls = 0;
  const { p, d, cancel } = await start(async () => { calls++; });
  cancel.fire('click');
  assert.equal(await p, false);
  assert.equal(calls, 0);
  assert.equal(d.removed, true);
  assert.equal(window.count('resize'), 0);
});

test('сбой отправки: текст ошибки в окне, окно открыто, можно повторить', async () => {
  let n = 0;
  const { p, d, ok } = await start(async () => { if (++n === 1) throw new Error('Слишком часто, подождите несколько минут'); });
  ok.fire('click');
  await tick();
  assert.equal(d.el['[data-croperr]'].textContent, 'Слишком часто, подождите несколько минут');
  assert.equal(d.open, true);
  assert.equal(ok.disabled, false);
  assert.equal(await settled(p), 'ждет', 'окно не закрыто: ответа еще нет');
  ok.fire('click');
  assert.equal(await p, true);
  assert.equal(n, 2);
});

test('пока фото отправляется, окно не закрыть: «Отмена» и Esc не действуют, двойное нажатие шлет один раз', async () => {
  let finish, calls = 0;
  const { p, d, ok, cancel } = await start(() => new Promise((r) => { calls++; finish = r; }));
  ok.fire('click');
  ok.fire('click');
  await tick();
  assert.equal(calls, 1);
  assert.equal(ok.disabled, true);
  assert.equal(cancel.disabled, true);
  assert.equal(d.el.x.disabled, true);
  cancel.fire('click');
  d.el.x.fire('click');
  assert.equal(d.fire('cancel').prevented, true, 'Esc посреди отправки окно не закрывает');
  assert.equal(d.open, true);
  assert.equal(await settled(p), 'ждет');
  finish();
  assert.equal(await p, true);
  assert.equal(d.removed, true);
});

test('ушли со страницы посреди отправки: окно закрылось, но ответ ждет исхода и говорит правду', async () => {
  let finish;
  const { p, d, ok } = await start(() => new Promise((r) => { finish = r; }));
  ok.fire('click');
  await tick();
  d.close(); // так окно закрывает переход на другую страницу (closePicker)
  assert.equal(await settled(p), 'ждет', 'фото еще отправляется: «не сохранено» говорить рано');
  finish();
  assert.equal(await p, true, 'фото сохранилось, и тот, кто звал, об этом знает');
  // и наоборот: отправка не удалась
  let fail;
  const b = await start(() => new Promise((_, no) => { fail = no; }));
  b.ok.fire('click');
  await tick();
  b.d.close();
  fail(new Error('нет связи'));
  assert.equal(await b.p, false);
});

test('мышь: правая кнопка фото не двигает, движение без нажатой кнопки тоже', async () => {
  const { p, d, stage } = await start(async () => {});
  d.el['[data-cropin]'].fire('click'); // ближе, чтобы было куда двигать
  await tick();
  const before = view();
  stage.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, buttons: 2, isPrimary: true, clientX: 150, clientY: 150 });
  stage.fire('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 2, clientX: 100, clientY: 150 });
  await tick();
  assert.deepEqual(view(), before, 'правая кнопка');
  // левая нажата, отпустили за окном (pointerup потерян), потом мышь вернулась без кнопки
  stage.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, clientX: 150, clientY: 150 });
  stage.fire('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 140, clientY: 150 });
  await tick();
  const dragged = view();
  assert.notDeepEqual(dragged, before, 'с нажатой левой кнопкой фото едет');
  stage.fire('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 60, clientY: 150 });
  stage.fire('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 20, clientY: 150 });
  await tick();
  assert.deepEqual(view(), dragged, 'без кнопки не едет');
  d.close();
  await p;
});

test('пальцы: потерянное отпускание не превращает следующий сдвиг в масштаб; два пальца масштабируют', async () => {
  const { p, d, stage } = await start(async () => {});
  stage.fire('pointerdown', { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 50 }); // отпускание потеряно
  await tick();
  const w0 = view()[2];
  stage.fire('pointerdown', { pointerId: 12, pointerType: 'touch', isPrimary: true, clientX: 150, clientY: 150 });
  stage.fire('pointermove', { pointerId: 12, pointerType: 'touch', clientX: 250, clientY: 250 });
  await tick();
  assert.equal(view()[2], w0, 'один палец: ширина фото на экране прежняя, это сдвиг');
  stage.fire('pointerup', { pointerId: 12 });
  // настоящий щипок: два пальца расходятся, фото становится крупнее
  stage.fire('pointerdown', { pointerId: 13, pointerType: 'touch', isPrimary: true, clientX: 120, clientY: 150 });
  stage.fire('pointerdown', { pointerId: 14, pointerType: 'touch', isPrimary: false, clientX: 180, clientY: 150 });
  stage.fire('pointermove', { pointerId: 14, pointerType: 'touch', clientX: 240, clientY: 150 });
  await tick();
  assert.ok(view()[2] > w0 * 1.5, `щипок увеличил: ${view()[2]} против ${w0}`);
  d.close();
  await p;
});

test('пока фото открывалось, ушли на другую страницу: окно не появляется', async () => {
  const before = dialogs.length;
  globalThis.location.hash = '#/me';
  hashOnLoad = '#/t/ABCDEF';
  const r = await openCrop({}, { save: async () => {} });
  hashOnLoad = null;
  assert.equal(r, false);
  assert.equal(dialogs.length, before, 'окно даже не создавалось');
});

test('второе окно поверх открытого не появляется', async () => {
  const { p, d } = await start(async () => {});
  const before = dialogs.length;
  assert.equal(await openCrop({}, { save: async () => {} }), false);
  assert.equal(dialogs.length, before);
  d.close();
  await p;
});

test('браузер не дал холст: понятная ошибка, пустого окна на странице не остается', async () => {
  failContext = true;
  globalThis.location.hash = '#/me';
  await assert.rejects(openCrop({}, { save: async () => {} }), /не хватило памяти/);
  failContext = false;
  assert.equal(dialogs.filter((d) => d.open && !d.removed).length, 0);
  assert.equal(window.count('resize'), 0);
});
