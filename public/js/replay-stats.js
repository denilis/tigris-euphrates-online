// Аналитика просмотра партии (просьба Дениса 05.11): справа от поля, под очками. Рост очков по цветам
// у каждого игрока (график на всю партию, будущее бледно, метка на текущем кадре; наведение
// показывает значения, щелчок переходит на кадр), бои с начала партии и монументы под контролем
// на этот момент. Считают чистые функции replay-core.js.
import { HEX, COLNAME, SCORE_ORDER, esc, finalScore, roundOf, turnLabel } from './util.js';
import { battlesAt, monumentHolds, wonderHolder } from './replay-core.js';

// линии на пергаменте: игровые цвета, синий и зеленый чуть разведены, иначе на графике сливаются
// (проверка палитры 05.11: на темной карточке игровые цвета не читаются, на пергаменте читаются)
const LINE = ['#b8432f', '#2b62c0', '#4f8a2b', '#1f1f1f'];
const TOTAL = '#8a6a3c'; // итог по слабейшему цвету, пунктир
const INK = '#3b2d1f', MUTED = '#8a7556', GRID = '#d9c9a3';
const COLPL = ['красные', 'синие', 'зеленые', 'черные'];

const VW = 300, VH = 112, X0 = 20, X1 = 262, Y0 = 8, Y1 = 92;

const sq = (c, title = COLNAME[c]) => `<i class="csq" style="background:${HEX[c]}" title="${title}"></i>`;

/** Разложить подписи по высоте без наложений: [{ y }] → y с шагом не меньше gap внутри [lo, hi]. */
function spread(items, gap, lo, hi) {
  const s = [...items].sort((a, b) => a.y - b.y);
  for (let i = 0; i < s.length; i++) s[i].y = Math.max(s[i].y, i ? s[i - 1].y + gap : lo);
  for (let i = s.length - 1; i >= 0; i--) s[i].y = Math.min(s[i].y, i < s.length - 1 ? s[i + 1].y - gap : hi);
  return items;
}

/**
 * Подключить аналитику к узлу el. boards — кадры framesBoards, name(место) — имя, go(k) — перейти
 * на кадр. Возвращает draw(k) для перерисовки на кадре k.
 */
export function mountStats(el, data, boards, { name, go }) {
  const N = data.frames.length, np = data.order.length;
  const sc = (j, p) => boards[j].scores[p]; // [к, с, з, ч, сокровища] игрока движка p
  const total = (j, p) => { const [r, b, g, k, t] = sc(j, p); return finalScore([r, b, g, k], t); };
  // шкала общая у всех игроков и на всю партию, чтобы графики сравнивались и не прыгали
  let M = 10;
  for (const b of boards) for (const v of b.scores) M = Math.max(M, v[0], v[1], v[2], v[3]);
  M = Math.ceil(M / 10) * 10;
  const X = (j) => X0 + (N ? (j * (X1 - X0)) / N : 0);
  const Y = (v) => Y1 - (v * (Y1 - Y0)) / M;
  const ticks = [];
  // подписи шкалы по кругам (Денис 12.11): начало каждого третьего круга
  data.frames.forEach((f, j) => {
    const r = roundOf(f.turn, np);
    if (f.action === 1 && r.k === 1 && r.round % 3 === 0) ticks.push([j + 1, `к${r.round}`]);
  });
  const frameName = (j) => {
    const f = j ? data.frames[j - 1] : null;
    if (!f) return 'Начало партии';
    const t = turnLabel(f.turn, np);
    return `${t[0].toUpperCase()}${t.slice(1)}, действие ${f.action}`;
  };
  let k = 0;

  const line = (vals, a, b, attrs) => (b > a ? `<polyline points="${vals.slice(a, b + 1).map((v, i) => `${X(a + i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" ${attrs}/>` : '');

  function chart(p) {
    const all = boards.map((_, j) => j);
    let s = '';
    for (const v of [0, M / 2, M]) {
      s += `<line x1="${X0}" x2="${X1}" y1="${Y(v)}" y2="${Y(v)}" stroke="${GRID}" stroke-width="1"/>`;
      s += `<text x="${X0 - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="${MUTED}">${v}</text>`;
    }
    for (const [j, t] of ticks) s += `<text x="${X(j)}" y="${VH - 4}" text-anchor="middle" font-size="9" fill="${MUTED}">${t}</text>`;
    // сначала бледное будущее, поверх прошлое; черный снизу, красный сверху, как в порядке очков
    const tot = all.map((j) => total(j, p));
    const series = [...SCORE_ORDER].reverse().map((c) => [c, all.map((j) => sc(j, p)[c])]);
    for (const [c, vals] of series) s += line(vals, k, N, `stroke="${LINE[c]}" stroke-width="2" stroke-opacity=".22" stroke-linejoin="round"`);
    s += line(tot, k, N, `stroke="${TOTAL}" stroke-width="1.5" stroke-dasharray="3 3" stroke-opacity=".35"`);
    for (const [c, vals] of series) s += line(vals, 0, k, `stroke="${LINE[c]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`);
    s += line(tot, 0, k, `stroke="${TOTAL}" stroke-width="1.5" stroke-dasharray="3 3"`);
    // метка кадра и точки значений с кольцом цвета фона
    s += `<line x1="${X(k)}" x2="${X(k)}" y1="${Y0 - 4}" y2="${Y1}" stroke="#9a6b2f" stroke-width="1.2"/>`;
    for (const [c, vals] of series) s += `<circle cx="${X(k)}" cy="${Y(vals[k])}" r="3.2" fill="${LINE[c]}" stroke="#efe3c4" stroke-width="1.5"/>`;
    // подписи значений справа: цветной квадрат и число чернилами
    const labs = spread([...SCORE_ORDER.map((c) => ({ c, v: sc(k, p)[c], y: Y(sc(k, p)[c]) })), { c: -1, v: tot[k], y: Y(tot[k]) }], 10, Y0 + 2, Y1 + 4);
    for (const l of labs) {
      const mark = l.c < 0
        ? `<line x1="${X1 + 6}" x2="${X1 + 14}" y1="${l.y - 3}" y2="${l.y - 3}" stroke="${TOTAL}" stroke-width="1.6" stroke-dasharray="2 2"/>`
        : `<rect x="${X1 + 7}" y="${l.y - 7}" width="7" height="7" rx="1.5" fill="${LINE[l.c]}"/>`;
      s += `${mark}<text x="${X1 + 18}" y="${l.y}" font-size="9.5" fill="${INK}"${l.c < 0 ? ' font-style="italic"' : ''}>${l.v}</text>`;
    }
    s += `<line class="hov" x1="0" x2="0" y1="${Y0 - 4}" y2="${Y1}" stroke="${INK}" stroke-width="1" stroke-dasharray="2 2" visibility="hidden"/>`;
    const [, , , , tr] = sc(k, p);
    return `<div class="rchart" data-p="${p}"><div class="rch"><b>${esc(name(data.order[p]))}</b><span>итог <b>${tot[k]}</b>${tr ? `, сокровищ ${tr}` : ''}</span></div>
      <svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Рост очков по цветам: ${esc(name(data.order[p]))}">${s}</svg><div class="rtip" hidden></div></div>`;
  }

  function battles() {
    const st = battlesAt(data.frames, k, data.order);
    // в ячейке выиграно / проиграно и строкой ниже по ролям; боев не было — просто 0
    const cell = (wa, wd, la, ld) => (wa + wd + la + ld
      ? `<td><b>${wa + wd}</b> / ${la + ld}<small>атака ${wa}/${la}, защита ${wd}/${ld}</small></td>`
      : '<td class="z">0</td>');
    let revolts = 0, wars = 0;
    const rows = data.order.map((id) => {
      const s = st[id];
      revolts += s.revoltWinAtt + s.revoltWinDef;
      wars += s.warWinAtt + s.warWinDef;
      return `<tr><td>${esc(name(id))}</td>
        ${cell(s.revoltWinAtt, s.revoltWinDef, s.revoltLoseAtt, s.revoltLoseDef)}
        ${cell(s.warWinAtt, s.warWinDef, s.warLoseAtt, s.warLoseDef)}
        ${s.ptsRevolt + s.ptsWar ? `<td>+${s.ptsRevolt + s.ptsWar}</td>` : '<td class="z">0</td>'}</tr>`;
    }).join('');
    return `<h3>Бои с начала партии</h3>
      <p class="rnote">Восстаний ${revolts}, войн ${wars}. В ячейке выиграно / проиграно.</p>
      <table class="rtab"><thead><tr><th></th><th>Восстания<small>внутри царства</small></th><th>Войны<small>между царствами</small></th><th>Очки<small>за бои</small></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function monuments() {
    const b = boards[k];
    const { own, list } = monumentHolds(b.board, data.monDefs.map((m, j) => ({ ...m, pos: b.mons[j] })), np);
    const wh = wonderHolder(b.board, b.wonder);
    const head = `<h3>Монументы под контролем</h3>`;
    if (!list.length) return `${head}<p class="rnote">Монументов на поле пока нет.</p>`;
    const free = list.reduce((n, m) => n + (m.h1 == null) + (m.h2 == null), 0);
    const rows = data.order.map((id, p) => {
      const sum = own[p].reduce((a, v) => a + v, 0);
      return `<tr><td>${esc(name(id))}</td>${SCORE_ORDER.map((c) => `<td${own[p][c] ? '' : ' class="z"'}>${own[p][c]}</td>`).join('')}<td><b>${sum}</b></td></tr>`;
    }).join('');
    const icons = list.map((m) => {
      const half = (c, h) => `<span style="background:${HEX[c]}" class="${h == null ? 'off' : ''}" title="${COLNAME[c]}: ${h == null ? 'ничья' : esc(name(data.order[h]))}"></span>`;
      return `<i class="rmon">${half(m.c1, m.h1)}${half(m.c2, m.h2)}</i>`;
    }).join('');
    return `${head}
      <table class="rtab"><thead><tr><th></th>${SCORE_ORDER.map((c) => `<th>${sq(c)}<small>${COLPL[c]}</small></th>`).join('')}<th>Всего<small>очков за ход</small></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="rnote"><span class="rmons">${icons}</span> На поле ${list.length} из ${data.monDefs.length}${free ? `, ничьих половин ${free}` : ''}.${wh !== undefined ? ` Очко за чудо: ${wh == null ? 'никому, царя рядом нет' : esc(name(data.order[wh]))}.` : ''}</p>`;
  }

  el.innerHTML = `<h3>Рост очков по ходам</h3>
    <div class="rleg2">${SCORE_ORDER.map((c) => `<span><i style="background:${LINE[c]}"${c === 3 ? ' class="k"' : ''}></i>${COLPL[c]}</span>`).join('')}<span><i class="dash"></i>итог по слабому цвету</span></div>
    <div class="rcharts" id="rCharts"></div><div id="rBat"></div><div id="rMon"></div>`;
  const $ = (id) => el.querySelector('#' + id);

  // наведение: пунктир и подсказка со значениями на том кадре; щелчок — перейти на него
  const frameAt = (svg, e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) * VW) / r.width;
    return Math.max(0, Math.min(N, Math.round(((x - X0) * N) / (X1 - X0))));
  };
  const hide = (box) => { box.querySelector('.rtip').hidden = true; box.querySelector('.hov')?.setAttribute('visibility', 'hidden'); };
  $('rCharts').addEventListener('pointermove', (e) => {
    const box = e.target.closest('.rchart'), svg = box?.querySelector('svg');
    if (!svg) return;
    const j = frameAt(svg, e), p = +box.dataset.p, v = sc(j, p);
    const hov = svg.querySelector('.hov');
    hov.setAttribute('x1', X(j)); hov.setAttribute('x2', X(j)); hov.setAttribute('visibility', 'visible');
    const tip = box.querySelector('.rtip');
    tip.innerHTML = `<div>${frameName(j)}</div>${SCORE_ORDER.map((c) => `${sq(c)}${v[c]}`).join(' ')} <span class="muted">итог ${total(j, p)}</span>`;
    tip.hidden = false;
    const r = box.getBoundingClientRect(), x = e.clientX - r.left;
    tip.style.left = `${Math.min(Math.max(4, x - tip.offsetWidth / 2), r.width - tip.offsetWidth - 4)}px`;
  });
  $('rCharts').addEventListener('pointerleave', () => el.querySelectorAll('.rchart').forEach(hide), true);
  $('rCharts').addEventListener('click', (e) => {
    const svg = e.target.closest('.rchart svg');
    if (svg) go(frameAt(svg, e));
  });

  return (to) => {
    k = to;
    $('rCharts').innerHTML = data.order.map((_, p) => chart(p)).join('');
    $('rBat').innerHTML = battles();
    $('rMon').innerHTML = monuments();
  };
}
