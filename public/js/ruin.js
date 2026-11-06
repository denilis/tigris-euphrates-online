// Разрушение тайлов, снятых войной (просьба Дениса 06.11: «что-то другое, другое разрушение
// тайлов»): эффекты на холсте поверх экрана партии. На поле стоит trophy (выбор Дениса 06.11,
// в 3 раза медленнее: game.js trophies): тайл сворачивается в золотую монету и летит к очкам
// победителя. Остальные три показывались в демо (specs/2026-11-06-разрушение-тайлов/) и
// оставлены на случай смены выбора: sand — рассыпается песком на ветру; shards — раскалывается,
// как глиняная табличка; flood — уходит под воду: синеет, тонет, круги и брызги.
// Холст закреплен над host (position: fixed); каждый кадр место клетки берется заново, до своей
// очереди в волне тайл стоит целым.

export const RUIN_S = { sand: 2.2, shards: 1.9, flood: 1.9, trophy: 1.7 };

const rnd = Math.random;
const clamp = (v) => Math.max(0, Math.min(1, v));
const ease = (k) => k * k * (3 - 2 * k);

let SOFT = null;
function soft() {
  if (SOFT) return SOFT;
  const mk = (rgb, a) => {
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(0.5, `rgba(${rgb},${a * 0.4})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  };
  SOFT = { dust: mk('214,190,140', 0.6), gold: mk('255,214,110', 1), water: mk('70,150,210', 0.7) };
  return SOFT;
}

// цвета песчинок по картинке тайла (картинки тайлов с того же сайта, читать их можно)
const GRAIN = 18;
const grainCache = new WeakMap();
function grainColors(img) {
  if (grainCache.has(img)) return grainCache.get(img);
  const c = document.createElement('canvas');
  c.width = c.height = GRAIN;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, GRAIN, GRAIN);
  let out;
  try {
    const d = g.getImageData(0, 0, GRAIN, GRAIN).data;
    out = Array.from({ length: GRAIN * GRAIN }, (_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
  } catch {
    out = Array.from({ length: GRAIN * GRAIN }, () => [190, 160, 110]);
  }
  grainCache.set(img, out);
  return out;
}

const ready = (img) => img && img.complete && img.naturalWidth > 0;

function tileAt(ctx, img, x, y, w, h) {
  if (!ready(img)) return;
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, w * 0.09);
  else ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

// --- песок: полоса распада бежит по тайлу с ветром, песчинки летят дугой и тают
function sand(ctx, e, dt, r) {
  const s = e.s;
  if (!s.grains) {
    const cols = grainColors(e.img);
    s.grains = [];
    for (let gy = 0; gy < GRAIN; gy++) {
      for (let gx = 0; gx < GRAIN; gx++) {
        s.grains.push({ hx: gx / GRAIN, hy: gy / GRAIN, c: cols[gy * GRAIN + gx], tr: 0.05 + (gx / GRAIN) * 0.6 + (1 - gy / GRAIN) * 0.12 + rnd() * 0.14, x: 0, y: 0, vx: 0, vy: 0, life: 0.8 + rnd() * 0.6, ph: rnd() * 6.3, out: false });
      }
    }
  }
  const q = 1 / GRAIN;
  // целая часть тайла: картинка в маске из еще не улетевших песчинок
  if (ready(e.img)) {
    ctx.save();
    ctx.beginPath();
    for (const g of s.grains) if (e.t < g.tr) ctx.rect(r.x + g.hx * r.w, r.y + g.hy * r.h, q * r.w + 0.6, q * r.h + 0.6);
    ctx.clip();
    ctx.drawImage(e.img, r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  for (const g of s.grains) {
    if (e.t < g.tr) continue;
    if (!g.out) Object.assign(g, { out: true, x: g.hx, y: g.hy, vx: 0.45 + rnd() * 0.9, vy: -(0.15 + rnd() * 0.45) });
    const age = e.t - g.tr, k = age / g.life;
    if (k >= 1) continue;
    g.vy += 0.95 * dt;
    g.vx += 0.25 * dt;
    g.x += g.vx * dt + Math.sin(age * 6 + g.ph) * 0.06 * dt;
    g.y += g.vy * dt;
    const m = Math.min(1, k * 1.5), sz = q * (1 - 0.55 * k) * r.w;
    const c = g.c.map((v, j) => Math.round(v + ([214, 186, 130][j] - v) * m)); // в полете становится песком
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(r.x + g.x * r.w, r.y + g.y * r.h, sz, sz);
  }
  // легкое облачко пыли там, где сейчас полоса распада
  const front = clamp((e.t - 0.1) / 0.75);
  if (front > 0 && front < 1) {
    const S = soft().dust, R = 0.5 * r.w;
    ctx.globalAlpha = 0.5 * Math.sin(Math.PI * front);
    ctx.drawImage(S, r.x + front * r.w - R + 0.15 * r.w, r.y + 0.5 * r.h - R, 2 * R, 2 * R);
  }
  ctx.globalAlpha = 1;
}

// --- черепки: от точки удара бегут трещины, тайл разлетается кусками, пыль
const CRACK = 0.32;
function shardsInit(s) {
  const P = { x: 0.38 + rnd() * 0.24, y: 0.38 + rnd() * 0.24 }, n = 7, base = rnd() * 6.3;
  const ang = Array.from({ length: n }, (_, i) => base + (i * 2 * Math.PI) / n + (rnd() - 0.5) * 0.5);
  const hit = (a) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    const tx = dx > 0 ? (1 - P.x) / dx : dx < 0 ? -P.x / dx : Infinity, ty = dy > 0 ? (1 - P.y) / dy : dy < 0 ? -P.y / dy : Infinity;
    const t = Math.min(tx, ty);
    return { x: P.x + dx * t, y: P.y + dy * t, len: t };
  };
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((c) => ({ ...c, a: Math.atan2(c.y - P.y, c.x - P.x) }));
  s.P = P;
  s.rays = ang.map((a) => {
    const h = hit(a), jag = [0.3, 0.6].map((f) => ({ x: P.x + (h.x - P.x) * f + (rnd() - 0.5) * 0.06, y: P.y + (h.y - P.y) * f + (rnd() - 0.5) * 0.06 }));
    return { a, h, jag };
  });
  s.shards = s.rays.map((ray, i) => {
    const nx = s.rays[(i + 1) % n], a0 = norm(ray.a), span = norm(nx.a - ray.a);
    const mid = corners.filter((c) => norm(c.a - a0) > 0 && norm(c.a - a0) < span).sort((p, q) => norm(p.a - a0) - norm(q.a - a0));
    const pts = [P, ...ray.jag, ray.h, ...mid, nx.h, ...[...nx.jag].reverse()];
    const c = { x: pts.reduce((v, p) => v + p.x, 0) / pts.length, y: pts.reduce((v, p) => v + p.y, 0) / pts.length };
    const dx = c.x - P.x, dy = c.y - P.y, d = Math.hypot(dx, dy) || 1;
    const sp = 0.35 + rnd() * 0.45;
    return { pts, c, dx: 0, dy: 0, vx: (dx / d) * sp, vy: (dy / d) * sp - 0.55 - rnd() * 0.3, rot: 0, vr: (rnd() - 0.5) * 7 };
  });
  s.dust = Array.from({ length: 9 }, () => ({ x: P.x + (rnd() - 0.5) * 0.5, y: P.y + (rnd() - 0.5) * 0.5, vx: (rnd() - 0.5) * 0.5, vy: -0.1 - rnd() * 0.25, sz: 0.25 + rnd() * 0.2 }));
}

function shards(ctx, e, dt, r) {
  const s = e.s;
  if (!s.P) shardsInit(s);
  if (e.t < CRACK) {
    tileAt(ctx, e.img, r.x, r.y, r.w, r.h);
    const k = ease(e.t / CRACK);
    ctx.save();
    ctx.lineJoin = 'round';
    for (const ray of s.rays) {
      const pts = [s.P, ...ray.jag, ray.h];
      ctx.beginPath();
      let left = k * ray.h.len * 1.15;
      ctx.moveTo(r.x + s.P.x * r.w, r.y + s.P.y * r.h);
      for (let i = 1; i < pts.length && left > 0; i++) {
        const a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y), f = Math.min(1, left / seg);
        ctx.lineTo(r.x + (a.x + (b.x - a.x) * f) * r.w, r.y + (a.y + (b.y - a.y) * f) * r.h);
        left -= seg;
      }
      ctx.strokeStyle = '#1b1309';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,228,170,.8)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const tt = e.t - CRACK;
  // пыль от удара
  const D = soft().dust;
  for (const d of s.dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    const k = clamp(tt / 0.9), R = (d.sz + k * 0.35) * r.w;
    ctx.globalAlpha = 0.55 * (1 - k);
    ctx.drawImage(D, r.x + d.x * r.w - R, r.y + d.y * r.h - R, 2 * R, 2 * R);
  }
  ctx.globalAlpha = 1;
  const fade = clamp((e.t - 1.15) / 0.55);
  for (const sh of s.shards) {
    sh.vy += 2.6 * dt;
    sh.dx += sh.vx * dt;
    sh.dy += sh.vy * dt;
    sh.rot += sh.vr * dt;
    if (!ready(e.img)) continue;
    ctx.save();
    ctx.globalAlpha = 1 - fade;
    ctx.translate(r.x + (sh.c.x + sh.dx) * r.w, r.y + (sh.c.y + sh.dy) * r.h);
    ctx.rotate(sh.rot);
    ctx.translate(-sh.c.x * r.w, -sh.c.y * r.h);
    ctx.beginPath();
    sh.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * r.w, p.y * r.h) : ctx.moveTo(p.x * r.w, p.y * r.h)));
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.drawImage(e.img, 0, 0, r.w, r.h);
    ctx.fillStyle = `rgba(40,24,10,${0.25 * clamp(tt / 0.6)})`; // черепок темнеет, как обожженная глина
    ctx.fillRect(0, 0, r.w, r.h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,236,190,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

// --- вода: тайл синеет и тонет, под ним лужа, круги расходятся, брызги
function flood(ctx, e, dt, r) {
  const s = e.s, cx = r.x + r.w / 2, cy = r.y + r.h / 2, W = soft().water;
  if (!s.drops) s.drops = [];
  if (!s.thrown && e.t > 0.12) {
    s.thrown = true;
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
      s.drops.push({ x: 0.5, y: 0.5, vx: Math.cos(a) * (0.4 + rnd() * 0.5), vy: Math.sin(a) * (0.8 + rnd() * 0.7), life: 0.5 + rnd() * 0.35, age: 0 });
    }
  }
  const pool = clamp(e.t / 0.3) * (1 - clamp((e.t - 1.3) / 0.5));
  ctx.globalAlpha = pool * 0.9;
  ctx.drawImage(W, cx - r.w * 0.75, cy - r.h * 0.5, r.w * 1.5, r.h * 1.1);
  ctx.globalAlpha = 1;
  // тайл тонет: сжимается вниз, качается, синеет
  const k = ease(clamp((e.t - 0.12) / 1.05));
  if (k < 1 && ready(e.img)) {
    const w = r.w * (1 - 0.7 * k), h = r.h * (1 - 0.8 * k), x = cx - w / 2 + Math.sin(e.t * 13) * 0.03 * r.w * k, y = cy - h / 2 + 0.22 * r.h * k;
    ctx.save();
    ctx.globalAlpha = 1 - k * 0.85;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, w * 0.09);
    else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(e.img, x, y, w, h);
    ctx.fillStyle = `rgba(36,104,160,${0.65 * k})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  // круги на воде
  ctx.save();
  for (const t0 of [0.1, 0.38, 0.66]) {
    const a = (e.t - t0) / 0.95;
    if (a <= 0 || a >= 1) continue;
    const R = (0.12 + 0.78 * a) * r.w;
    ctx.globalAlpha = 0.85 * (1 - a);
    ctx.strokeStyle = '#d8f0ff';
    ctx.lineWidth = 2.2 * (1 - a) + 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.12 * r.h, R, R * 0.5, 0, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  for (const d of s.drops) {
    d.age += dt;
    d.vy += 3 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.age > d.life) continue;
    ctx.globalAlpha = 0.95 * (1 - d.age / d.life);
    ctx.fillStyle = '#e6f6ff';
    ctx.beginPath();
    ctx.arc(r.x + d.x * r.w, r.y + d.y * r.h, 0.028 * r.w, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// --- трофей: тайл вспыхивает золотом, сворачивается в монету и летит к очкам победителя
const LIFT = 0.22, COIN = 0.5, LAND = 1.2;
function trophy(ctx, e, dt, r) {
  const s = e.s, cx = r.x + r.w / 2, cy = r.y + r.h / 2, G = soft().gold;
  if (!s.sparks) s.sparks = [];
  const tgt = e.target?.() || { x: cx, y: cy - 2 * r.h };
  let x = cx, y = cy, rad;
  if (e.t < LIFT) {
    const k = e.t / LIFT, sc = 1 + 0.1 * k;
    tileAt(ctx, e.img, cx - (r.w * sc) / 2, cy - (r.h * sc) / 2, r.w * sc, r.h * sc);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * k;
    ctx.drawImage(G, cx - r.w, cy - r.h, 2 * r.w, 2 * r.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return;
  }
  if (e.t < COIN) rad = r.w * (0.78 - 0.5 * ease((e.t - LIFT) / (COIN - LIFT)));
  else if (e.t < LAND) {
    const k = ease((e.t - COIN) / (LAND - COIN));
    const mx = (cx + tgt.x) / 2, my = Math.min(cy, tgt.y) - 1.2 * r.h; // дуга через верх
    x = (1 - k) * (1 - k) * cx + 2 * (1 - k) * k * mx + k * k * tgt.x;
    y = (1 - k) * (1 - k) * cy + 2 * (1 - k) * k * my + k * k * tgt.y;
    rad = r.w * (0.28 - 0.1 * k);
    if (rnd() < 0.9) s.sparks.push({ x, y, vx: (rnd() - 0.5) * 30, vy: (rnd() - 0.5) * 30, age: 0, life: 0.35 + rnd() * 0.2, sz: 0.12 });
  }
  if (e.t >= LAND && !s.landed) {
    s.landed = true;
    e.onArrive?.();
    for (let i = 0; i < 14; i++) {
      const a = rnd() * 6.3, v = 40 + rnd() * 60;
      s.sparks.push({ x: tgt.x, y: tgt.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.35 + rnd() * 0.25, sz: 0.16 });
    }
  }
  // искры следа и вспышки на месте прилета
  ctx.globalCompositeOperation = 'lighter';
  for (const p of s.sparks) {
    p.age += dt;
    if (p.age > p.life) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const R = p.sz * r.w * (1 - p.age / p.life);
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.drawImage(G, p.x - R, p.y - R, 2 * R, 2 * R);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (e.t >= LAND || rad == null) return;
  // монета: картинка тайла в круге, золотой ободок, блик
  if (ready(e.img)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(e.img, x - Math.max(rad, r.w / 2), y - Math.max(rad, r.h / 2), 2 * Math.max(rad, r.w / 2), 2 * Math.max(rad, r.h / 2));
    ctx.restore();
  }
  ctx.strokeStyle = '#e0b65a';
  ctx.lineWidth = Math.max(2, rad * 0.16);
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.6;
  ctx.drawImage(G, x - rad * 1.6, y - rad * 1.6, rad * 3.2, rad * 3.2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

const DRAW = { sand, shards, flood, trophy };

/**
 * Слой разрушения над host. play(kind, rectOf, { img, delay, target, onArrive }): rectOf() дает
 * место клетки в координатах host, img — картинка тайла, delay — мс до своей очереди в волне
 * (до нее тайл стоит целым), target() — куда летит монета трофея, onArrive — монета долетела.
 */
export function ruinLayer(host) {
  const cv = document.createElement('canvas');
  cv.className = 'firecv';
  cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'fixed', pointerEvents: 'none', display: 'none' });
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  let list = [], raf = 0, last = 0, speed = 1;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) * speed;
    last = now;
    const hr = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(hr.width * dpr), H = Math.round(hr.height * dpr);
    Object.assign(cv.style, { left: `${hr.left}px`, top: `${hr.top}px`, width: `${hr.width}px`, height: `${hr.height}px` });
    if (cv.width !== W || cv.height !== H) Object.assign(cv, { width: W, height: H });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, hr.width, hr.height);
    for (const e of list) {
      e.t += dt;
      const r = e.rectOf();
      if (!r) continue;
      if (e.t < 0) tileAt(ctx, e.img, r.x, r.y, r.w, r.h);
      else DRAW[e.kind](ctx, e, dt, r);
    }
    list = list.filter((e) => e.t < RUIN_S[e.kind]);
    if (list.length) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      ctx.clearRect(0, 0, hr.width, hr.height);
      cv.style.display = 'none';
    }
  }

  return {
    play(kind, rectOf, { img = null, delay = 0, target = null, onArrive = null } = {}) {
      if (!DRAW[kind]) return;
      list.push({ kind, rectOf, img, target, onArrive, t: -delay / 1000, s: {} });
      cv.style.display = '';
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    set speed(v) { speed = v; },
    get alive() { return cv.isConnected; },
    clear() { list = []; },
  };
}
