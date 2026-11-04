// Макет: река тонкой извилистой линией по речным клеткам, как на настольном поле (просьба Дениса
// 04.11). Сейчас клетки реки залиты водой целиком. Здесь вода только в русле, русло проходит
// через каждую речную клетку и не выходит на сушу. Русло задано точками в долях клетки, извилины
// добавляются поверх плавной кривой.

export const C = 60, G = 24, W = 16, H = 11;

// Точки русла: [x, y, ширина?] в клетках, центр клетки B3 = [1.5, 2.5]. Концы за краем поля.
// join: река впадает в другую, к устью извилины гаснут.
export const ROUTES = {
  advanced: [
    // в два ряда клеток (C1-D3) река идет двумя рукавами с островом между ними
    { id: 'arm', w: 9, join: true, pts: [[3.5, -0.8], [3.5, 0.5], [3.55, 1.5], [3.4, 2.4], [2.55, 2.95]] },
    { id: 'euphrates', w: 12, join: true, pts: [[2.5, -0.8], [2.45, 0.5], [2.5, 1.5], [2.5, 2.5], [2.5, 3.5], [2.5, 4.5], [2.5, 5.5], [2.5, 6.5], [3.5, 6.5], [3.5, 7.5], [4.5, 7.5], [5.5, 7.5], [5.5, 8.5], [6.5, 8.5], [7.5, 8.5], [7.5, 9.5]] },
    { id: 'tigris', w: 13, pts: [[15.5, -0.8], [15.5, 0.5], [15.5, 1.5], [15.5, 2.5], [15.5, 3.5], [14.5, 3.5], [13.5, 3.5], [12.5, 3.5], [12.5, 4.5], [12.5, 5.5], [12.5, 6.5], [13.5, 6.5], [13.5, 7.5], [13.5, 8.5], [13.5, 9.5], [12.5, 9.5], [11.5, 9.5], [10.5, 9.5], [9.5, 9.5], [8.5, 9.5], [7.5, 9.5, 16], [6.5, 9.5, 16], [6.5, 10.5, 16], [6.5, 11.8, 16]] },
  ],
  standard: [
    { id: 'euphrates', w: 13, pts: [[8.5, -0.8], [8.5, 0.5], [7.5, 0.5], [6.5, 0.5], [5.5, 0.5], [4.5, 0.5], [4.5, 1.5], [4.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5], [1.5, 3.5], [0.5, 3.5], [-0.8, 3.5]] },
    { id: 'tigris', w: 13, pts: [[12.5, -0.8], [12.5, 0.5], [12.5, 1.5], [12.5, 2.5], [13.5, 2.5], [13.5, 3.5], [14.5, 3.5], [14.5, 4.5, 15], [14.5, 5.5, 15], [14.5, 6.5, 15], [13.5, 6.5, 15], [12.5, 6.5, 15], [12.5, 7.5, 15], [12.5, 8.5, 15], [11.5, 8.5, 15], [10.5, 8.5, 15], [9.5, 8.5, 15], [8.5, 8.5, 15], [7.5, 8.5, 15], [6.5, 8.5, 15], [6.5, 7.5, 15], [5.5, 7.5, 15], [4.5, 7.5, 15], [3.5, 7.5, 15], [3.5, 6.5, 15], [2.5, 6.5, 15], [1.5, 6.5, 15], [0.5, 6.5, 15], [-0.8, 6.5, 15]] },
    { id: 'tributary', w: 10, join: true, pts: [[16.8, 4], [15.5, 4], [14.5, 4.5]] },
  ],
};

const px = ([x, y]) => [G + x * C, G + y * C];
const f1 = (v) => Math.round(v * 10) / 10;

/** Плавная кривая через точки (Катмулл-Ром), шаг около 2 px: [{x, y, w}]. */
function spline(pts, w0) {
  const P = pts.map((p) => { const [x, y] = px(p); return { x, y, w: p[2] ?? w0 }; });
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? { x: 2 * P[0].x - P[1].x, y: 2 * P[0].y - P[1].y }, p1 = P[i], p2 = P[i + 1];
    const p3 = P[i + 2] ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    const n = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t });
    }
  }
  const last = P[P.length - 1];
  out.push({ x: last.x, y: last.y, w: last.w });
  return out;
}

/** Русло: точки средней линии с извилинами и шириной, края слева и справа. */
export function channel(route, calm = []) {
  const pts = spline(route.pts, route.w);
  // длина вдоль русла и направление
  let s = 0;
  pts.forEach((p, i) => {
    if (i) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    p.s = s;
  });
  const L = s;
  const head = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const seed = [...route.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const ph1 = seed % 7, ph2 = (seed * 3) % 11, ph3 = (seed * 5) % 13;
  return pts.map((p, i) => {
    const h = head(i);
    // на поворотах извилины меньше: кривая и так изгибается, а вылет на сушу недопустим
    const j0 = pts.findIndex((q) => q.s >= p.s - 22), j1 = pts.findIndex((q) => q.s >= p.s + 22);
    let turn = Math.abs(head(j1 < 0 ? pts.length - 1 : j1) - head(j0));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    let A = 8.5 * Math.max(0.15, 1 - turn / 1.2);
    // у устья и у места впадения извилины гаснут, чтобы русла сходились
    if (route.join) A *= Math.min(1, (L - p.s) / 45);
    for (const c of calm) A *= Math.min(1, Math.hypot(p.x - c.x, p.y - c.y) / 50);
    const off = A * (0.65 * Math.sin((2 * Math.PI * p.s) / 118 + ph1) + 0.35 * Math.sin((2 * Math.PI * p.s) / 49 + ph2));
    const w = p.w * (1 + 0.14 * Math.sin((2 * Math.PI * p.s) / 160 + ph3)) * (route.join ? Math.min(1, 0.75 + (L - p.s) / 180) + 0 : 1);
    const nx = -Math.sin(h), ny = Math.cos(h);
    const x = p.x + nx * off, y = p.y + ny * off;
    return { x, y, w, nx, ny };
  });
}

/** Контур русла с запасом extra px по ширине: замкнутый путь SVG. */
function outline(ch, extra = 0) {
  const L = ch.map((p) => [p.x + p.nx * (p.w / 2 + extra), p.y + p.ny * (p.w / 2 + extra)]);
  const R = ch.map((p) => [p.x - p.nx * (p.w / 2 + extra), p.y - p.ny * (p.w / 2 + extra)]).reverse();
  return 'M' + [...L, ...R].map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + 'Z';
}

const midline = (ch) => 'M' + ch.map((p) => `${f1(p.x - p.nx * p.w * 0.18)} ${f1(p.y - p.ny * p.w * 0.18)}`).join('L');

/** Все русла карты. Места впадения: концы рек с join. */
export function channels(key) {
  const routes = ROUTES[key];
  const mouths = routes.filter((r) => r.join).map((r) => { const [x, y] = px(r.pts[r.pts.length - 1]); return { r, x, y }; });
  // у места впадения притока извилины гаснут у всех рек, кроме самого притока (у него свое затухание)
  return routes.map((r) => ({ route: r, ch: channel(r, mouths.filter((m) => m.r !== r)) }));
}

/**
 * Слой реки для статичного слоя поля. relief: вода текстурой (#waterP), иначе градиентом (#water).
 * wash: легкая подсветка речных клеток маской #riverM, чтобы было видно, куда класть синие тайлы.
 */
export function riverSVG(key, { relief = true, wash = true } = {}) {
  const all = channels(key);
  const fill = relief ? 'url(#waterP)' : 'url(#water)';
  let s = `<defs>
    <filter id="bankBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4"/></filter>
    <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e3550" stop-opacity=".0"/><stop offset="1" stop-color="#0e3550" stop-opacity=".25"/></linearGradient>
  </defs>`;
  const R = `x="${G}" y="${G}" width="${W * C}" height="${H * C}"`;
  if (wash) s += `<rect ${R} fill="#7d9a55" fill-opacity=".34" mask="url(#riverM)"/>`;
  // берег: влажный песок вокруг русла
  s += `<g filter="url(#bankBlur)">${all.map(({ ch }) => `<path d="${outline(ch, 5)}" fill="#4d3a18" fill-opacity=".38"/>`).join('')}</g>`;
  // кромка воды, потом сама вода: кромки соседних рек перекрываются водой и не видны в месте слияния
  s += all.map(({ ch }) => `<path d="${outline(ch, 1.6)}" fill="#1f4258" fill-opacity=".9"/>`).join('');
  s += all.map(({ ch }) => `<path d="${outline(ch)}" fill="${fill}"/><path d="${outline(ch)}" fill="url(#deep)"/>`).join('');
  // блики на воде
  s += all.map(({ ch, route }) => `<path d="${midline(ch)}" fill="none" stroke="#e6f5ff" stroke-opacity=".32" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="${route.id === 'tigris' ? '22 14 7 19' : '17 12 9 21'}"/>`).join('');
  return s;
}

/** Проверка: края русла внутри поля лежат только в речных клетках. Возвращает число вылетов. */
export function check(key, river) {
  const set = new Set(river);
  const bad = [];
  for (const { route, ch } of channels(key)) {
    for (const p of ch) {
      for (const side of [1, -1]) {
        const x = p.x + side * p.nx * p.w / 2, y = p.y + side * p.ny * p.w / 2;
        const gx = Math.floor((x - G) / C), gy = Math.floor((y - G) / C);
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        if (!set.has(gy * W + gx)) bad.push(`${route.id} ${String.fromCharCode(65 + gx)}${gy + 1}`);
      }
    }
  }
  return [...new Set(bad)];
}

/** Речные клетки, через которые русло не прошло (центральная линия не заходит в клетку). */
export function missed(key, river) {
  const hit = new Set();
  for (const { ch } of channels(key)) {
    for (const p of ch) {
      const gx = Math.floor((p.x - G) / C), gy = Math.floor((p.y - G) / C);
      hit.add(gy * W + gx);
    }
  }
  return river.filter((i) => !hit.has(i)).map((i) => `${String.fromCharCode(65 + (i % W))}${(i / W | 0) + 1}`);
}
