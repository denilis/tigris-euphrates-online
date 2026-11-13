// Вкладка «Личная» на странице статистики (схема одобрена Денисом 04.11): все партии одного
// игрока, с людьми, с ботами и на BGA. Расчеты в personal.js, графики боев и цветов общие с
// вкладкой «Турниры».
import { api, session } from './api.js';
import { esc, toast, HEX, COLNAME, SCORE_ORDER } from './util.js';
import { statsTabs, KINDS, pick, summary, byGroup, details, pointSources, weakest, monthly, extraRecords, one, vsRivals, perRival } from './personal.js';
import { dashCards, colorsChart, recordsList, tableLink, shortDate, COLS, MUTED } from './stats.js';

const SRC_COLOR = { tile: '#d6bd88', building: '#a88a55', monument: '#e0b65a', war: '#c0563c', revolt: '#8a7ac0', tr: '#7fb3b8' };
const GROUP_COLS = [['group', 'Вид или турнир'], ['n', 'Партий'], ['wins', 'Побед'], ['pct', '% побед'], ['place', 'Ср. место'], ['score', 'Ср. счет']];
const PICK_KEY = 'tigris.personal.kind'; // какой вид партий смотрели последним

function numsHTML(s) {
  if (!s.n) return '<p class="muted">Партий за этот период нет.</p>';
  const cell = (v, t) => `<div><b>${v}</b><span>${t}</span></div>`;
  return cell(s.n, 'партий') + cell(s.wins, `побед${s.pct == null ? '' : `, ${s.pct}%`}`) + cell(one(s.place), 'среднее место') + cell(one(s.score), 'средний счет');
}

function groupRows(rows, key, dir) {
  const sorted = [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    const c = typeof x === 'string' ? x.localeCompare(y, 'ru') : (x ?? -1) - (y ?? -1);
    return dir * c;
  });
  return sorted.map((r) => `<tr><td>${esc(r.group)}</td><td>${r.n}</td><td>${r.wins}</td><td>${r.pct == null ? '-' : r.pct + '%'}</td><td>${one(r.place)}</td><td>${one(r.score)}</td></tr>`).join('');
}

/** Откуда очки: полоса долей и строки «тайлы: 9,4 за партию, 46%». */
function sourcesHTML(src) {
  const bar = src.filter((x) => x.pct > 0).map((x) => `<i style="flex:${x.sum};background:${SRC_COLOR[x.key]}" title="${x.label}: ${x.pct}%">${x.pct >= 6 ? x.pct + '%' : ''}</i>`).join('');
  const list = src.map((x) => `<li><i style="background:${SRC_COLOR[x.key]}"></i>${x.label}<b>${one(x.perGame)}</b><span>за партию, ${x.pct}%</span></li>`).join('');
  return `<div class="pbar">${bar}</div><ul class="psrc">${list}</ul>`;
}

/** Динамика: столбик на месяц высотой в средний счет, под ним число партий и доля побед. */
function monthsChart(months) {
  if (!months.length) return '';
  const L = 30, R = 650, T = 18, B = 190, max = Math.max(10, ...months.map((m) => m.score || 0));
  const Y = (v) => B - ((B - T) * v) / max, w = (R - L) / months.length, bw = Math.min(46, w - 10);
  let s = '';
  for (let v = 0; v <= max; v += 5) s += `<line x1="${L}" y1="${Y(v)}" x2="${R}" y2="${Y(v)}" stroke="#e8dcc4" stroke-opacity="${v ? '.08' : '.25'}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" fill="${MUTED}" font-size="10">${v}</text>`;
  months.forEach((m, i) => {
    const x = L + i * w + (w - bw) / 2, [y, mo] = m.month.split('-');
    s += `<rect x="${x}" y="${Y(m.score)}" width="${bw}" height="${B - Y(m.score)}" rx="2" fill="${COLS[0]}" opacity=".85"><title>${mo}.${y}: средний счет ${one(m.score)}, партий ${m.n}, побед ${m.pct}%</title></rect>`;
    s += `<text x="${x + bw / 2}" y="${Y(m.score) - 5}" text-anchor="middle" fill="#e8dcc4" font-size="11">${one(m.score)}</text>`;
    s += `<text x="${x + bw / 2}" y="${B + 16}" text-anchor="middle" fill="#e8dcc4" font-size="11">${mo}.${y.slice(2)}</text>`;
    s += `<text x="${x + bw / 2}" y="${B + 31}" text-anchor="middle" fill="${MUTED}" font-size="10">${m.n} | ${m.pct}%</text>`;
  });
  return s;
}

/** Бои одного игрока крупными полосами: выиграно золотом, проиграно серым. */
function fightsHTML(p) {
  const rows = [['Войны в атаке', p.war[0], p.war[1]], ['Войны в защите', p.war[2], p.war[3]], ['Восстания в атаке', p.revolt[0], p.revolt[1]], ['Восстания в защите', p.revolt[2], p.revolt[3]]];
  return rows.map(([t, won, lost]) => {
    const all = won + lost, pct = all ? Math.round((100 * won) / all) : null;
    return `<div class="pfight"><span>${t}</span><b>${won} из ${all}${pct == null ? '' : `, ${pct}%`}</b><div class="pfbar"><i style="flex:${won}"></i><em style="flex:${lost}"></em></div></div>`;
  }).join('');
}

/** Разница «вы минус соперник» строкой и оценкой: up лучше, down хуже, '' без оценки. */
function diffOf(r) {
  if (r.me == null || r.opp == null) return { text: '', cls: '' };
  let d, text;
  if (r.kind === 'pct') {
    d = Math.round(r.me) - Math.round(r.opp);
    text = `${d > 0 ? '+' : ''}${d} п.п.`;
  } else if (r.kind === 'per' && r.opp > 0) {
    d = Math.round((r.me / r.opp - 1) * 100);
    text = `${d > 0 ? '+' : ''}${d}%`;
  } else {
    d = (Math.round(r.me * 10) - Math.round(r.opp * 10)) / 10; // по тем же округленным числам, что видны в таблице
    text = `${d > 0 ? '+' : ''}${one(d)}`;
  }
  return { text, cls: !r.good || !d ? '' : d > 0 ? 'up' : 'down' };
}

/** «Вы и соперники»: за партию против среднего соперника в тех же партиях. */
function vsHTML(vs) {
  const val = (r, v) => (v == null ? '-' : r.kind === 'pct' ? `${Math.round(v)}%` : one(v));
  const rows = vs.rows.filter((r) => r.kind === 'pct' || r.me || r.opp).map((r) => {
    const d = diffOf(r);
    const extra = r.kind === 'pct' && r.fought ? ` <small>(${r.won} из ${r.fought})</small>` : '';
    return `<tr><td>${r.label}</td><td>${val(r, r.me)}${extra}</td><td>${val(r, r.opp)}</td><td class="${d.cls}">${d.text}</td></tr>`;
  }).join('');
  return `<p class="muted small">По ${vs.games} партиям, где есть подробности у вас и у соперников. Средний соперник: все соперники этих партий вместе, за партию на одного. Войны и восстания: доля выигранных боев.</p>
    <table class="pvs"><thead><tr><th></th><th>Вы, за партию</th><th>Средний соперник</th><th>Разница</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** «Против каждого соперника»: больше из пары выделено. */
function rivalsHTML(list) {
  if (!list.length) return '<p class="muted">Соперников за этот период нет.</p>';
  // больше из пары выделяется по видимым, уже округленным числам: при 15,1 / 15,1 выделения нет
  const pair = (a, b, f, r) => {
    if (a == null || b == null) return '-';
    const x = r(a), y = r(b);
    return `${x > y ? `<b>${f(a)}</b>` : f(a)} / ${y > x ? `<b>${f(b)}</b>` : f(b)}`;
  };
  const pct = (v) => `${Math.round(v)}%`, r1 = (v) => Math.round(v * 10);
  const rows = list.map((r) => `<tr>
    <td>${esc(r.name)}</td><td>${r.games}${r.meets > r.games ? ` <small>(${r.meets} встреч)</small>` : ''}</td>
    <td>${r.above > r.below ? `<b>${r.above}</b>` : r.above}</td><td>${r.below > r.above ? `<b>${r.below}</b>` : r.below}</td>
    <td>${pair(r.myScore, r.hisScore, one, r1)}</td><td>${pair(r.myMon, r.hisMon, one, r1)}</td><td>${pair(r.myWar, r.hisWar, pct, Math.round)}</td>
  </tr>`).join('');
  const bots = list.some((r) => r.bot) ? ' У ботов «выше» и «ниже» считаются против каждого бота за столом, их счет средний по всем ботам.' : '';
  return `<div class="tw"><table class="games prv">
    <thead><tr><th>Соперник</th><th>Партий</th><th>Вы выше</th><th>Он выше</th><th>Счет: вы / он</th><th>Монументы за партию: вы / он</th><th>Войны выиграно: вы / он</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="muted small">Счет по всем общим партиям, монументы и войны по партиям, где подробности есть у обоих.${bots}</p>`;
}

function colorsCell(d) {
  if (!d?.c) return '';
  // класс pcl, не pc: pc занят карточкой игрока в партии (отступы и сетка раздували колонку)
  return SCORE_ORDER.map((c) => `<span class="pcl"><i style="background:${HEX[c]}" title="${COLNAME[c]}"></i>${d.c[c]}</span>`).join('');
}

function rowsHTML(games) {
  return [...games].reverse().map((g) => `<tr>
    <td>${shortDate(g.date)}</td><td class="pgrp">${esc(g.group)}</td>
    <td class="pseats">${g.seats.map((s) => `${esc(s.name || 'Бот')} ${s.place}`).join(', ')}</td>
    <td>${g.win ? `<b>${g.place}</b>` : g.place}</td><td>${g.score}</td><td class="pcols">${colorsCell(g.d)}</td><td>${tableLink(g)}</td>
  </tr>`).join('');
}

/** Нарисовать вкладку в app. top и bindTop: шапка сайта и привязка ее кнопок. */
/** id: чью статистику открыть сразу (13.11, из профиля игрока); чужую сервер отдает только администратору. */
export async function renderPersonal(app, top, bindTop, id = null) {
  let kind = 'all';
  try { kind = localStorage.getItem(PICK_KEY) || 'all'; } catch { /* приватный режим */ }
  if (!KINDS.some(([k]) => k === kind)) kind = 'all';
  app.innerHTML = `<div class="page">${top}<main class="pcard stats personal">
    <h1>Статистика</h1>
    ${statsTabs('me')}
    <div class="tourbar"><label>Игрок <select id="pWho"></select></label></div>
    <div class="dates">
      <label>с <input type="date" id="pFrom"></label>
      <label>по <input type="date" id="pTo"></label>
      <button class="btn sm" id="pAll" type="button">Все время</button>
      <span class="seg" id="pKind">${KINDS.map(([k, t]) => `<button type="button" data-kind="${k}" class="${k === kind ? 'on' : ''}">${t}</button>`).join('')}</span>
    </div>
    <div class="pnums" id="pNums"><p class="muted">Загружаю...</p></div>
    <h2>Где играл</h2>
    <div class="tw"><table class="games pgroups"><thead><tr>${GROUP_COLS.map(([k, t]) => `<th><button class="linkbtn" data-sort="${k}" type="button">${t}</button></th>`).join('')}</tr></thead><tbody id="pGroups"></tbody></table></div>
    <section class="dash" id="pDash" hidden>
      <h2>Подробности партий</h2>
      <p class="muted small" id="pNote"></p>
      <section class="panel dwide" id="pVsBox"><h2>Вы и соперники</h2><div id="pVs"></div></section>
      <div class="dcards" id="pCards" style="--n:1"></div>
      <section class="panel dwide"><h2>Откуда очки</h2><div id="pSrc"></div></section>
      <div class="charts">
        <section class="panel"><h2>Очки по цветам</h2>
          <svg id="pColors" viewBox="0 0 420 250" role="img" aria-label="Средние очки по цветам и рекорды"></svg>
          <div class="legend"><span>столбик: среднее за партию, кружок: рекорд</span></div>
          <p class="small" id="pWeak"></p></section>
        <section class="panel"><h2>Бои</h2>
          <div id="pFights"></div>
          <div class="legend"><span><i style="background:${COLS[0]}"></i>выиграно</span><span><i style="background:#5a4c3c"></i>проиграно</span></div></section>
      </div>
    </section>
    <section class="panel dwide" id="pRivalsBox"><h2>Против каждого соперника</h2><div id="pRivals"></div></section>
    <section class="panel dwide" id="pDyn"><h2>Динамика по месяцам</h2>
      <svg id="pMonths" viewBox="0 0 660 230" role="img" aria-label="Средний счет и доля побед по месяцам"></svg>
      <div class="legend"><span>столбик: средний счет; под ним: партий | доля побед</span></div></section>
    <section class="panel dwide"><h2>Рекорды</h2><ul class="recs" id="pRecords"></ul></section>
    <h2>Партии</h2>
    <div class="tw"><table class="games">
      <thead><tr><th>Дата</th><th>Вид или турнир</th><th>Состав и места</th><th>Место</th><th>Счет</th><th>Очки по цветам</th><th>Стол</th></tr></thead>
      <tbody id="pRows"></tbody>
    </table></div>
  </main></div>`;
  bindTop();

  const $ = (id) => app.querySelector('#' + id);
  const from = $('pFrom'), to = $('pTo');
  let data = null, first = '', last = '', asked = 0, sortKey = 'n', sortDir = -1;

  const update = () => {
    if (!data) return;
    const list = pick(data.games, { from: from.value, to: to.value, kind });
    const name = data.player.name;
    $('pNums').innerHTML = numsHTML(summary(list));
    const groups = byGroup(list);
    $('pGroups').innerHTML = groups.length ? groupRows(groups, sortKey, sortDir) : `<tr><td colspan="6" class="muted">Партий нет</td></tr>`;
    const d = details(list);
    $('pDash').hidden = !d.count;
    if (d.count) {
      const miss = d.total - d.count;
      $('pNote').textContent = `По ${d.count} из ${d.total} партий${miss ? `: у ${miss} нет подробностей (старые партии сайта или BGA без логов)` : ''}.`;
      // есть с кем сравнить: таблица «Вы и соперники» вместо голых сумм (схема Дениса 04.11)
      const vs = vsRivals(list);
      $('pVsBox').hidden = !vs.games;
      $('pVs').innerHTML = vs.games ? vsHTML(vs) : '';
      $('pCards').hidden = Boolean(vs.games);
      $('pCards').innerHTML = vs.games ? '' : dashCards([name], [data.player.avatar], d);
      $('pSrc').innerHTML = sourcesHTML(pointSources(list));
      $('pColors').innerHTML = colorsChart([name], d);
      $('pFights').innerHTML = fightsHTML(d.players[0]);
      const wk = weakest(list), most = wk.n.indexOf(Math.max(...wk.n));
      $('pWeak').innerHTML = wk.games ? `Слабейшим цветом (он решает итог) чаще всего был <b style="color:${most === 3 ? '#cfc6b4' : HEX[most]}">${COLNAME[most]}</b>: в ${wk.n[most]} из ${wk.games} партий. ${SCORE_ORDER.map((c) => `${COLNAME[c]} ${wk.n[c]}`).join(', ')}.` : '';
    }
    $('pRivals').innerHTML = rivalsHTML(perRival(list));
    const months = monthly(list);
    $('pDyn').hidden = !months.length;
    $('pMonths').innerHTML = monthsChart(months);
    const ex = extraRecords(list);
    const ref = (r) => `${shortDate(r.g.date)}, ${tableLink(r.g)}`;
    // статистика об одном игроке: его имя в каждой строке рекордов лишнее
    $('pRecords').innerHTML = (d.count ? recordsList([name], d).replace(/<b style="color:[^"]*">[^<]*<\/b> /g, '') : '')
      + (ex.war ? `<li><span>Больше всего очков за войны в партии</span>${ex.war.v}, ${ref(ex.war)}</li>` : '')
      + (ex.mon ? `<li><span>Больше всего монументов в партии</span>${ex.mon.v}, ${ref(ex.mon)}</li>` : '')
      || '<li class="muted">Пока нет</li>';
    $('pRows').innerHTML = rowsHTML(list);
  };

  const load = async (id) => {
    const mine = ++asked;
    let r;
    try {
      r = await api('GET', `stats/player${id ? `?id=${encodeURIComponent(id)}` : ''}`);
    } catch (e) {
      toast(e.message);
      return;
    }
    if (mine !== asked || !$('pNums')) return; // успели выбрать другого игрока или уйти со страницы
    data = r;
    $('pWho').closest('.tourbar').hidden = r.players.length < 2; // игрок видит только себя (04.11)
    $('pWho').innerHTML = r.players.map((p) => `<option value="${esc(p.id)}" ${p.id === r.player.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    first = r.games[0]?.date ?? '';
    last = r.games[r.games.length - 1]?.date ?? '';
    from.min = to.min = first;
    from.max = to.max = last;
    from.value = first;
    to.value = last;
    update();
  };

  $('pWho').addEventListener('change', (e) => load(e.target.value));
  from.addEventListener('input', update);
  to.addEventListener('input', update);
  $('pAll').addEventListener('click', () => {
    from.value = first;
    to.value = last;
    update();
  });
  $('pKind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    kind = b.dataset.kind;
    try { localStorage.setItem(PICK_KEY, kind); } catch { /* приватный режим */ }
    $('pKind').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    update();
  });
  app.querySelector('.pgroups thead').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    sortDir = sortKey === b.dataset.sort ? -sortDir : b.dataset.sort === 'group' || b.dataset.sort === 'place' ? 1 : -1;
    sortKey = b.dataset.sort;
    update();
  });
  load(id || session.get()?.user?.id);
}
