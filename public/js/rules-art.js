// Рисунки к правилам: участки из rules-scenes.js теми же тайлами и жетонами, что на поле.
// 06.11 (просьба Дениса): земля как на поле с рельефом, песок и вода текстурами, на целых
// картах река извилистым руслом (river.js), монумент картинкой, как на сайте по умолчанию.
import { HEX, tileImg, catImg, uniteImg, tokenImg } from './util.js';
import { monDefs, monImg, buildingSVG, wonderSVG } from './board.js';
import { riverLayer } from './river.js';
import { SCENES, FIGURES, parseScene, cellAt } from './rules-scenes.js';

const C = 60, T = C - 6;
const HERO = { 1: 'lion', 2: 'bull' };
const MON_STYLE = 'enamel'; // вид монумента у столов без своей настройки (game.js monOf)
const SAND = 640, WATER = 420; // размер текстур, как на поле

// id внутри рисунка: на странице правил несколько SVG, у каждого своя маска реки
const scoped = (svg, k, ids) => svg.replace(new RegExp(`(id="|url\\(#)(${ids.join('|')})(["\\)])`, 'g'), `$1$2-${k}$3`);

/** Земля участка: песок, речные клетки чуть зеленее, вода руслом (целая карта) или по клеткам. */
function ground(p, k) {
  const vw = p.w * C, vh = p.h * C, river = [];
  let rects = '';
  p.cells.forEach((row, y) => row.forEach((c, x) => {
    if (!c.river) return;
    river.push(y * p.w + x);
    // у края участка вода уходит за край, чтобы край не скруглялся
    const x0 = x === 0 ? -30 : x * C - 0.5, y0 = y === 0 ? -30 : y * C - 0.5;
    const x1 = x === p.w - 1 ? vw + 30 : (x + 1) * C + 0.5, y1 = y === p.h - 1 ? vh + 30 : (y + 1) * C + 0.5;
    rects += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fff"/>`;
  }));
  const R = `width="${vw}" height="${vh}"`;
  const defs = `<pattern id="sandP" patternUnits="userSpaceOnUse" width="${SAND}" height="${SAND}"><image href="/img/terrain/sand.webp" width="${SAND}" height="${SAND}"/></pattern>
    <pattern id="waterP" patternUnits="userSpaceOnUse" width="${WATER}" height="${WATER}"><image href="/img/terrain/water.webp" width="${WATER}" height="${WATER}"/></pattern>
    <filter id="goo" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 28 -13"/></filter>
    <filter id="goo2" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 28 -6"/></filter>
    <mask id="riverM" maskUnits="userSpaceOnUse" x="-40" y="-40" width="${vw + 80}" height="${vh + 80}"><g filter="url(#goo)">${rects}</g></mask>
    <mask id="bankM" maskUnits="userSpaceOnUse" x="-40" y="-40" width="${vw + 80}" height="${vh + 80}"><g filter="url(#goo2)">${rects}</g></mask>
    <clipPath id="land"><rect ${R}/></clipPath>`;
  // целая карта поля: то же русло, что в партии; на малом участке вода по речным клеткам
  const stream = p.w === 16 && p.h === 11 ? riverLayer(river, true, C, 0) : null;
  const water = stream ?? (river.length ? `<rect ${R} fill="#5a4220" fill-opacity=".35" mask="url(#bankM)"/><rect ${R} fill="url(#waterP)" mask="url(#riverM)"/>` : '');
  let grid = '';
  for (let x = 1; x < p.w; x++) grid += `M${x * C} 0V${vh}`;
  for (let y = 1; y < p.h; y++) grid += `M0 ${y * C}H${vw}`;
  // сетка гравировкой, как на поле с рельефом: темная линия и светлая под ней
  const art = `<g clip-path="url(#land)"><rect ${R} fill="url(#sandP)"/>${water}</g>
    <path d="${grid}" stroke="#3a2810" stroke-opacity=".34" stroke-width="1" fill="none"/><path d="${grid}" transform="translate(1 1)" stroke="#fff6dc" stroke-opacity=".22" stroke-width="1" fill="none"/>`;
  const ids = ['sandP', 'waterP', 'goo', 'goo2', 'riverM', 'bankM', 'land', 'bankBlur', 'deep'];
  return { defs: scoped(defs, k, ids), art: scoped(art, k, ids) };
}

const tile = (href, x, y) => `<image href="${href}" x="${x + 3}" y="${y + 3}" width="${T}" height="${T}" preserveAspectRatio="xMidYMid slice" clip-path="url(#rr)"/>`;

function leader({ c, owner }, x, y) {
  const cx = x + C / 2, cy = y + C / 2;
  return `<circle cx="${cx}" cy="${cy}" r="24.5" fill="${HEX[c]}"/><image href="${tokenImg(HERO[owner], c)}" x="${cx - 22}" y="${cy - 22}" width="44" height="44"/>`
    + `<circle cx="${cx}" cy="${cy}" r="23.5" fill="none" stroke="${HEX[c]}" stroke-width="3"/>`;
}

function treasure(x, y) {
  const cx = x + C - 15, cy = y + 15;
  return `<circle cx="${cx}" cy="${cy}" r="9.5" fill="url(#rgold)" stroke="#6b4a12" stroke-width="1.2"/><path d="M${cx} ${cy - 5}l4 5-4 5-4-5z" fill="#fff6d0" fill-opacity=".75"/>`;
}

function mark(m, x, y) {
  if (!m) return '';
  const cx = x + C / 2, cy = y + C / 2;
  if (m === 'new') return `<rect x="${x + 1.5}" y="${y + 1.5}" width="${C - 3}" height="${C - 3}" rx="6" fill="none" stroke="#ffe08a" stroke-width="3"/>`;
  if (m === 'ok') return `<circle cx="${cx}" cy="${cy}" r="15" fill="#2f7a3e" stroke="#fff3cf" stroke-width="2"/><path d="M${cx - 7} ${cy + 1}l5 5 9-11" fill="none" stroke="#fff3cf" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (m === 'no') return `<circle cx="${cx}" cy="${cy}" r="15" fill="#a93226" stroke="#fff3cf" stroke-width="2"/><path d="M${cx - 6} ${cy - 6}l12 12m0-12l-12 12" fill="none" stroke="#fff3cf" stroke-width="3.5" stroke-linecap="round"/>`;
  return `<g transform="translate(${x + 15},${y + 15})"><circle r="12" fill="#1b1713" stroke="#ffe08a" stroke-width="2"/><text y="5.5" text-anchor="middle" font-size="16" font-weight="700" fill="#fff3cf">${m}</text></g>`;
}

/** Контуры групп: царство сплошной линией, регион без лидера пунктиром. Катастрофа и тайл объединения группы разрывают. */
function outlines({ w, h, cells }) {
  const filled = (x, y) => {
    const c = cells[y]?.[x];
    return Boolean(c && !c.cat && !c.unite && (c.tile !== null || c.leader || c.flipped || c.wonder));
  };
  const lab = cells.map((r) => r.map(() => -1));
  const crown = [];
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y) || lab[y][x] >= 0) continue;
      const stack = [[x, y]];
      lab[y][x] = n;
      crown[n] = false;
      while (stack.length) {
        const [a, b] = stack.pop();
        if (cells[b][a].leader) crown[n] = true;
        for (const [p, q] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]]) {
          if (filled(p, q) && lab[q][p] < 0) { lab[q][p] = n; stack.push([p, q]); }
        }
      }
      n++;
    }
  }
  const paths = [[], []];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = lab[y][x];
      if (l < 0) continue;
      const out = paths[crown[l] ? 0 : 1], px = x * C, py = y * C;
      if (lab[y][x - 1] !== l) out.push(`M${px} ${py}v${C}`);
      if (lab[y][x + 1] !== l) out.push(`M${px + C} ${py}v${C}`);
      if (lab[y - 1]?.[x] !== l) out.push(`M${px} ${py}h${C}`);
      if (lab[y + 1]?.[x] !== l) out.push(`M${px} ${py + C}h${C}`);
    }
  }
  return `<path d="${paths[0].join('')}" stroke="#fff3cf" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
    + `<path d="${paths[1].join('')}" stroke="#fff3cf" stroke-opacity=".8" stroke-width="2" stroke-dasharray="6 6" fill="none"/>`;
}

function sceneSVG(key, label) {
  const scene = SCENES[key], p = parseScene(scene);
  const vw = p.w * C, vh = p.h * C, id = `rf${key}`;
  const land = ground(p, key);
  let pieces = '', marks = '';
  p.cells.forEach((row, y) => row.forEach((c, gx) => {
    const x = gx * C, py = y * C;
    if (c.tile !== null) pieces += tile(tileImg(c.tile, 'classic'), x, py); // правила с прежними тайлами (04.11)
    else if (c.cat) pieces += tile(catImg, x, py);
    else if (c.unite) pieces += tile(uniteImg, x, py);
    else if (c.flipped) pieces += `<rect x="${x + 3}" y="${py + 3}" width="${T}" height="${T}" rx="5" fill="#857a69" stroke="#5f564a"/>`;
    else if (c.wonder) pieces += `<rect x="${x + 3}" y="${py + 3}" width="${T}" height="${T}" rx="5" fill="#c9a24d" stroke="#94691f"/>`;
    if (c.building) pieces += buildingSVG(c.tile, x, py, id);
    if (c.leader) pieces += leader(c.leader, x, py);
    if (c.treasure) pieces += treasure(x, py);
    marks += mark(c.mark, x, py);
  }));
  if (scene.mon) {
    const { x, y } = cellAt(scene.mon.at);
    const [a, b] = [scene.mon.c1, scene.mon.c2].sort((m, n) => m - n);
    pieces += `<image href="${monImg(MON_STYLE, a, b)}" x="${x * C + 3}" y="${y * C + 3}" width="${2 * C - 6}" height="${2 * C - 6}" filter="url(#sh-${key})"/>`;
  }
  if (scene.wonder) {
    const { x, y } = cellAt(scene.wonder);
    pieces += wonderSVG(x * C, y * C, C);
  }
  return `<svg viewBox="-2 -2 ${vw + 4} ${vh + 4}" style="--n:${p.w}" role="img" aria-label="${label}">
    <defs>${monDefs(id)}<clipPath id="rr" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".09"/></clipPath>
      <radialGradient id="rgold" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff2b8"/><stop offset=".45" stop-color="#e8b84a"/><stop offset="1" stop-color="#8a5f17"/></radialGradient>
      <filter id="sh-${key}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#000" flood-opacity=".6"/></filter>
      ${land.defs}</defs>
    <rect width="${vw}" height="${vh}" fill="#d6bd88"/>${land.art}
    <rect width="${vw}" height="${vh}" fill="none" stroke="#e0b65a" stroke-opacity=".6" stroke-width="2"/>
    ${pieces}${scene.size ? '' : outlines(p)}${marks}
  </svg>`;
}

/** Рисунок правил: участки в ряд, между «было» и «стало» стрелка; две карты поля просто рядом. */
export function figureHTML(name, caption) {
  const keys = FIGURES[name];
  const joint = name === 'boards' ? '' : '<span class="rarrow" aria-hidden="true"></span>';
  const art = keys.map((k) => sceneSVG(k, caption.replace(/<[^>]*>/g, '').replace(/"/g, ''))).join(joint);
  return `<figure class="rfig${keys.length > 1 ? ' two' : ''}"><div class="rpanels">${art}</div><figcaption>${caption}</figcaption></figure>`;
}
