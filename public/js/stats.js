// Страница «Статистика»: свой зачет у каждого турнира, по образцу Сверка_Тигрис.html. Партии отдает
// сервер после входа, поэтому в открытой части сайта их нет. Фильтр дат пересчитывает всю страницу.
import { api, session } from './api.js';
import { esc, toast } from './util.js';
import { totals, cumulative, inRange, ranking } from './season.js';

const COLS = ['#e0b65a', '#c98a56', '#8fb0c7', '#9dbb86']; // в порядке участников турнира
const SEG = ['#e0b65a', '#b8903e', '#7a6a4f', '#4a3b2b', '#352a1e']; // первое, ничья, второе, третье, четвертое
const SEGTXT = ['#1b1713', '#1b1713', '#efe4cf', '#efe4cf', '#efe4cf'];
const SLOTS = ['1-е', 'ничья', '2-е', '3-е', '4-е'];
const RANK = ['I', 'II', 'III', 'IV'];
const MUTED = '#a8987c';
const TOUR_KEY = 'tigris.tour'; // какой турнир смотрели последним

const shortDate = (iso) => iso.slice(8) + '.' + iso.slice(5, 7) + '.' + iso.slice(2, 4);

function lastTour() {
  try { return localStorage.getItem(TOUR_KEY); } catch { return null; }
}
function rememberTour(id) {
  try { localStorage.setItem(TOUR_KEY, id); } catch { /* приватный режим: живем без памяти */ }
}

function podium(players, t) {
  return ranking(t).map((i, r) => `<div class="pl" style="--tone:${COLS[i]}">
    <div class="rank">${RANK[r]} место</div>
    <div class="who">${esc(players[i])}</div>
    <div class="score">${t.pts[i]}</div>
    <div class="places">${t.places[i].map((count, k) => `<div><b>${count}</b><span>${SLOTS[k]}</span></div>`).join('')}</div>
  </div>`).join('');
}

/** Накопленные очки, 660 на 320. */
function lineChart(games, size) {
  if (!games.length) return `<text x="330" y="160" text-anchor="middle" fill="${MUTED}" font-size="14">Нет партий за этот период</text>`;
  const cum = cumulative(games, size), n = games.length;
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
  for (let p = 0; p < size; p++) {
    s += `<polyline points="${cum.map((c, i) => `${X(i)},${Y(c[p])}`).join(' ')}" fill="none" stroke="${COLS[p]}" stroke-width="${p === 0 ? 2.4 : 1.8}" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<circle cx="${X(n)}" cy="${Y(cum[n][p])}" r="3.4" fill="${COLS[p]}"/>`;
    s += `<text x="${X(n) + 9}" y="${Y(cum[n][p]) + 4}" fill="${COLS[p]}" font-size="13">${cum[n][p]}</text>`;
  }
  return s;
}

/** Распределение мест: у каждого игрока полоса, ширина сегмента по числу партий. */
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
    <div class="tourbar">
      <label>Турнир <select id="sTour"></select></label>
      <button class="btn sm" id="sNew" type="button">Новый турнир</button>
    </div>
    <form class="tform" id="tForm" hidden>
      <label>Название <input id="tName" maxlength="40" placeholder="Например, Кубок осени" autocomplete="off"></label>
      <div class="tpeople" id="tPeople" aria-label="Участники"></div>
      <div class="tacts"><button class="btn primary" type="submit" id="tSend">Создать</button><button class="btn" type="button" id="tCancel">Отмена</button><span class="err" id="tErr" role="alert"></span></div>
      <p class="muted small">От 2 до 4 участников. Партии считаются с момента создания турнира: партия пойдет в него сама, если за столом сядут именно эти люди, бот не считается.</p>
    </form>
    <div class="podium" id="sPodium"><p class="muted">Загружаю...</p></div>
    <div class="dates">
      <label>с <input type="date" id="sFrom"></label>
      <label>по <input type="date" id="sTo"></label>
      <button class="btn sm" id="sReset" type="button">Весь турнир</button>
      <span class="muted" id="sCount"></span>
    </div>
    <div class="charts">
      <section class="panel"><h2>Накопленные очки</h2>
        <svg id="sLine" viewBox="0 0 660 320" role="img" aria-label="График накопленных очков"></svg>
        <div class="legend" id="sLegend"></div></section>
      <section class="panel"><h2>Распределение мест</h2>
        <svg id="sBars" viewBox="0 0 420 288" role="img" aria-label="Распределение мест"></svg>
        <div class="legend" id="sSlots"></div></section>
    </div>
    <h2>Партии</h2>
    <div class="tw"><table class="games">
      <thead><tr><th>Дата</th><th id="sHead"></th><th>Места</th><th>Очки зачета</th><th>Стол</th></tr></thead>
      <tbody id="sRows"></tbody>
    </table></div>
  </main></div>`;
  bindTop();

  const $ = (id) => app.querySelector('#' + id);
  let info;
  try {
    info = await api('GET', 'tournaments');
  } catch (e) {
    toast(e.message);
    return;
  }
  if (!$('sLine')) return; // пока ждали ответ, ушли на другую страницу
  const from = $('sFrom'), to = $('sTo'), pick = $('sTour');
  let players = [], games = [], first = '', last = '', asked = 0;

  const update = () => {
    const list = inRange(games, from.value, to.value);
    const t = totals(list, players.length);
    $('sPodium').innerHTML = podium(players, t);
    $('sCount').textContent = `Партий: ${list.length}`;
    $('sLine').innerHTML = lineChart(list, players.length);
    $('sBars').innerHTML = barsChart(players, t, list.length);
    $('sRows').innerHTML = rows(list);
  };

  const show = async (id) => {
    const mine = ++asked;
    let data;
    try {
      data = await api('GET', `stats?tour=${encodeURIComponent(id)}`);
    } catch (e) {
      toast(e.message);
      return;
    }
    if (mine !== asked || !$('sLine')) return; // успели выбрать другой турнир или уйти со страницы
    ({ players, games } = data);
    first = games[0]?.date ?? '';
    last = games[games.length - 1]?.date ?? '';
    from.min = to.min = first;
    from.max = to.max = last;
    from.value = first;
    to.value = last;
    const n = players.length;
    $('sPodium').style.setProperty('--n', n);
    $('sBars').setAttribute('viewBox', `0 0 420 ${n * 82 + 42}`);
    $('sLegend').innerHTML = players.map((p, i) => `<span><i style="background:${COLS[i]}"></i>${esc(p)}</span>`).join('');
    $('sSlots').innerHTML = SLOTS.slice(0, n === 4 ? 5 : 4).map((name, k) => `<span><i style="background:${SEG[k]}"></i>${name}</span>`).join('');
    $('sHead').textContent = `Счет (${players.map((p) => p[0]).join(' | ')})`;
    update();
  };

  const fill = (current) => {
    pick.innerHTML = info.tours.map((t) => `<option value="${esc(t.id)}" ${t.id === current ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  };

  const start = info.tours.some((t) => t.id === lastTour()) ? lastTour() : info.tours[0].id;
  fill(start);
  pick.addEventListener('change', () => {
    rememberTour(pick.value);
    show(pick.value);
  });
  from.addEventListener('input', update);
  to.addEventListener('input', update);
  $('sReset').addEventListener('click', () => {
    from.value = first;
    to.value = last;
    update();
  });

  const me = session.get()?.user?.id;
  $('tPeople').innerHTML = info.people.map((p) => `<label class="chk"><input type="checkbox" value="${esc(p.id)}" ${p.id === me ? 'checked' : ''}> ${esc(p.name)}</label>`).join('');
  $('sNew').addEventListener('click', () => {
    $('tForm').hidden = !$('tForm').hidden;
    if (!$('tForm').hidden) $('tName').focus();
  });
  $('tCancel').addEventListener('click', () => { $('tForm').hidden = true; });
  $('tForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('tErr').textContent = '';
    const ids = [...app.querySelectorAll('#tPeople input:checked')].map((b) => b.value);
    const send = $('tSend');
    send.disabled = true; // двойное нажатие завело бы два одинаковых турнира
    try {
      const t = await api('POST', 'tournaments', { name: $('tName').value, players: ids });
      info.tours.push(t);
      fill(t.id);
      rememberTour(t.id);
      $('tForm').hidden = true;
      $('tName').value = '';
      show(t.id);
    } catch (ex) {
      $('tErr').textContent = ex.message;
    }
    send.disabled = false;
  });
  show(start);
}
