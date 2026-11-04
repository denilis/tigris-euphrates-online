// Страница «Статистика»: свой зачет у каждого турнира, по образцу Сверка_Тигрис.html. Партии отдает
// сервер после входа, поэтому в открытой части сайта их нет. Фильтр дат пересчитывает всю страницу.
import { api, session } from './api.js';
import { esc, toast, faceBg, HEX, COLNAME, SCORE_ORDER } from './util.js';
import { totals, cumulative, inRange, ranking, slotCount, dashboard, winShare, SOURCES } from './season.js';
import { statsTabs } from './personal.js';

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

function podium(players, t, avatars) {
  return ranking(t).map((i, r) => `<div class="pl" style="--tone:${COLS[i]}">
    <div class="rank">${RANK[r]} место</div>
    <div class="who">${avatars[i] ? `<i class="face big" style="background-image:${faceBg({ avatar: avatars[i] })}"></i>` : ''}${esc(players[i])}</div>
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
  // законченный стол хранится бессрочно: строка ведет на финальное поле партии
  if (g.code) return `<a href="#/t/${esc(g.code)}">сайт ${esc(g.table || g.code)}</a>`;
  return `сайт ${esc(g.table)}`;
}

function rows(games) {
  return [...games].reverse().map((g) => `<tr>
    <td>${shortDate(g.date)}</td><td>${triple(g.score, g.place)}</td><td>${triple(g.place, g.place)}</td><td>${triple(g.pts, g.place)}</td><td>${tableLink(g)}</td>
  </tr>`).join('');
}

// --- подробности турнира (этап 2 пакета 04.11): карточки, бои, цвета, откуда очки, рекорды, награды

const LOST = '#5a4c3c';
const SRC_COL = { tile: '#d6bd88', building: '#a88a55', war: '#c0563c', revolt: '#8a7ac0', monument: '#e0b65a' };
const gameRef = (g) => `${shortDate(g.date)}, ${tableLink(g)}`;
const face = (i, players, avatars) => (avatars[i]
  ? `<i class="face" style="background-image:${faceBg({ avatar: avatars[i] })}"></i>`
  : `<i class="face mono" style="background:${COLS[i]}">${esc(players[i][0] || '?')}</i>`);

function dashCards(players, avatars, d) {
  return d.players.map((p, i) => {
    const w = winShare(p.war), r = winShare(p.revolt);
    const share = (x) => `${x.won} из ${x.fought}${x.pct == null ? '' : ` <small>${x.pct}%</small>`}`;
    return `<div class="dcard" style="--tone:${COLS[i]}">
      <div class="who">${face(i, players, avatars)}${esc(players[i])}</div>
      <dl><dt>Войны</dt><dd>${share(w)}</dd><dt>Восстания</dt><dd>${share(r)}</dd>
      <dt>Монументы</dt><dd>${p.mon}</dd><dt>Катастрофы</dt><dd>${p.cat}</dd><dt>Сокровища</dt><dd>${p.tr}</dd></dl>
    </div>`;
  }).join('');
}

/** Бои: у каждого игрока 4 полосы, выиграно цветом игрока, проиграно серым. */
function fightsChart(players, d) {
  const ROWS = [['войны, атака', 'war', 0], ['войны, защита', 'war', 2], ['восстания, атака', 'revolt', 0], ['восстания, защита', 'revolt', 2]];
  const max = Math.max(1, ...d.players.flatMap((p) => ROWS.map(([, k, j]) => p[k][j] + p[k][j + 1])));
  const L = 118, R = 360;
  let s = '', y = 4;
  d.players.forEach((p, i) => {
    s += `<text x="0" y="${y + 13}" fill="${COLS[i]}" font-size="13">${esc(players[i])}</text>`;
    y += 22;
    for (const [label, k, j] of ROWS) {
      const win = p[k][j], lose = p[k][j + 1], w1 = (win * (R - L)) / max, w2 = (lose * (R - L)) / max;
      s += `<text x="${L - 8}" y="${y + 11}" text-anchor="end" fill="${MUTED}" font-size="11">${label}</text>`;
      if (w1 > 0) s += `<rect x="${L}" y="${y}" width="${Math.max(w1 - 1, 1)}" height="14" rx="2" fill="${COLS[i]}"><title>выиграно ${win}</title></rect>`;
      if (w2 > 0) s += `<rect x="${L + w1}" y="${y}" width="${Math.max(w2, 1)}" height="14" rx="2" fill="${LOST}"><title>проиграно ${lose}</title></rect>`;
      s += `<text x="${L + w1 + w2 + 6}" y="${y + 11}" fill="#e8dcc4" font-size="11">${win} из ${win + lose}</text>`;
      y += 19;
    }
    y += 12;
  });
  return { s, h: y };
}

/** Очки по цветам: группа на цвет (порядок BGA), столбик игрока — среднее за партию, точка — рекорд. */
function colorsChart(players, d) {
  const n = d.players.length, B = 226, T = 14, L = 30, gw = 96, bw = Math.min(20, (gw - 16) / n - 3);
  const max = Math.max(10, ...d.players.flatMap((p) => p.best.map((b) => b?.v || 0)));
  const Y = (v) => B - ((B - T) * v) / max;
  let s = '';
  for (let v = 0; v <= max; v += 10) {
    s += `<line x1="${L}" y1="${Y(v)}" x2="414" y2="${Y(v)}" stroke="#e8dcc4" stroke-opacity="${v ? '.08' : '.25'}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" fill="${MUTED}" font-size="10">${v}</text>`;
  }
  SCORE_ORDER.forEach((c, gi) => {
    const x0 = L + 8 + gi * gw;
    s += `<rect x="${x0}" y="${B + 10}" width="11" height="11" rx="2" fill="${HEX[c]}" stroke="#cfc6b4" stroke-opacity=".6"/><text x="${x0 + 16}" y="${B + 20}" fill="#e8dcc4" font-size="12">${COLNAME[c]}</text>`;
    d.players.forEach((p, i) => {
      if (!p.games) return;
      const avg = p.c[c] / p.games, x = x0 + i * (bw + 3), best = p.best[c];
      s += `<rect x="${x}" y="${Y(avg)}" width="${bw}" height="${B - Y(avg)}" rx="2" fill="${COLS[i]}" opacity=".85"><title>${esc(players[i])}: в среднем ${avg.toFixed(1)} ${COLNAME[c]}</title></rect>`;
      if (best) s += `<circle cx="${x + bw / 2}" cy="${Y(best.v)}" r="3.6" fill="#1b1713" stroke="${COLS[i]}" stroke-width="2"><title>${esc(players[i])}: рекорд ${best.v}, ${shortDate(best.g.date)}</title></circle>`;
    });
  });
  return s;
}

/** Откуда очки: полоса 100% у каждого игрока. */
function sourcesChart(players, d) {
  const L = 110, R = 650;
  let s = '', y = 6;
  d.players.forEach((p, i) => {
    const total = SOURCES.reduce((a, [k]) => a + p.src[k], 0) || 1;
    s += `<text x="0" y="${y + 15}" fill="${COLS[i]}" font-size="13">${esc(players[i])}</text>`;
    let x = L;
    for (const [k, label] of SOURCES) {
      const w = ((R - L) * p.src[k]) / total;
      if (w <= 0) continue;
      const pct = Math.round((100 * p.src[k]) / total);
      s += `<rect x="${x}" y="${y}" width="${Math.max(w - 1, 1)}" height="22" rx="2" fill="${SRC_COL[k]}"><title>${label}: ${p.src[k]} очков, ${pct}%</title></rect>`;
      if (w > 34) s += `<text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" fill="#1b1713" font-size="11">${pct}%</text>`;
      x += w;
    }
    y += 32;
  });
  return { s, h: y };
}

function recordsList(players, d) {
  const who = (r) => `<b style="color:${COLS[r.i]}">${esc(players[r.i])}</b>`;
  const COLPL = ['красных', 'синих', 'зеленых', 'черных'];
  const li = [];
  for (const c of SCORE_ORDER) {
    const r = d.records.colors[c];
    if (r) li.push(`<li><span>Больше всего ${COLPL[c]} очков за партию</span>${who(r)} ${r.v}, ${gameRef(r.g)}</li>`);
  }
  const { score, battle, streak } = d.records;
  if (score) li.push(`<li><span>Лучший итог партии</span>${who(score)} ${score.v}, ${gameRef(score.g)}</li>`);
  if (battle) li.push(`<li><span>Самый сильный бой (поле и рука)</span>${who(battle)} ${battle.v}, ${gameRef(battle.g)}</li>`);
  if (streak) li.push(`<li><span>Самая длинная серия первых мест</span>${who(streak)} ${streak.v} подряд</li>`);
  return li.join('');
}

function awardTiles(players, avatars, d) {
  return d.awards.map((a) => `<div class="award">
    <div class="atitle">${a.title}</div>
    <div class="awho">${a.winners.length ? a.winners.map((i) => `${face(i, players, avatars)}<b style="color:${COLS[i]}">${esc(players[i])}</b>`).join(' ') : '<em>пока никого</em>'}</div>
    <div class="atext">${a.text}${a.winners.length ? `: ${a.value}` : ''}</div>
  </div>`).join('');
}

/** Подробности за выбранный период; без партий с подробностями блок скрыт. */
function drawDash(app, players, avatars, list) {
  const $ = (id) => app.querySelector('#' + id);
  const d = dashboard(list, players.length);
  $('dDash').hidden = !d.count;
  if (!d.count) return;
  const miss = d.total - d.count;
  $('dNote').textContent = `По ${d.count} из ${d.total} партий периода${miss ? `: у ${miss} нет подробностей, в выгрузке BGA нет их логов` : ''}.`;
  $('dCards').style.setProperty('--n', players.length);
  $('dCards').innerHTML = dashCards(players, avatars, d);
  const f = fightsChart(players, d);
  $('dFights').setAttribute('viewBox', `0 0 420 ${f.h}`);
  $('dFights').innerHTML = f.s;
  $('dColors').innerHTML = colorsChart(players, d);
  $('dColorsLegend').innerHTML = players.map((p, i) => `<span><i style="background:${COLS[i]}"></i>${esc(p)}</span>`).join('') + '<span>столбик: среднее за партию, кружок: рекорд</span>';
  const src = sourcesChart(players, d);
  $('dSrc').setAttribute('viewBox', `0 0 660 ${src.h}`);
  $('dSrc').innerHTML = src.s;
  $('dSrcLegend').innerHTML = SOURCES.map(([k, label]) => `<span><i style="background:${SRC_COL[k]};height:10px"></i>${label}</span>`).join('');
  $('dRecords').innerHTML = recordsList(players, d);
  $('dAwards').innerHTML = awardTiles(players, avatars, d);
}

/** Нарисовать страницу в app. top и bindTop — шапка сайта и привязка ее кнопок. */
export async function renderStats(app, top, bindTop) {
  app.innerHTML = `<div class="page">${top}<main class="pcard stats">
    <h1>Статистика</h1>
    ${statsTabs('tour')}
    <div class="tourbar">
      <label>Турнир <select id="sTour"></select></label>
      <button class="btn sm" id="sNew" type="button">Новый турнир</button>
    </div>
    <form class="tform" id="tForm" hidden>
      <label>Название <input id="tName" maxlength="40" placeholder="Например, Кубок осени" autocomplete="off"></label>
      <div class="tpeople" id="tPeople" aria-label="Участники"></div>
      <div class="tacts"><button class="btn primary" type="submit" id="tSend">Создать</button><button class="btn" type="button" id="tCancel">Отмена</button><span class="err" id="tErr" role="alert"></span></div>
      <p class="muted small">От 2 до 4 участников. Партии считаются с момента создания турнира: партия пойдет в него сама, если за столом сядут именно эти люди. Бот в состав не входит, но место занимает: очки по месту среди всех за столом.</p>
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
    <section class="dash" id="dDash" hidden>
      <h2>Подробности партий</h2>
      <p class="muted small" id="dNote"></p>
      <div class="dcards" id="dCards"></div>
      <div class="charts">
        <section class="panel"><h2>Бои</h2>
          <svg id="dFights" viewBox="0 0 420 300" role="img" aria-label="Войны и восстания в атаке и защите"></svg>
          <div class="legend"><span><i style="background:#e0b65a"></i>выиграно (цвет игрока)</span><span><i style="background:#5a4c3c"></i>проиграно</span></div></section>
        <section class="panel"><h2>Очки по цветам</h2>
          <svg id="dColors" viewBox="0 0 420 250" role="img" aria-label="Средние очки по цветам и рекорды"></svg>
          <div class="legend" id="dColorsLegend"></div></section>
      </div>
      <section class="panel dwide"><h2>Откуда очки</h2>
        <svg id="dSrc" viewBox="0 0 660 120" role="img" aria-label="Откуда очки"></svg>
        <div class="legend" id="dSrcLegend"></div></section>
      <section class="panel dwide"><h2>Рекорды</h2><ul class="recs" id="dRecords"></ul></section>
      <section class="panel dwide"><h2>Награды</h2><div class="awards" id="dAwards"></div></section>
    </section>
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
  let players = [], avatars = [], games = [], first = '', last = '', asked = 0;

  const update = () => {
    const list = inRange(games, from.value, to.value);
    const t = totals(list, players.length, slotCount(games, players.length));
    $('sPodium').innerHTML = podium(players, t, avatars);
    $('sCount').textContent = `Партий: ${list.length}`;
    $('sLine').innerHTML = lineChart(list, players.length);
    $('sBars').innerHTML = barsChart(players, t, list.length);
    $('sRows').innerHTML = rows(list);
    drawDash(app, players, avatars, list);
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
    ({ players, avatars, games } = data);
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
    $('sSlots').innerHTML = SLOTS.slice(0, slotCount(games, n)).map((name, k) => `<span><i style="background:${SEG[k]}"></i>${name}</span>`).join('');
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

// общие с вкладкой «Личная» (personal-view.js): карточки, графики, рекорды, ссылки на партии
export { dashCards, fightsChart, colorsChart, recordsList, tableLink, shortDate, COLS, MUTED };
