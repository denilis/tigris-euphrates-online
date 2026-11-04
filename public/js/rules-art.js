// Рисунки к правилам: участки из rules-scenes.js теми же тайлами и жетонами, что на поле.
import { HEX, tileImg, catImg, uniteImg, tokenImg } from './util.js';
import { monDefs, sealSVG, buildingSVG, wonderSVG } from './board.js';
import { SCENES, FIGURES, parseScene, cellAt } from './rules-scenes.js';

const C = 60, T = C - 6;
const HERO = { 1: 'lion', 2: 'bull' };

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
  let ground = '', pieces = '', marks = '';
  p.cells.forEach((row, y) => row.forEach((c, gx) => {
    const x = gx * C, py = y * C;
    if (c.river) ground += `<rect x="${x - 0.5}" y="${py - 0.5}" width="${C + 1}" height="${C + 1}" fill="#3a7aa3"/>`;
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
    pieces += sealSVG(scene.mon.c1, scene.mon.c2, x * C, y * C, id);
  }
  if (scene.wonder) {
    const { x, y } = cellAt(scene.wonder);
    pieces += wonderSVG(x * C, y * C, C);
  }
  let grid = '';
  for (let x = 1; x < p.w; x++) grid += `M${x * C} 0V${vh}`;
  for (let y = 1; y < p.h; y++) grid += `M0 ${y * C}H${vw}`;
  return `<svg viewBox="-2 -2 ${vw + 4} ${vh + 4}" style="--n:${p.w}" role="img" aria-label="${label}">
    <defs>${monDefs(id)}<clipPath id="rr" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".09"/></clipPath>
      <radialGradient id="rgold" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff2b8"/><stop offset=".45" stop-color="#e8b84a"/><stop offset="1" stop-color="#8a5f17"/></radialGradient></defs>
    <rect width="${vw}" height="${vh}" fill="#d6bd88"/>${ground}
    <path d="${grid}" stroke="#4b3418" stroke-opacity=".22" fill="none"/>
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
