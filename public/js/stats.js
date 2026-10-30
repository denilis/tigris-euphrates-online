// Страница «Статистика»: зачет сезона по образцу Сверка_Тигрис.html. Партии отдает сервер
// после входа, поэтому в открытой части сайта их нет. Фильтр дат пересчитывает всю страницу.
import { api } from './api.js';
import { esc, toast } from './util.js';
import { totals, cumulative, inRange, ranking } from './season.js';

const COLS = ['#e0b65a', '#c98a56', '#8fb0c7']; // Денис, Влад, Андрей
const SEG = ['#e0b65a', '#b8903e', '#7a6a4f', '#4a3b2b']; // первое, ничья, второе, третье
const SEGTXT = ['#1b1713', '#1b1713', '#efe4cf', '#efe4cf'];
const SLOTS = ['1-е', 'ничья', '2-е', '3-е'];
const RANK = ['I', 'II', 'III'];
const MUTED = '#a8987c';

const shortDate = (iso) => iso.slice(8) + '.' + iso.slice(5, 7) + '.' + iso.slice(2, 4);

function podium(players, t) {
  return ranking(t).map((i, r) => `<div class="pl" style="--tone:${COLS[i]}">
    <div class="rank">${RANK[r]} место</div>
    <div class="who">${esc(players[i])}</div>
    <div class="score">${t.pts[i]}</div>
    <div class="places">${SLOTS.map((name, k) => `<div><b>${t.places[i][k]}</b><span>${name}</span></div>`).join('')}</div>
  </div>`).join('');
}

/** Накопленные очки, 660 на 320. */
function lineChart(games) {
  if (!games.length) return `<text x="330" y="160" text-anchor="middle" fill="${MUTED}" font-size="14">Нет партий за этот период</text>`;
  const cum = cumulative(games), n = games.length;
  const top = Math.max(...cum[n]);
  const L = 40, R = 620, T = 16, B = 282, maxY = Math.max(Math.ceil(top / 25) * 25, 25), step = maxY > 100 ? 50 : 25;
  const X = (i) => L + (i * (R - L)) / n, Y = (v) => B - (v * (B - T)) / maxY;
  let s = '';
  for (let v = 0; v <= maxY; v += step) {
    s += `<line x1="${L}" y1="${Y(v)}" x2="${R}" y2="${Y(v)}" stroke="#e8dcc4" stroke-opacity="${v === 0 ? '.28' : '.1'}"/>`;
    s += `<text x="${L - 10}" y="${Y(v) + 4}" text-anchor="end" fill="${MUTED}" font-size="11">${v}</text>`;
  }
  for (const m of [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n]) {
    s += `<text x="${X(m)}" y="${B + 20}" text-anchor="middle" fill="${MUTED}" font-size="11">${shortDate(games[Math.max(0, m - 1)].date).slice(0, 5)}</text>`;
  }
  for (let p = 0; p < 3; p++) {
    s += `<polyline points="${cum.map((c, i) => `${X(i)},${Y(c[p])}`).join(' ')}" fill="none" stroke="${COLS[p]}" stroke-width="${p === 0 ? 2.4 : 1.8}" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<circle cx="${X(n)}" cy="${Y(cum[n][p])}" r="3.4" fill="${COLS[p]}"/>`;
    s += `<text x="${X(n) + 9}" y="${Y(cum[n][p]) + 4}" fill="${COLS[p]}" font-size="13">${cum[n][p]}</text>`;
  }
  return s;
}

/** Распределение мест, 420 на 288: у каждого игрока полоса, ширина сегмента по числу партий. */
function barsChart(players, t, total) {
  if (!total) return '';
  const L = 8, R = 412;
  let s = '', y = 30;
  for (const i of ranking(t)) {
    s += `<text x="${L}" y="${y - 10}" fill="${COLS[i]}" font-size="13">${esc(players[i])}</text>`;
    let x = L;
    t.places[i].forEach((count, k) => {
      const w = (count * (R - L)) / total;
      if (w <= 0) return;
      s += `<rect x="${x}" y="${y}" width="${Math.max(w - 1.5, 1)}" height="34" rx="2" fill="${SEG[k]}"/>`;
      if (w > 26) s += `<text x="${x + w / 2 - 0.75}" y="${y + 22}" text-anchor="middle" fill="${SEGTXT[k]}" font-size="13">${count}</text>`;
      x += w;
    });
    y += 82;
  }
  return s;
}

const triple = (arr, place) => arr.map((v, i) => (place[i] === 1 ? `<b>${v}</b>` : String(v))).join(' | ');

function tableLink(g) {
  if (g.source === 'bga') return `<a href="https://boardgamearena.com/table?table=${esc(g.table)}" target="_blank" rel="noopener">BGA ${esc(g.table)}</a>`;
  return `сайт ${esc(g.table)}`;
}

function rows(games) {
  return [...games].reverse().map((g) => `<tr>
    <td>${shortDate(g.date)}</td><td>${triple(g.score, g.place)}</td><td>${triple(g.place, g.place)}</td><td>${triple(g.pts, g.place)}</td><td>${tableLink(g)}</td>
  </tr>`).join('');
}

/** Нарисовать страницу в app. top и bindTop — шапка сайта и привязка ее кнопок. */
export async function renderStats(app, top, bindTop) {
  app.innerHTML = `<div class="page">${top}<main class="pcard stats">
    <h1>Статистика</h1>
    <div class="podium" id="sPodium"><p class="muted">Загружаю...</p></div>
    <div class="dates">
      <label>с <input type="date" id="sFrom"></label>
      <label>по <input type="date" id="sTo"></label>
      <button class="btn sm" id="sReset" type="button">Весь сезон</button>
      <span class="muted" id="sCount"></span>
    </div>
    <div class="charts">
      <section class="panel"><h2>Накопленные очки</h2>
        <svg id="sLine" viewBox="0 0 660 320" role="img" aria-label="График накопленных очков"></svg>
        <div class="legend" id="sLegend"></div></section>
      <section class="panel"><h2>Распределение мест</h2>
        <svg id="sBars" viewBox="0 0 420 288" role="img" aria-label="Распределение мест"></svg>
        <div class="legend">${SLOTS.map((name, k) => `<span><i style="background:${SEG[k]}"></i>${name}</span>`).join('')}</div></section>
    </div>
    <h2>Партии</h2>
    <div class="tw"><table class="games">
      <thead><tr><th>Дата</th><th>Счет (Д | В | А)</th><th>Места</th><th>Очки зачета</th><th>Стол</th></tr></thead>
      <tbody id="sRows"></tbody>
    </table></div>
  </main></div>`;
  bindTop();

  let data;
  try {
    data = await api('GET', 'stats');
  } catch (e) {
    toast(e.message);
    return;
  }
  const $ = (id) => app.querySelector('#' + id);
  if (!$('sLine')) return; // пока ждали ответ, ушли на другую страницу
  const { players, games } = data;
  const first = games[0].date, last = games[games.length - 1].date;
  const from = $('sFrom'), to = $('sTo');
  from.min = to.min = first;
  from.max = to.max = last;
  from.value = first;
  to.value = last;
  $('sLegend').innerHTML = players.map((p, i) => `<span><i style="background:${COLS[i]}"></i>${esc(p)}</span>`).join('');

  const update = () => {
    const list = inRange(games, from.value, to.value);
    const t = totals(list);
    $('sPodium').innerHTML = podium(players, t);
    $('sCount').textContent = `Партий: ${list.length}`;
    $('sLine').innerHTML = lineChart(list);
    $('sBars').innerHTML = barsChart(players, t, list.length);
    $('sRows').innerHTML = rows(list);
  };
  from.addEventListener('input', update);
  to.addEventListener('input', update);
  $('sReset').addEventListener('click', () => {
    from.value = first;
    to.value = last;
    update();
  });
  update();
}
