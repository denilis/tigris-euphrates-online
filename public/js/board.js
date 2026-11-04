// Поле SVG по настоящей карте (река и храмы из движка), как в одобренном макете:
// песок с фактурой, река с плавными берегами, тайлы и жетоны героев картинками,
// монумент «Печать», контуры царств, подсветка допустимых клеток и сторон конфликта.
import { W, H, HEX, RING, COLKEY, HEROES, FACEDOWN, CATASTROPHE, tileImg, catImg, uniteImg, tokenImg, cellName, groups, tileOwners, kingdomLeaders, leaderSupport } from './util.js';
import { TRAIL_FRESH_MS, landing } from './trail.js';
import { ALL_ON } from './layers.js';
import { riverLayer } from './river.js';

const C = 60, G = 24, PAD = 6;
const VW = G + W * C + PAD, VH = G + H * C + PAD;
const cx = (i) => G + (i % W) * C, cy = (i) => G + (i / W | 0) * C;

// --- монумент «Печать» (решение Дениса 28.10): плитка в золотой раме, два цвета по диагонали
const MP = [
  { b: '#b8432f', l: '#dc6c50', d: '#7a2819' },
  { b: '#2d6a93', l: '#5293c0', d: '#1a4461' },
  { b: '#3d7a46', l: '#62a268', d: '#24502b' },
  { b: '#34302c', l: '#5c564f', d: '#161412' },
];
const GD = { b: '#e0b65a', l: '#f7e1a0', d: '#94691f' };
const f1 = (v) => +v.toFixed(1);

export function monDefs(p) {
  let s = '';
  [...MP, GD].forEach((P, k) => {
    const id = k === 4 ? 'g' : k;
    s += `<linearGradient id="${p}h${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${P.l}"/><stop offset=".55" stop-color="${P.b}"/><stop offset="1" stop-color="${P.d}"/></linearGradient>`;
    s += `<linearGradient id="${p}v${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.l}"/><stop offset=".6" stop-color="${P.b}"/><stop offset="1" stop-color="${P.d}"/></linearGradient>`;
  });
  s += `<pattern id="${p}br" patternUnits="userSpaceOnUse" width="12" height="8"><path d="M0 .4H12M0 4.4H12M3 .4V4.4M9 4.4V8.4" stroke="#000" stroke-opacity=".22" stroke-width=".7" fill="none"/></pattern>`;
  s += `<filter id="${p}sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>`;
  return s;
}

function rosette(x, y, r) {
  let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${GD.b}" stroke="${GD.d}" stroke-width="1"/>`;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    s += `<circle cx="${f1(x + Math.cos(a) * r * 0.58)}" cy="${f1(y + Math.sin(a) * r * 0.58)}" r="${f1(r * 0.27)}" fill="${GD.l}"/>`;
  }
  return s + `<circle cx="${x}" cy="${y}" r="${f1(r * 0.26)}" fill="${GD.d}"/>`;
}

/** Монумент двух цветов в квадрате 120x120 (2 на 2 клетки), p — префикс id в defs. */
export function sealSVG(c1, c2, x, y, p) {
  const H_ = (c) => `url(#${p}h${c})`;
  const st = 'stroke="#1c120a" stroke-opacity=".6" stroke-width="1"';
  let g = `<rect x="8" y="10" width="110" height="110" rx="10" fill="#000" opacity=".45" filter="url(#${p}sh)"/>`;
  g += `<rect x="4" y="4" width="112" height="112" rx="10" fill="url(#${p}vg)" ${st}/>`;
  g += `<rect x="8.5" y="8.5" width="103" height="103" rx="7" fill="none" stroke="${GD.d}" stroke-width="1.2"/>`;
  g += `<path d="M14 14H106L14 106Z" fill="${H_(c1)}"/><path d="M106 14V106H14Z" fill="${H_(c2)}"/>`;
  g += `<rect x="14" y="14" width="92" height="92" fill="url(#${p}br)"/>`;
  g += `<rect x="14" y="14" width="92" height="92" fill="none" stroke="#1c120a" stroke-opacity=".55"/>`;
  g += `<path d="M106 14L14 106" stroke="${GD.b}" stroke-width="3.2"/><path d="M106 14L14 106" stroke="${GD.l}" stroke-width="1"/>`;
  g += `<circle cx="60" cy="60" r="28" fill="#f0e2bf" stroke="${GD.d}" stroke-width="4"/><circle cx="60" cy="60" r="28" fill="none" stroke="${GD.l}" stroke-width="1.4"/>`;
  g += `<path d="M39 75H81V69H76V63H71V57H66V50H54V57H49V63H44V69H39Z" fill="#3a2614"/><path d="M57 75V59H63V75Z" fill="#d4b479"/>`;
  for (const [rx, ry] of [[14, 14], [106, 14], [14, 106], [106, 106]]) g += rosette(rx, ry, 7);
  return `<g transform="translate(${x},${y})">${g}</g>`;
}

// --- монумент картинкой (выбор Дениса 03.11): три вида из ChatGPT в настройках стола, у каждого
// 6 пар цветов (tools/monuments/recolor.py). Цвет 1 сверху слева, цвет 2 снизу справа, как у «Печати»
export const MON_STYLES = ['enamel', 'frame', 'ziggurat'];
export const monImg = (style, c1, c2) => `/img/monuments/${style}/${COLKEY[c1]}-${COLKEY[c2]}.webp`;
const isMonImg = (style) => MON_STYLES.includes(style);

/** Маленький монумент для панели выбора и запаса; style — вид из настроек стола. */
export function sealIcon(c1, c2, size = 46, style = null) {
  if (isMonImg(style)) return `<img class="monimg" src="${monImg(style, c1, c2)}" width="${size}" height="${size}" alt="" draggable="false">`;
  const p = `si${c1}${c2}`;
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"><defs>${monDefs(p)}</defs>${sealSVG(c1, c2, 0, 0, p)}</svg>`;
}

// --- здание: вид выбирает хозяин стола (Денис 04.11), на правила он не влияет.
// tile: плитка в стиле монументов (картинки Дениса 04.11, лист «Здания», вырезка tools/icons/cut.py);
// seal: прежняя «Малая печать» (выбор Дениса 30.10): золотая рама, поле цвета, силуэт здания.
export const buildingImg = (c) => `/img/buildings/${c}.webp`;

// --- чудо: картинка Дениса 04.11 (вариант B «Эмалевая печать»), подогнана под крест 3 на 3
// (scratchpad wonder_fit.py: лучи нарисованы шире трети, концы растянуты, середина сжата)
export const WONDER_IMG = '/img/wonder/wonder.webp';
/** Чудо крестом на 5 клеток: (x, y) левый верхний угол центральной клетки, c — размер клетки. */
export const wonderSVG = (x, y, c) => `<image href="${WONDER_IMG}" x="${x - c + 3}" y="${y - c + 3}" width="${3 * c - 6}" height="${3 * c - 6}"/>`;
export const BUILDING_STYLES = ['tile', 'seal'];
const BUILDING_SIL = [
  'M15 44H45V38H41V32H37V26H33V20H27V26H23V32H19V38H15Z', // храм: зиккурат
  'M17 44V30A13 13 0 0 1 43 30V44H34V35H26V44Z', // ферма: амбар
  'M14 31L30 18L46 31H43V44H35V34H25V44H17V31Z', // рынок
  'M16 44V23H20V27H24V23H28V27H32V23H36V27H40V23H44V44H34V36H26V44Z', // поселение: крепость
];

/** Здание цвета c в клетке с левым верхним углом (x, y), p — префикс id в defs, style — вид зданий. */
export function buildingSVG(c, x, y, p, style = 'tile') {
  if (style !== 'seal') return `<g transform="translate(${x},${y})" filter="url(#shadow2)"><image href="${buildingImg(c)}" x="1" y="1" width="58" height="58"/></g>`;
  let g = `<rect x="1" y="1" width="58" height="58" rx="6" fill="url(#${p}vg)" stroke="#1c120a" stroke-opacity=".6"/>`;
  g += `<rect x="5" y="5" width="50" height="50" fill="url(#${p}v${c})"/><rect x="5" y="5" width="50" height="50" fill="url(#${p}br)"/>`;
  g += `<circle cx="30" cy="30" r="21" fill="#f0e2bf" stroke="${GD.d}" stroke-width="2.4"/>`;
  g += `<path transform="translate(30 31) scale(.96) translate(-30 -31)" d="${BUILDING_SIL[c]}" fill="#3a2614"/>`;
  for (const [rx, ry] of [[5, 5], [55, 5], [5, 55], [55, 55]]) g += rosette(rx, ry, 3.6);
  return `<g transform="translate(${x},${y})" filter="url(#shadow2)">${g}</g>`;
}

/** Маленькое здание для блока «Запас» (свой svg со своими defs). */
export function buildingIcon(c, size = 28, style = 'tile') {
  const p = `bi${c}`;
  return `<svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden="true"><defs>${monDefs(p)}</defs>${buildingSVG(c, 0, 0, p, style)}</svg>`;
}

// Стрелка переноса лидера кончается за краем клетки (замечание Дениса 03.11): раньше она
// заходила в клетку на 30 px от центра и по диагонали ложилась на кружок силы. Путь кончается
// в 10 px от края клетки под любым углом, наконечник выступает за путь на 4 px, зазор около 6 px.
const ARROW_GAP = 10;

/** Путь стрелки из центра клетки from к клетке to. */
export function arrowPath(from, to) {
  const fx = cx(from) + C / 2, fy = cy(from) + C / 2, tx = cx(to) + C / 2, ty = cy(to) + C / 2;
  const len = Math.hypot(tx - fx, ty - fy), ux = (tx - fx) / len, uy = (ty - fy) / len;
  const stop = (C / 2 + ARROW_GAP) / Math.max(Math.abs(ux), Math.abs(uy)); // по лучу до квадрата чуть шире клетки
  return `M${f1(fx + ux * 8)} ${f1(fy + uy * 8)}L${f1(tx - ux * stop)} ${f1(ty - uy * stop)}`;
}

/**
 * След хода соперника (просьба Дениса 30.10): рамка с номером действия держится до следующего
 * хода, первые секунды пульсирует, у перестановки стрелка. Сам тайл или лидер плавно появляется
 * в renderBoard (класс arrive, 04.11).
 * Перерисовка не сбивает анимацию: отрицательная задержка равна возрасту отметки.
 * numbers — слой «Ходы»: без него рамка и стрелка остаются, номера нет.
 */
export function trailSVG(marks, numbers = true) {
  let s = '';
  for (const m of marks) {
    const x = cx(m.pos), y = cy(m.pos), side = m.size * C;
    const delay = ` style="animation-delay:-${m.age}ms"`;
    if (m.from != null) {
      const d = arrowPath(m.from, m.pos);
      s += `<path class="trail-back" d="${d}"/><path class="trail-arrow" d="${d}" marker-end="url(#trailArrow)"/><circle class="trail-from" cx="${cx(m.from) + C / 2}" cy="${cy(m.from) + C / 2}" r="6"/>`;
    }
    s += `<rect class="trail-back" x="${x + 1.5}" y="${y + 1.5}" width="${side - 3}" height="${side - 3}" rx="6"/>`;
    s += `<rect class="trail${m.age < TRAIL_FRESH_MS ? ' fresh' : ''}" x="${x + 1.5}" y="${y + 1.5}" width="${side - 3}" height="${side - 3}" rx="6"${delay}/>`;
    // номер желтым кругом (просьба Дениса 03.11): темный круг путался с поддержкой лидера
    if (numbers) s += `<g class="trail-no" transform="translate(${x + side - 13},${y + side - 13})"><circle r="11"/><text y="5" text-anchor="middle">${m.action}</text></g>`;
  }
  return s;
}

/**
 * Сокровище: белый деревянный кубик по центру храма, как ставят за настоящим столом (03.11).
 * 04.11 Денис прислал картинку кубика (tools/treasure/cube.py вырезает его из зеленого фона)
 * и попросил вдвое меньше прежнего: 11 вместо 22, потом на 30% больше: 14,3. У особого
 * сокровища золотой ободок: его торговец берет первым.
 */
export const TREASURE_IMG = '/img/treasure/cube.webp';
export const TREASURE_SIZE = 14.3;
export function treasureSVG(i, special) {
  const S = TREASURE_SIZE, x = f1(cx(i) + (C - S) / 2), y = f1(cy(i) + (C - S) / 2);
  let s = special ? `<rect class="cube-ring" x="${x - 3}" y="${y - 3}" width="${S + 6}" height="${S + 6}" rx="4" fill="none" stroke="#e0b65a" stroke-width="2"/>` : '';
  s += `<image class="cube-top" href="${TREASURE_IMG}" x="${x}" y="${y}" width="${S}" height="${S}"/>`;
  return `<g filter="url(#shadow)">${s}</g>`;
}

/**
 * Эффекты поля из fx.js (анимации 04.11): снятый тайл гаснет, катастрофа трескается, у нового
 * монумента золотая вспышка, кубик сокровища подпрыгивает. age — сколько мс эффект уже идет.
 */
export function fxSVG(list) {
  let s = '';
  for (const f of list) {
    const x = cx(f.pos), y = cy(f.pos), d = ` style="animation-delay:-${f.age}ms"`;
    if (f.kind === 'gone' && f.c >= 0) s += `<use class="fx-gone" href="#tl${f.c}" x="${x + 3}" y="${y + 3}" clip-path="url(#rr)"${d}/>`;
    if (f.kind === 'crack') {
      const crack = `M${x + 12} ${y + 8}l9 13l-6 7l11 10l-4 9l10 6M${x + 21} ${y + 21}l12 -6l9 4M${x + 26} ${y + 38}l-10 8`;
      s += `<g class="fx-crack"${d}><rect x="${x + 3}" y="${y + 3}" width="${C - 6}" height="${C - 6}" rx="5" fill="#120c06" opacity=".55"/>
        <path d="${crack}" fill="none" stroke="#1b1309" stroke-width="3" stroke-linejoin="round"/><path d="${crack}" fill="none" stroke="#ffd9a0" stroke-width="1" stroke-linejoin="round"/></g>`;
    }
    if (f.kind === 'grow') s += `<rect class="fx-flash" x="${x + 2}" y="${y + 2}" width="${2 * C - 4}" height="${2 * C - 4}" rx="10" fill="none" stroke="#ffe08a"${d}/>`;
    if (f.kind === 'cube') {
      const S = TREASURE_SIZE;
      s += `<image class="fx-cube" href="${TREASURE_IMG}" x="${x + (C - S) / 2}" y="${y + (C - S) / 2}" width="${S}" height="${S}"${d}/>`;
    }
  }
  return s;
}

/** Клетка i на экране: { x, y, w, h } в пикселях окна (для перелета тайла из руки). */
export function cellScreen(svg, i) {
  const m = svg?.getScreenCTM?.();
  if (!m) return null;
  const a = new DOMPoint(cx(i) + 3, cy(i) + 3).matrixTransform(m), b = new DOMPoint(cx(i) + C - 3, cy(i) + C - 3).matrixTransform(m);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

// --- статичный слой: рамка, подписи, песок, река, сетка (меняется только с картой и видом поля)
// Вид поля (просьба Дениса 03.11): relief — суша и вода из текстур ChatGPT (`/img/terrain`),
// cells — прежний рисунок фильтрами. Река в обоих видах извилистым руслом через речные клетки
// (river.js, просьба Дениса 04.11), речные клетки подсвечены маской из клеток движка.
const SAND_TILE = 640, WATER_TILE = 420;
let staticKey = null, staticSvg = '';
function staticLayer(river, look = 'relief', monStyle = null) {
  const key = `${look}:${monStyle}:${river.join(',')}`;
  if (key === staticKey) return staticSvg;
  let rects = '';
  for (const i of river) {
    const x = cx(i), y = cy(i), gx = i % W, gy = i / W | 0;
    // у края поля клетки реки вытянуты наружу, чтобы край не скруглялся
    const x0 = gx === 0 ? x - 30 : x - 0.5, y0 = gy === 0 ? y - 30 : y - 0.5;
    const x1 = gx === W - 1 ? x + C + 30 : x + C + 0.5, y1 = gy === H - 1 ? y + C + 30 : y + C + 0.5;
    rects += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fff"/>`;
  }
  const relief = look === 'relief';
  const ground = relief
    ? `<pattern id="sandP" patternUnits="userSpaceOnUse" x="${G}" y="${G}" width="${SAND_TILE}" height="${SAND_TILE}"><image href="/img/terrain/sand.webp" width="${SAND_TILE}" height="${SAND_TILE}"/></pattern>
    <pattern id="waterP" patternUnits="userSpaceOnUse" x="${G}" y="${G}" width="${WATER_TILE}" height="${WATER_TILE}"><image href="/img/terrain/water.webp" width="${WATER_TILE}" height="${WATER_TILE}"/></pattern>`
    : `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/><feColorMatrix type="matrix" values="0 0 0 0 0.32 0 0 0 0 0.22 0 0 0 0 0.10 1.6 0 0 0 -0.62"/></filter>
    <filter id="mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="9"/><feColorMatrix type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.40 0 0 0 0 0.18 1.4 0 0 0 -0.55"/></filter>
    <filter id="ripple" x="0" y="0" width="100%" height="100%"><feTurbulence type="turbulence" baseFrequency="0.012 0.09" numOctaves="2" seed="2"/><feColorMatrix type="matrix" values="0 0 0 0 0.85 0 0 0 0 0.93 0 0 0 0 1 0 0 2.2 0 -0.95"/></filter>
    <linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a8db5"/><stop offset="1" stop-color="#2c6488"/></linearGradient>`;
  let s = `<defs>
    <filter id="goo" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 28 -13"/></filter>
    <filter id="goo2" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 28 -6"/></filter>
    ${ground}
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".55"/></filter>
    <filter id="shadow2" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#000" flood-opacity=".6"/></filter>
    <clipPath id="boardClip"><rect x="${G}" y="${G}" width="${W * C}" height="${H * C}"/></clipPath>
    <clipPath id="rr" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".09"/></clipPath>
    <marker id="trailArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#ffe08a" stroke="#1b1309" stroke-width=".8"/></marker>
    ${monDefs('b')}
    ${[0, 1, 2, 3].map((c) => `<image id="tl${c}" width="${C - 6}" height="${C - 6}" href="${tileImg(c)}" preserveAspectRatio="xMidYMid slice"/>`).join('')}
    <image id="tlcat" width="${C - 6}" height="${C - 6}" href="${catImg}" preserveAspectRatio="xMidYMid slice"/>
    <image id="tlun" width="${C - 6}" height="${C - 6}" href="${uniteImg}" preserveAspectRatio="xMidYMid slice"/>
    ${HEROES.flatMap((h) => [0, 1, 2, 3].map((c) => `<image id="tk_${h}_${c}" width="44" height="44" href="${tokenImg(h, c)}"/>`)).join('')}
    ${isMonImg(monStyle) ? [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([a, b]) => `<image id="mon${a}${b}" width="${2 * C - 6}" height="${2 * C - 6}" href="${monImg(monStyle, a, b)}"/>`).join('') : ''}
    <mask id="riverM" maskUnits="userSpaceOnUse" x="0" y="0" width="${VW}" height="${VH}"><g filter="url(#goo)">${rects}</g></mask>
    <mask id="bankM" maskUnits="userSpaceOnUse" x="0" y="0" width="${VW}" height="${VH}"><g filter="url(#goo2)">${rects}</g></mask>
  </defs>`;
  s += `<rect x="1" y="1" width="${VW - 2}" height="${VH - 2}" rx="8" fill="#14110e" stroke="#4a3b2b"/>`;
  for (let x = 0; x < W; x++) s += `<text x="${G + x * C + C / 2}" y="${G - 7}" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-size="13" fill="#a8987c">${String.fromCharCode(65 + x)}</text>`;
  for (let y = 0; y < H; y++) s += `<text x="${G / 2}" y="${G + y * C + C / 2 + 5}" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-size="13" fill="#a8987c">${y + 1}</text>`;
  const R = `x="${G}" y="${G}" width="${W * C}" height="${H * C}"`;
  // река извилистым руслом (river.js); для незнакомой карты прежняя заливка клеток
  const stream = riverLayer(river, relief, C, G);
  s += relief
    ? `<g clip-path="url(#boardClip)">
    <rect ${R} fill="url(#sandP)"/>
    ${stream ?? `<rect ${R} fill="#5a4220" fill-opacity=".35" mask="url(#bankM)"/>
    <rect ${R} fill="url(#waterP)" mask="url(#riverM)"/>`}
  </g>`
    : `<g clip-path="url(#boardClip)">
    <rect ${R} fill="#d6bd88"/>
    <rect ${R} filter="url(#mottle)" opacity=".55"/>
    <rect ${R} filter="url(#grain)" opacity=".5"/>
    ${stream ?? `<rect ${R} fill="#a88a55" mask="url(#bankM)"/>
    <rect ${R} fill="url(#water)" mask="url(#riverM)"/>
    <g mask="url(#riverM)"><rect ${R} filter="url(#ripple)" opacity=".55"/></g>`}
  </g>`;
  let grid = '';
  for (let x = 1; x < W; x++) grid += `M${G + x * C} ${G}V${G + H * C}`;
  for (let y = 1; y < H; y++) grid += `M${G} ${G + y * C}H${G + W * C}`;
  // на текстуре одинарная линия теряется: темная линия и светлая под ней, как гравировка
  s += relief
    ? `<path d="${grid}" stroke="#3a2810" stroke-opacity=".34" stroke-width="1" fill="none"/><path d="${grid}" transform="translate(1 1)" stroke="#fff6dc" stroke-opacity=".22" stroke-width="1" fill="none"/>`
    : `<path d="${grid}" stroke="#4b3418" stroke-opacity=".2" stroke-width="1" fill="none"/>`;
  s += `<rect ${R} fill="none" stroke="#e0b65a" stroke-opacity=".55" stroke-width="1.5"/>`;
  staticKey = key;
  staticSvg = s;
  return s;
}

/**
 * Тайл объединения (замечание Дениса 29.10, как на BGA): пока идут войны, вместо цветного тайла
 * лежит тайл объединения, цвет не читается и ничьей метки нет; рамка пульсирует.
 */
function uniteMark(x, y) {
  return `<rect class="pulse" x="${x + 1.5}" y="${y + 1.5}" width="${C - 3}" height="${C - 3}" rx="6" fill="none" stroke="#ffe08a" stroke-width="3" pointer-events="none"/>`;
}

/**
 * Нарисовать поле. g — view.game, heroOf(p) — герой игрока движка p.
 * opts: targets (клетки для хода), squares (левые верхние клетки монументов 2x2),
 * crosses (центры чуда), hit (клетки, где щелчок сработает), trail (след хода соперника),
 * conflict { k, kind, myExtra, me }, flash (клетка из журнала),
 * unite (тайл объединения, пока идут войны: не входит ни в одно царство, рисуется тайлом объединения),
 * layers (слои из layers.js, по умолчанию все включены).
 * look — вид поля: relief или cells.
 */
export function renderBoard(svg, g, heroOf, opts = {}, look = 'relief') {
  const b = g.board;
  const L = { ...ALL_ON, ...opts.layers };
  const mon = isMonImg(opts.monument) ? opts.monument : null;
  // статичный слой (песок, река, картинки в defs) ставится один раз на карту: картинки не
  // создаются заново при каждой перерисовке и не мигают
  const key = `${look}:${mon}:${g.river.join(',')}`;
  if (svg.dataset.key !== key) {
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    svg.innerHTML = `<g>${staticLayer(g.river, look, mon)}</g><g class="dyn"></g>`;
    svg.dataset.key = key;
  }
  let s = '';
  const up = opts.unite ?? -1;

  // стороны войны подкрашены (без объединяющего тайла царства распадаются на две части)
  const cf = opts.conflict;
  if (cf && cf.kind === 'war' && up >= 0) {
    const lab = groups(b, up);
    const la = lab[cf.k.attPos], ld = lab[cf.k.defPos];
    for (let i = 0; i < W * H; i++) {
      if (lab[i] === la) s += `<rect x="${cx(i)}" y="${cy(i)}" width="${C}" height="${C}" fill="#ff7a45" fill-opacity=".3"/>`;
      else if (lab[i] === ld) s += `<rect x="${cx(i)}" y="${cy(i)}" width="${C}" height="${C}" fill="#5fb4ff" fill-opacity=".3"/>`;
    }
  }

  // тайл или лидер, которого соперник только что выложил, проявляется и опускается на клетку
  // (просьба Дениса 04.11); перерисовка продолжает анимацию: задержка равна возрасту отметки
  const arriving = landing(opts.trail || []);
  const arrive = (i) => (arriving.has(i) ? ` class="arrive" style="animation-delay:-${arriving.get(i)}ms"` : '');
  let tiles = '';
  for (let i = 0; i < W * H; i++) {
    const t = b.tile[i];
    if (t < 0) continue;
    const x = cx(i) + 3, y = cy(i) + 3;
    if (i === up) tiles += `<use href="#tlun" x="${x}" y="${y}" clip-path="url(#rr)"${arrive(i)}/>`;
    else if (t <= 3) tiles += `<use href="#tl${t}" x="${x}" y="${y}" clip-path="url(#rr)"${arrive(i)}/>`;
    else if (t === CATASTROPHE) tiles += `<use href="#tlcat" x="${x}" y="${y}" clip-path="url(#rr)"/>`;
    else if (t === FACEDOWN) tiles += `<rect x="${x}" y="${y}" width="${C - 6}" height="${C - 6}" rx="5" fill="#857a69" stroke="#5f564a"/>`;
    else tiles += `<rect x="${x}" y="${y}" width="${C - 6}" height="${C - 6}" rx="5" fill="#c9a24d" stroke="#94691f"/>`; // клетка чуда
  }
  s += `<g filter="url(#shadow)">${tiles}</g>`;

  // здания под метками владельца: кому идет тайл, видно и на здании
  for (let i = 0; i < W * H; i++) {
    if (b.building[i] >= 0) s += buildingSVG(b.building[i], cx(i), cy(i), 'b', opts.building);
  }

  // метки владельца: в левом верхнем углу тайла жетон героя, к чьему лидеру идет тайл;
  // полупрозрачный черный жетон — своего лидера нет, тайл идет царю
  const kl = L.owners || L.monuments ? kingdomLeaders(b, up) : null;
  if (L.owners) {
    const own = tileOwners(b, kl);
    let m = '';
    for (let i = 0; i < W * H; i++) {
      const o = own[i];
      if (!o) continue;
      m += `<g transform="translate(${cx(i) + 4},${cy(i) + 4})"${o.king ? ' opacity=".72"' : ''}><circle cx="10" cy="10" r="10" fill="${HEX[o.c]}" stroke="#fff3cf" stroke-width="1.2"/><use href="#tk_${heroOf(o.p) || 'pot'}_${o.c}" transform="translate(1 1) scale(.41)"/></g>`;
    }
    s += `<g filter="url(#shadow)">${m}</g>`;
  }

  for (let i = 0; i < W * H; i++) if (b.treasure[i]) s += treasureSVG(i, g.special.includes(i));
  if (g.wonderPos >= 0) {
    s += `<g filter="url(#shadow2)">${wonderSVG(cx(g.wonderPos), cy(g.wonderPos), C)}</g>`;
  }
  const fx = opts.fx || [];
  const delay = (f) => ` style="animation-delay:-${f.age}ms"`;
  for (const m of g.monuments) {
    if (m.pos < 0) continue;
    const art = mon
      ? `<use href="#mon${m.c1}${m.c2}" x="${cx(m.pos) + 3}" y="${cy(m.pos) + 3}" filter="url(#shadow2)"/>`
      : sealSVG(m.c1, m.c2, cx(m.pos), cy(m.pos), 'b');
    // только что построенный монумент вырастает из клеток (анимации 04.11)
    const grow = fx.find((f) => f.kind === 'grow' && f.pos === m.pos);
    s += grow ? `<g class="fx-grow"${delay(grow)}>${art}</g>` : art;
    // на каждой половине монумента жетон героя, чей лидер этого цвета стоит в том же царстве
    // (он получает очко за монумент в конце своего хода); нет лидера — пусто
    const a = L.monuments && kl.lead.get(kl.lab[m.pos]);
    if (!a) continue;
    for (const [c, ox, oy] of [[m.c1, 33, 35], [m.c2, 87, 85]]) {
      if (a[c] == null) continue;
      const x = cx(m.pos) + ox, y = cy(m.pos) + oy;
      s += `<g filter="url(#shadow)"><circle cx="${x}" cy="${y}" r="12.5" fill="${HEX[c]}" stroke="#fff3cf" stroke-width="1.5"/><use href="#tk_${heroOf(a[c]) || 'pot'}_${c}" transform="translate(${x - 11} ${y - 11}) scale(.5)"/></g>`;
    }
  }

  // контуры царств (групп, где стоит хотя бы один лидер); во время войны тайл объединения отдельно
  const lab = groups(b, up);
  const kingdom = new Set();
  for (let i = 0; i < W * H; i++) if (b.leader[i] >= 0) kingdom.add(lab[i]);
  let edges = '';
  for (let i = 0; i < W * H; i++) {
    const l = lab[i];
    if (l < 0 || !kingdom.has(l)) continue;
    const x = cx(i), y = cy(i), gx = i % W, gy = i / W | 0;
    if (gx === 0 || lab[i - 1] !== l) edges += `M${x} ${y}v${C}`;
    if (gx === W - 1 || lab[i + 1] !== l) edges += `M${x + C} ${y}v${C}`;
    if (gy === 0 || lab[i - W] !== l) edges += `M${x} ${y}h${C}`;
    if (gy === H - 1 || lab[i + W] !== l) edges += `M${x} ${y + C}h${C}`;
  }
  s += `<path d="${edges}" stroke="#fff3cf" stroke-opacity=".8" stroke-width=".8" fill="none" stroke-linecap="round"/>`;

  // в левом верхнем углу лидера его поддержка: тайлы его цвета в царстве (у сторон конфликта
  // вместо нее сила в бою справа)
  const sup = leaderSupport(b, lab);
  for (let i = 0; i < W * H; i++) {
    const v = b.leader[i];
    if (v < 0) continue;
    const p = v >> 2, c = v & 3, x = cx(i) + C / 2, y = cy(i) + C / 2;
    s += `<g${arrive(i)}><g filter="url(#shadow2)"><circle cx="${x}" cy="${y}" r="24.5" fill="${HEX[c]}"/><use href="#tk_${heroOf(p) || 'pot'}_${c}" x="${x - 22}" y="${y - 22}"/></g>
      <circle cx="${x}" cy="${y}" r="23.5" fill="none" stroke="${HEX[c]}" stroke-width="3"/></g>`;
    if (!L.support || (cf && (i === cf.k.attPos || i === cf.k.defPos))) continue;
    s += `<g class="sup" transform="translate(${x - 19},${y - 19})"><circle r="10.5" fill="#1b1713" stroke="${RING[c]}" stroke-width="2"/><text y="4.6" text-anchor="middle" font-size="13" font-weight="700" fill="#fff3cf">${sup[i]}</text></g>`;
  }

  // конфликт: лидеры сторон пульсируют, над ними сила
  if (cf) {
    const k = cf.k;
    const attVal = k.attBoard + (k.attN ?? (cf.me === k.att ? cf.myExtra : 0));
    const defVal = k.defBoard + (cf.me === k.def && k.attN !== null ? cf.myExtra : 0);
    for (const [pos, col, val] of [[k.attPos, '#ff8a5c', attVal], [k.defPos, '#7cc4ff', defVal]]) {
      const x = cx(pos) + C / 2, y = cy(pos) + C / 2;
      s += `<circle class="pulse" cx="${x}" cy="${y}" r="27" fill="none" stroke="${col}" stroke-width="3.5"/>
        <g transform="translate(${x + 18},${y - 22})"><circle r="13" fill="${col}" stroke="#1b1713" stroke-width="2"/><text y="5" text-anchor="middle" font-size="15" font-weight="700" fill="#1b1713">${val}</text></g>`;
    }
  }
  if (up >= 0) s += uniteMark(cx(up), cy(up));
  s += trailSVG(opts.trail || [], L.moves);
  s += fxSVG(fx);

  // в выборе места для здания и сокровища цели мигают ярче (просьба Дениса 04.11), у сокровища
  // еще и светлая рамка вокруг самого кубика
  const blink = opts.blink ? ' blink' : '';
  for (const i of opts.targets || []) {
    s += `<rect class="target${blink}" x="${cx(i) + 5}" y="${cy(i) + 5}" width="${C - 10}" height="${C - 10}" rx="6"/>`;
    if (opts.blink === 'treasure') {
      const S = TREASURE_SIZE + 12;
      s += `<rect class="cube-blink" x="${f1(cx(i) + (C - S) / 2)}" y="${f1(cy(i) + (C - S) / 2)}" width="${S}" height="${S}" rx="5"/>`;
    }
  }
  for (const i of opts.squares || []) s += `<rect class="target sq" x="${cx(i) + 4}" y="${cy(i) + 4}" width="${2 * C - 8}" height="${2 * C - 8}" rx="8"/>`;
  for (const i of opts.crosses || []) s += `<rect class="target" x="${cx(i) + 5}" y="${cy(i) + 5}" width="${C - 10}" height="${C - 10}" rx="22"/>`;
  for (const i of opts.lesson || []) s += `<rect class="lessoncell" x="${cx(i) + 2}" y="${cy(i) + 2}" width="${C - 4}" height="${C - 4}" rx="6"/>`;
  if (opts.flash != null) s += `<rect class="flash" x="${cx(opts.flash)}" y="${cy(opts.flash)}" width="${C}" height="${C}" rx="4"/>`;
  for (let i = 0; i < W * H; i++) s += `<rect class="cell-hit${opts.hit?.has(i) ? ' on' : ''}" data-i="${i}" x="${cx(i)}" y="${cy(i)}" width="${C}" height="${C}"><title>${cellName(i)}</title></rect>`;

  svg.querySelector('.dyn').innerHTML = s;
}
