// Снимки экрана для справки «Наш сайт» в правилах (Денис 15.11: «показать, где это»). Столы кладутся
// в локальный сервер, экран рисует настоящий клиент, рамки и номера добавляются только в снимок.
// Игроки на снимках «Игрок 1, 2, 3»: настоящих имен и фото нет.
//   node dev/server.js 3018            (в другом окне)
//   node tools/help-shots.mjs [порт] [имя снимка ...]
// Снимки пишутся в public/img/help/<имя>.webp. Переснимать после правок шапки, панели, итога и лобби.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.js';
import { createTable, sit, setHero, setSeatCount, start, submitSeat } from '../game/table.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEV_ADMIN_CODE = 'DEVA-DMNN-2345'; // локальный код из dev/server.js
const [port = '3018', ...only] = process.argv.slice(2);
const base = `http://localhost:${port}`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'help');
const VW = 1440, VH = 900, DPR = 2, DBG = 9445, MAXW = 1800; // снимок не шире 1800 точек
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (Date.now() % 46656).toString(36).toUpperCase().padStart(3, '0');
let codeNo = 0;
const nextCode = () => `H${run}${String(++codeNo).padStart(2, '0')}`;

// --- столы

const NAMES = ['Игрок 1', 'Игрок 2', 'Игрок 3'];

/** Стол на троих людей; start: сразу начать партию. */
function table(meId, { started = true } = {}) {
  const now = Date.now();
  const users = [{ userId: meId, name: NAMES[0] }, { userId: 'help-2', name: NAMES[1] }, { userId: 'help-3', name: NAMES[2] }];
  const t = createTable({ code: nextCode(), host: users[0], now });
  setSeatCount(t, meId, 3, now);
  sit(t, users[1], 1, now);
  if (!started) return t; // лобби: третье место свободно
  sit(t, users[2], 2, now);
  ['lion', 'bull', 'bow'].forEach((h, i) => setHero(t, users[i].userId, i, h, now));
  Object.assign(t.options, { order: 'custom', confirmSeconds: 0 });
  start(t, meId, { rng: makeRng(7), now });
  return t;
}

/** Ходы движком: тайлы кучнее, монумент строится всегда (как tools/dev-replay.js). */
function playUntil(t, done, seed = 3) {
  const r = makeRng(seed), draw = makeRng(seed + 2);
  for (let k = 0; k < 8000 && t.status === 'playing' && !done(stateFromJSON(t.game.state)); k++) {
    const s = stateFromJSON(t.game.state);
    const legal = legalMoves(s);
    const mon = legal.filter((m) => m.type === 'monument');
    const same = legal.filter((m) => m.type === 'tile' && [m.pos - 1, m.pos + 1, m.pos - 16, m.pos + 16].some((j) => j >= 0 && j < 176 && s.tile[j] === m.color));
    const pool = mon.length ? mon : same.length && r() < 0.8 ? same : legal.filter((m) => !['discard', 'pass', 'catastrophe', 'withdraw'].includes(m.type));
    const m = (pool.length ? pool : legal)[Math.floor(r() * (pool.length || legal.length))];
    submitSeat(t, t.game.order[s.toMove], m, { rng: draw, now: Date.now() });
  }
  return t;
}

async function post(t) {
  const now = Date.now();
  t.createdAt = t.updatedAt = now;
  if (t.game?.clock) t.game.clock.at = now;
  const r = await fetch(`${base}/__dev/table`, { method: 'POST', body: JSON.stringify(t) });
  if (!r.ok) throw new Error(`стол не лег: ${r.status} ${await r.text()}`);
  return t.code;
}

// --- браузер

async function openBrowser() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'tigris-help-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, `--window-size=${VW},${VH}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  let br = null;
  for (let k = 0; k < 40 && !br; k++) {
    await sleep(250);
    try { br = await connect(DBG); } catch { /* еще не поднялся */ }
  }
  if (!br) throw new Error('Chrome не ответил');
  const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => br.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false });
  const stop = async () => {
    try { await br.send('Browser.close'); } catch { /* уже закрыт */ }
    proc.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  return { send, stop };
}

async function evalIn(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(send, cond, what) {
  for (let k = 0; k < 100; k++) {
    if (await evalIn(send, `Boolean(${cond})`)) return;
    await sleep(100);
  }
  throw new Error('не дождался: ' + what);
}

// Рамки с номерами поверх экрана и область снимка: объединение рамок и элементов clip с отступом,
// не меньше minW x minH, не выше maxH (обрезка снизу), в пределах окна. Рамка span (высокая полоска
// ширины панели) в область не входит и рисуется только по ее высоте. Клиент об этом не знает.
const MARK = `(o) => {
  document.getElementById('hlp')?.remove();
  const root = document.createElement('div');
  root.id = 'hlp';
  root.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none';
  // первый видимый: спрятанная на узком экране копия кнопки не годится
  const rectOf = (sel) => {
    const r = [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect()).find((x) => x.width > 0 && x.height > 0);
    if (!r) throw new Error('нет видимого элемента ' + sel);
    return r;
  };
  const area = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  const grow = (l, t, r, b) => { area.l = Math.min(area.l, l); area.t = Math.min(area.t, t); area.r = Math.max(area.r, r); area.b = Math.max(area.b, b); };
  for (const g of o.boxes) if (!g.span) { const r = rectOf(g.sel), p = g.pad ?? 4; grow(r.left - p - 13, r.top - p - 13, r.right + p + 13, r.bottom + p + 13); }
  for (const sel of o.clip || []) { const r = rectOf(sel); grow(r.left, r.top, r.right, r.bottom); }
  if (o.maxH && area.b - area.t > o.maxH) area.b = area.t + o.maxH;
  o.boxes.forEach((g, k) => {
    const full = rectOf(g.sel), p = g.pad ?? 4;
    const r = g.span ? { left: full.left, right: full.right, width: full.width, top: Math.max(full.top, area.t + 20), bottom: Math.min(full.bottom, area.b - 20) } : full;
    r.height = r.bottom - r.top;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;box-sizing:border-box;left:' + (r.left - p) + 'px;top:' + (r.top - p) + 'px;width:' + (r.width + 2 * p) + 'px;height:' + (r.height + 2 * p) + 'px;'
      + 'border:3px solid #ffce54;border-radius:8px;box-shadow:0 0 14px rgba(255,206,84,.65)';
    const at = g.badge || 'tl';
    const x = at.includes('r') ? r.right + p - 13 : r.left - p - 13, y = at.includes('b') ? r.bottom + p - 13 : r.top - p - 13;
    const n = document.createElement('div');
    n.textContent = String(k + 1);
    n.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:26px;height:26px;border-radius:50%;background:#ffce54;color:#1c140c;'
      + 'font:700 15px/26px system-ui,Segoe UI,sans-serif;text-align:center;box-shadow:0 1px 5px rgba(0,0,0,.7)';
    root.append(box, n);
  });
  document.body.append(root);
  const pad = o.pad ?? 24, W = innerWidth, H = innerHeight;
  let l = area.l - pad, t = area.t - pad, r = area.r + pad, b = area.b + (o.maxH ? 0 : pad);
  if (r - l < (o.minW || 0)) { const c = (l + r) / 2; l = c - o.minW / 2; r = c + o.minW / 2; }
  if (b - t < (o.minH || 0)) { const c = (t + b) / 2; t = c - o.minH / 2; b = c + o.minH / 2; }
  if (l < 0) { r -= l; l = 0; } if (r > W) { l -= r - W; r = W; }
  if (t < 0) { b -= t; t = 0; } if (b > H) { t -= b - H; b = H; }
  l = Math.max(0, l); t = Math.max(0, t);
  return { x: Math.round(l), y: Math.round(t), width: Math.round(Math.min(W, r) - l), height: Math.round(Math.min(H, b) - t) };
}`;

async function snap(send, name, o) {
  await evalIn(send, 'document.fonts.ready.then(() => true)');
  await sleep(300);
  const clip = await evalIn(send, `(${MARK})(${JSON.stringify(o)})`);
  const scale = Math.min(1, MAXW / (clip.width * DPR));
  const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 82, clip: { ...clip, scale } });
  const file = path.join(OUT, `${name}.webp`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  await evalIn(send, `document.getElementById('hlp')?.remove()`);
  console.log(`${name}: ${Math.round(clip.width * DPR * scale)}x${Math.round(clip.height * DPR * scale)}, ${Math.round(Buffer.byteLength(data, 'base64') / 1024)} КБ`);
}

async function openTable(send, code, ready) {
  await evalIn(send, `location.hash = '#/t/${code}'`);
  await waitFor(send, ready, 'стол ' + code);
  await sleep(600);
}

/** Партия на 2-м круге, ваш ход. Слой «Ходы» выключен: его рамки с номерами спутались бы с нашими. */
async function midGame(send, meId) {
  const code = await post(playUntil(table(meId), (s) => s.turn >= 4));
  await openTable(send, code, `document.querySelector('#gTurnBox')?.textContent.includes('круг 2') && document.querySelector('.cell-hit')`);
  await evalIn(send, `(() => { const b = document.querySelector('#gLayers [data-layer="moves"]'); if (b?.getAttribute('aria-checked') === 'true') b.click(); })()`);
  await sleep(300);
}

async function openMenu(send, btn, ready) {
  await evalIn(send, `document.querySelector('${btn}').click()`);
  await waitFor(send, ready, 'меню ' + btn);
  await sleep(200);
}

// --- снимки (порядок номеров = порядок рамок; подписи в public/js/rules-text.js, раздел «Наш сайт»)

const SHOTS = {
  // лобби: кнопка приглашения нового игрока
  async lobby(send, meId) {
    const code = await post(table(meId, { started: false }));
    await openTable(send, code, `document.querySelector('#lJoin')`);
    // в снимке адрес настоящего сайта, а не локальной копии
    await evalIn(send, `(() => {
      const site = 'https://tigris-euphrates-online.vercel.app';
      document.querySelectorAll('.lobby input').forEach((i) => { i.value = i.value.split(location.origin).join(site); });
      const w = document.createTreeWalker(document.querySelector('.lobby'), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(location.origin)) n.nodeValue = n.nodeValue.split(location.origin).join(site);
    })()`);
    await snap(send, 'lobby', { boxes: [{ sel: '#lJoin' }], clip: ['.lobby'], maxH: 520, pad: 0 });
  },
  // шапка и панель: круг, слой «Тайлы» в меню «Вид», блок «Запас»
  async header(send, meId) {
    await midGame(send, meId);
    await openMenu(send, '#gViewBtn', `document.querySelector('#gTopMenu:not([hidden]) [data-tm="layer:owners"]')`);
    await snap(send, 'header', {
      boxes: [{ sel: '#gTurnBox', badge: 'bl' }, { sel: '#gTopMenu .sfxrow:has([data-tm="layer:owners"])', badge: 'tr' }, { sel: '#gSide [data-block="stock"]', pad: 2 }],
      pad: 16,
    });
  },
  // меню «Партия»: пауза и конец партии
  async party(send, meId) {
    await midGame(send, meId);
    await openMenu(send, '#gGameBtn', `document.querySelector('#gTopMenu:not([hidden]) [data-tm="stop"]')`);
    await snap(send, 'party', {
      boxes: [{ sel: '#gGameBtn', badge: 'bl' }, { sel: '#gTopMenu [data-tm="pause"]', badge: 'tr' }, { sel: '#gTopMenu [data-tm="stop"]', badge: 'tr' }],
      clip: ['#gTopMenu'], minW: 820, minH: 380,
    });
  },
  // настройка панели: ширина, блоки, сторона, сброс (низ панели, где кнопки)
  async panel(send, meId) {
    await midGame(send, meId);
    await evalIn(send, `document.querySelector('#gSide').scrollTop = 1e6`);
    await sleep(200);
    await snap(send, 'panel', {
      boxes: [{ sel: '#gSizer', pad: 3, span: true }, { sel: '#gSide [data-block="log"] .blockhead', pad: 3, badge: 'tr' }, { sel: '#gSideMove' }, { sel: '#gLayoutReset', badge: 'tr' }],
      minW: 760, pad: 16,
    });
  },
  // итог партии со статистикой (верх окна: места и начало статистики)
  async end(send, meId) {
    const t = playUntil(table(meId), () => false, 5);
    if (t.status === 'playing') throw new Error('партия не доиграна');
    const code = await post(t);
    await openTable(send, code, `document.querySelector('.endcard .stattbl')`);
    await snap(send, 'end', {
      boxes: [{ sel: '.endcard .endtbl', pad: 6 }, { sel: '.endcard .statwrap', pad: 6 }],
      clip: ['.endcard'], maxH: 600, pad: 10,
    });
  },
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const a = await (await fetch(`${base}/api/activate`, { method: 'POST', body: JSON.stringify({ code: DEV_ADMIN_CODE }) })).json();
  if (!a.user) throw new Error('локальный вход не прошел: ' + JSON.stringify(a.error));
  a.user.name = NAMES[0]; // в шапке сайта тоже «Игрок 1»
  const { send, stop } = await openBrowser();
  try {
    await send('Page.navigate', { url: base + '/' });
    await waitFor(send, `document.readyState === 'complete'`, 'страница');
    await evalIn(send, `localStorage.setItem('tigris.session', ${JSON.stringify(JSON.stringify(a))})`);
    await send('Page.navigate', { url: base + '/#/' });
    await waitFor(send, `document.querySelector('header.bar a[href="#/me"], header.bar .me')`, 'шапка после входа');
    for (const [name, fn] of Object.entries(SHOTS)) {
      if (only.length && !only.includes(name)) continue;
      await fn(send, a.user.id);
    }
  } finally {
    await stop();
  }
}

await main();
