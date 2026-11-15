// Съёмка обучающих позиций: постановочный стол кладётся в локальный сервер, ходы идут настоящим
// движком, экран рисует настоящий клиент, подсказки поверх него добавляются только в снимок.
//   node tools/tutorial/shoot.mjs <порт сервера> <папка кадров> [имя сцены ...]
// Сервер: dev/server.js. Chrome запускается сам, без окна, в отдельном временном профиле.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from '../../../tigris-bot/tools/cdp.js';
import { createTable, sit, setHero, setSeatCount, start, submitSeat } from '../../game/table.js';
import { stateFromJSON, stateToJSON } from '../../game/serialize.js';
import { makeRng } from '../../game/vendor/engine/rng.js';
import { SCENES } from './scenes.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEV_ADMIN_CODE = 'DEVA-DMNN-2345'; // локальный код из dev/server.js
const [port = '3018', outDir, ...only] = process.argv.slice(2);
const base = `http://localhost:${port}`;
const VW = 1600, VH = 900, DBG = 9444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (Date.now() % 46656).toString(36).toUpperCase().padStart(3, '0');
let frameNo = 0;
const nextCode = () => `${run}${String(++frameNo).padStart(3, '0')}`;

// --- стол

const NAMES = ['Игрок 1', 'Игрок 2', 'Игрок 3'];
function newTable(meId, options = {}) {
  const now = Date.now();
  const users = [{ userId: meId, name: NAMES[0] }, { userId: 'tut-2', name: NAMES[1] }, { userId: 'tut-3', name: NAMES[2] }];
  const t = createTable({ code: 'TUT000', host: users[0], now });
  setSeatCount(t, meId, 3, now);
  sit(t, users[1], 1, now);
  sit(t, users[2], 2, now);
  ['lion', 'bull', 'bow'].forEach((h, i) => setHero(t, users[i].userId, i, h, now));
  Object.assign(t.options, { order: 'custom', confirmSeconds: 0 }, options);
  start(t, meId, { rng: makeRng(7), now });
  return t;
}

/** Поправить состояние движка стола: сцена расставляет поле напрямую. */
function edit(t, fn) {
  const s = stateFromJSON(t.game.state);
  fn(s);
  t.game.state = stateToJSON(s);
  t.game.toMove = t.game.order[s.toMove];
}

const rng = makeRng(11);
function play(t, move) {
  const s = stateFromJSON(t.game.state);
  submitSeat(t, t.game.order[s.toMove], move, { rng, now: Date.now() });
}

async function postFrame(t) {
  const code = nextCode();
  const clone = JSON.parse(JSON.stringify(t));
  clone.code = code;
  clone.createdAt = clone.updatedAt = Date.now();
  if (clone.game?.clock) clone.game.clock.at = Date.now();
  const r = await fetch(`${base}/__dev/table`, { method: 'POST', body: JSON.stringify(clone) });
  if (!r.ok) throw new Error(`стол не лёг: ${r.status} ${await r.text()}`);
  return code;
}

// --- браузер

async function openBrowser() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'tigris-tut-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, `--window-size=${VW},${VH}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  let br = null;
  for (let k = 0; k < 40 && !br; k++) {
    await sleep(250);
    try { br = await connect(DBG); } catch { /* ещё не поднялся */ }
  }
  if (!br) throw new Error('Chrome не ответил');
  const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => br.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
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

/** Дождаться условия на странице. */
async function waitFor(send, cond, what) {
  for (let k = 0; k < 80; k++) {
    if (await evalIn(send, `Boolean(${cond})`)) return;
    await sleep(100);
  }
  throw new Error('не дождался: ' + what);
}

// подсказки поверх экрана: только в снимке, клиент об этом не знает
const OVERLAY = `(o) => {
  document.getElementById('tut')?.remove();
  const root = document.createElement('div');
  root.id = 'tut';
  root.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none';
  const COL = { gold: '255,206,84', red: '240,80,70', green: '96,214,130', blue: '110,180,255', white: '255,255,255' };
  for (const g of o.marks || []) {
    const rgb = COL[g.color || 'gold'];
    const set = new Set(g.cells);
    for (const i of g.cells) {
      const el = document.querySelector('.cell-hit[data-i="' + i + '"]');
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = document.createElement('div');
      const edge = (n) => set.has(n) ? '0' : '3px solid rgb(' + rgb + ')';
      const left = i % 16 === 0 ? -1 : i - 1, right = i % 16 === 15 ? -1 : i + 1;
      d.style.cssText = 'position:absolute;box-sizing:border-box;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;'
        + 'background:rgba(' + rgb + ',' + (g.fill ?? 0.22) + ');border-left:' + edge(left) + ';border-right:' + edge(right) + ';border-top:' + edge(i - 16) + ';border-bottom:' + edge(i + 16) + ';'
        + 'box-shadow:0 0 14px rgba(' + rgb + ',.55)';
      root.append(d);
    }
  }
  for (const g of o.boxes || []) {
    const el = document.querySelector(g.sel);
    if (!el) throw new Error('нет элемента ' + g.sel);
    const r = el.getBoundingClientRect();
    const rgb = COL[g.color || 'gold'];
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;box-sizing:border-box;left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px;'
      + 'border:3px solid rgb(' + rgb + ');border-radius:10px;box-shadow:0 0 16px rgba(' + rgb + ',.6)';
    root.append(d);
  }
  if (o.caption) {
    const c = document.createElement('div');
    c.textContent = o.caption;
    const wrap = document.querySelector('.boardwrap').getBoundingClientRect();
    // обычно подпись закрывает полосу руки, а поле остаётся открытым; если рука нужна, подпись на поле
    const onBoard = o.captionPos === 'board';
    const hand = document.querySelector('#gHand').getBoundingClientRect();
    c.style.cssText = 'position:absolute;left:' + (wrap.left + 12) + 'px;width:' + (wrap.width - 24) + 'px;box-sizing:border-box;'
      + (onBoard ? 'top:' + (wrap.bottom - 88) + 'px;' : 'top:' + (hand.top + 8) + 'px;height:' + (hand.height - 16) + 'px;display:flex;align-items:center;justify-content:center;')
      + 'padding:12px 20px;border-radius:12px;background:rgba(20,15,10,.96);border:1px solid rgba(255,206,84,.65);color:#fff3d6;'
      + 'font:600 25px/1.28 system-ui,Segoe UI,sans-serif;text-align:center';
    root.append(c);
  }
  document.body.append(root);
}`;

/** Кадры сцены: обычно один; burst снимает живую анимацию клиента (карточка боя) покадрово. */
async function shoot(send, t, step, dir, name) {
  const code = await postFrame(t);
  await send('Runtime.evaluate', { expression: `location.hash = '#/t/${code}'` });
  await waitFor(send, `document.querySelector('#gCode')?.textContent.includes('${code}') && document.querySelector('.cell-hit')`, 'поле ' + code);
  await sleep(350);
  for (const sel of step.click || []) {
    await evalIn(send, `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('нет кнопки ' + ${JSON.stringify(sel)}); b.click(); })()`);
    await sleep(150);
  }
  await evalIn(send, `(${OVERLAY})(${JSON.stringify({ marks: step.marks, boxes: step.boxes, caption: step.caption, captionPos: step.captionPos })})`);
  const out = [];
  const snap = async (file, ms) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    out.push({ file, ms, caption: step.caption || '' });
  };
  for (let k = 0; k < (step.burst || 0); k++) await snap(`${name}-${String(k + 1).padStart(2, '0')}.png`, 200);
  if (step.burst) await sleep(900);
  else await sleep(120);
  await snap(`${name}.png`, step.ms || 2600);
  return out;
}

// --- сцены

async function main() {
  const a = await (await fetch(`${base}/api/activate`, { method: 'POST', body: JSON.stringify({ code: DEV_ADMIN_CODE }) })).json();
  if (!a.user) throw new Error('локальный вход не прошёл: ' + JSON.stringify(a.error));
  const meId = a.user.id;
  const { send, stop } = await openBrowser();
  try {
    await send('Page.navigate', { url: base + '/' });
    await waitFor(send, `document.readyState === 'complete'`, 'страница');
    await evalIn(send, `localStorage.setItem('tigris.session', ${JSON.stringify(JSON.stringify(a))})`);
    await send('Page.navigate', { url: base + '/#/' });
    await waitFor(send, `document.querySelector('#newTable')`, 'мои столы');
    for (const sc of SCENES) {
      if (only.length && !only.includes(sc.name)) continue;
      const dir = path.join(outDir, sc.name);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const t = newTable(meId, sc.options);
      edit(t, sc.setup);
      const list = [];
      for (const [k, step] of sc.steps.entries()) {
        if (step.edit) edit(t, step.edit);
        for (const m of step.moves || []) play(t, m);
        list.push(...await shoot(send, t, step, dir, String(k + 1).padStart(2, '0')));
      }
      writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ title: sc.title, frames: list }, null, 1));
      console.log(`${sc.name}: кадров ${list.length}`);
    }
  } finally {
    await stop();
  }
}

await main();
