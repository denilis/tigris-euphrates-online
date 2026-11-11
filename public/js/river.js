// Река линией по речным клеткам (просьба Дениса 04.11 по фото настольного поля, макет
// specs/2026-11-04-река одобрен): вода только в извилистом русле, а не во всей клетке. Русло
// проходит через каждую речную клетку и не выходит на сушу, это проверяют тесты. Речные клетки
// чуть зеленее песка: видно, куда класть синие тайлы. Для незнакомой карты (клетки реки не те)
// русла нет, и поле рисует прежнюю заливку клеток.
// Точки русла: [x, y, ширина?] в клетках, центр клетки B3 = [1.5, 2.5]. Концы за краем поля.
// join: река впадает в другую, к месту впадения ее извилины гаснут.
// У поля не 16x11 размер записан в самом списке русел (w, h): модуль не зависит от текущего стола.
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
    // приток с правого края между P4 и P5 впадает в Тигр в O5
    { id: 'tributary', w: 10, join: true, pts: [[16.8, 4], [15.5, 4], [14.5, 4.5]] },
  ],
  // большое поле 19x13 (Денис 10.11): короткий Евфрат в северо-западном углу и длинный Тигр через все поле
  big: Object.assign([
    { id: 'arm', w: 9, join: true, pts: [[7.5, -0.8], [7.5, 0.5], [7.45, 1.5], [6.6, 2.4]] },
    { id: 'euphrates', w: 13, pts: [[6.5, -0.8], [6.5, 0.5], [6.5, 1.5], [6.5, 2.5], [5.5, 2.5], [4.5, 2.5], [3.5, 2.5], [3.5, 3.5], [3.5, 4.5], [2.5, 4.5], [1.5, 4.5], [0.5, 4.5], [-0.8, 4.5]] },
    // рукав B4-C4 с островом
    { id: 'isle', w: 9, join: true, pts: [[3.4, 3.5], [2.5, 3.5], [1.5, 3.5], [1.5, 4.4]] },
    { id: 'tigris', w: 13, pts: [[14.5, -0.8], [14.5, 0.5], [14.5, 1.5], [14.5, 2.5], [15.5, 2.5], [15.5, 3.5], [15.5, 4.5], [15.5, 5.5], [15.5, 6.5], [15.5, 7.5], [14.5, 7.5], [14.5, 8.5], [14.5, 9.5], [14.5, 10.5], [13.5, 10.5], [12.5, 10.5], [11.5, 10.5], [10.5, 10.5], [9.5, 10.5], [8.5, 10.5], [8.5, 9.5], [8.5, 8.5], [7.5, 8.5], [6.5, 8.5], [5.5, 8.5], [4.5, 8.5], [4.5, 7.5], [3.5, 7.5], [2.5, 7.5], [1.5, 7.5], [0.5, 7.5], [-0.8, 7.5]] },
    // два притока с правого края: по ряду 5 в Тигр, по ряду 4 в первый приток
    { id: 'east', w: 10, join: true, pts: [[19.8, 4.5], [18.5, 4.5], [17.5, 4.5], [16.5, 4.5], [15.6, 4.5]] },
    { id: 'north', w: 9, join: true, pts: [[19.8, 3.5], [18.5, 3.5], [17.5, 3.5], [17.5, 4.4]] },
    // рукав по ряду 10 с островом между ним и Тигром
    { id: 'braid', w: 9, join: true, pts: [[14.4, 9.5], [13.5, 9.5], [12.5, 9.5], [11.5, 9.5], [10.5, 9.5], [9.5, 9.5], [8.6, 9.5]] },
    // рукав уходит за левый край по ряду 9
    { id: 'west', w: 9, pts: [[1.5, 7.6], [1.5, 8.5], [0.5, 8.5], [-0.8, 8.5]] },
  ], { w: 19, h: 13 }),
};
const sizeOf = (routes) => [routes.w ?? 16, routes.h ?? 11];

const f1 = (v) => Math.round(v * 10) / 10;

/** Плавная кривая через точки (Катмулл-Ром) с шагом около 4 px: [{x, y, w}]. Чаще не нужно: глазу не видно, а рисунок вдвое тяжелее. */
function spline(pts, w0, C, G) {
  const P = pts.map(([x, y, w]) => ({ x: G + x * C, y: G + y * C, w: w ?? w0 }));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i], p2 = P[i + 1];
    const p0 = P[i - 1] ?? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = P[i + 2] ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    const n = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 4));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t });
    }
  }
  const last = P[P.length - 1];
  out.push({ ...last });
  return out;
}

/** Средняя линия русла с извилинами: [{x, y, w, nx, ny}], n — нормаль к течению. */
function channel(route, calm, C, G) {
  const pts = spline(route.pts, route.w, C, G);
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
  // фаза извилин своя у каждой реки и не меняется: поле рисуется одинаково при каждом заходе
  const seed = [...route.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const ph1 = seed % 7, ph2 = (seed * 3) % 11, ph3 = (seed * 5) % 13;
  let j0 = 0, j1 = 0;
  return pts.map((p, i) => {
    // на поворотах извилины меньше: кривая и так изгибается, а выходить на сушу нельзя
    while (pts[j0].s < p.s - 22) j0++;
    while (j1 < pts.length - 1 && pts[j1].s < p.s + 22) j1++;
    let turn = Math.abs(head(j1) - head(j0));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    let A = 8.5 * Math.max(0.15, 1 - turn / 1.2);
    // к месту впадения извилины гаснут, чтобы русла сходились
    if (route.join) A *= Math.min(1, (L - p.s) / 45);
    for (const c of calm) A *= Math.min(1, Math.hypot(p.x - c.x, p.y - c.y) / 50);
    const off = A * (0.65 * Math.sin((2 * Math.PI * p.s) / 118 + ph1) + 0.35 * Math.sin((2 * Math.PI * p.s) / 49 + ph2));
    const narrow = route.join ? Math.min(1, 0.75 + (L - p.s) / 180) : 1;
    const w = p.w * (1 + 0.14 * Math.sin((2 * Math.PI * p.s) / 160 + ph3)) * narrow;
    const h = head(i), nx = -Math.sin(h), ny = Math.cos(h);
    return { x: p.x + nx * off, y: p.y + ny * off, w, nx, ny };
  });
}

/** Все русла карты: у места впадения притока гаснут извилины и той реки, в которую он впадает. */
function channels(routes, C, G) {
  const mouths = routes.filter((r) => r.join).map((r) => {
    const [x, y] = r.pts[r.pts.length - 1];
    return { r, x: G + x * C, y: G + y * C };
  });
  return routes.map((r) => ({ route: r, ch: channel(r, mouths.filter((m) => m.r !== r), C, G) }));
}

const cellAt = (x, y, C, G, W, H) => {
  const gx = Math.floor((x - G) / C), gy = Math.floor((y - G) / C);
  return gx < 0 || gy < 0 || gx >= W || gy >= H ? -1 : gy * W + gx;
};
const name = (i, W) => String.fromCharCode(65 + (i % W)) + ((i / W | 0) + 1);

/** Клетки суши, на которые заходит вода русла (должно быть пусто). */
export function landCells(routes, river, C, G) {
  const set = new Set(river), bad = new Set(), [W, H] = sizeOf(routes);
  for (const { ch } of channels(routes, C, G)) {
    for (const p of ch) {
      for (const side of [1, -1]) {
        const i = cellAt(p.x + side * p.nx * p.w / 2, p.y + side * p.ny * p.w / 2, C, G, W, H);
        if (i >= 0 && !set.has(i)) bad.add(name(i, W));
      }
    }
  }
  return [...bad];
}

/** Речные клетки, через которые русло не прошло (должно быть пусто). */
export function missedCells(routes, river, C, G) {
  const hit = new Set(), [W, H] = sizeOf(routes);
  for (const { ch } of channels(routes, C, G)) for (const p of ch) hit.add(cellAt(p.x, p.y, C, G, W, H));
  return river.filter((i) => !hit.has(i)).map((i) => name(i, W));
}

const known = new Map();
/** Русла для клеток реки или null, если таких карт нет. Узнается по клеткам, результат запоминается. */
export function riverFor(river, C, G) {
  const sig = `${C}:${G}:${[...river].sort((a, b) => a - b).join(',')}`;
  if (!known.has(sig)) {
    let found = null;
    for (const [key, routes] of Object.entries(ROUTES)) {
      if (!missedCells(routes, river, C, G).length && !landCells(routes, river, C, G).length) {
        found = { key, chs: channels(routes, C, G) };
        break;
      }
    }
    known.set(sig, found);
  }
  return known.get(sig);
}

/** Контур русла с запасом extra px по ширине: замкнутый путь SVG. */
function outline(ch, extra = 0) {
  const side = (k) => ch.map((p) => `${f1(p.x + k * p.nx * (p.w / 2 + extra))} ${f1(p.y + k * p.ny * (p.w / 2 + extra))}`);
  return 'M' + [...side(1), ...side(-1).reverse()].join('L') + 'Z';
}

const midline = (ch) => 'M' + ch.map((p) => `${f1(p.x - p.nx * p.w * 0.18)} ${f1(p.y - p.ny * p.w * 0.18)}`).join('L');
const GLINT = ['22 14 7 19', '17 12 9 21', '19 11 8 16'];

/**
 * Слой реки внутри обрезки поля или null для незнакомой карты. relief: вода текстурой (#waterP),
 * иначе градиентом (#water) с рябью (#ripple). Подсветка речных клеток по маске поля #riverM.
 */
export function riverLayer(river, relief, C, G) {
  const r = riverFor(river, C, G);
  if (!r) return null;
  const [W, H] = sizeOf(ROUTES[r.key]);
  const R = `x="${G}" y="${G}" width="${W * C}" height="${H * C}"`;
  const water = r.chs.map(({ ch }) => outline(ch));
  let s = `<g class="stream"><defs>
    <filter id="bankBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4"/></filter>
    <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e3550" stop-opacity="0"/><stop offset="1" stop-color="#0e3550" stop-opacity=".25"/></linearGradient>
    ${relief ? '' : `<clipPath id="streamClip">${water.map((d) => `<path d="${d}"/>`).join('')}</clipPath>`}
  </defs>`;
  s += `<rect ${R} fill="#7d9a55" fill-opacity="${relief ? '.34' : '.3'}" mask="url(#riverM)"/>`;
  // влажный берег, кромка, вода: кромки соседних рек перекрываются водой и в месте слияния не видны
  s += `<g filter="url(#bankBlur)">${r.chs.map(({ ch }) => `<path d="${outline(ch, 5)}" fill="#4d3a18" fill-opacity=".38"/>`).join('')}</g>`;
  s += r.chs.map(({ ch }) => `<path d="${outline(ch, 1.6)}" fill="#1f4258" fill-opacity=".9"/>`).join('');
  s += water.map((d) => `<path d="${d}" fill="${relief ? 'url(#waterP)' : 'url(#water)'}"/><path d="${d}" fill="url(#deep)"/>`).join('');
  if (!relief) s += `<g clip-path="url(#streamClip)"><rect ${R} filter="url(#ripple)" opacity=".55"/></g>`;
  s += r.chs.map(({ ch }, k) => `<path d="${midline(ch)}" fill="none" stroke="#e6f5ff" stroke-opacity=".32" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="${GLINT[k % GLINT.length]}"/>`).join('');
  return s + '</g>';
}
