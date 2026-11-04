// Просмотр партии по ходам (этап 3 пакета 04.11, схема одобрена Денисом): поле на момент любого
// действия, что случилось в этом действии и очки на этот момент. Кадры дает сервер
// (GET tables/КОД/replay) из записи партии; есть у партий, начатых после 04.11.
// Адрес: #/t/КОД/replay или #/t/КОД/replay/N (сразу на кадре N).
import { api } from './api.js';
import { renderBoard } from './board.js';
import { trailMarks, TRAIL_FRESH_MS } from './trail.js';
import { logLines, lineHTML } from './logview.js';
import { HEX, COLNAME, SCORE_ORDER, esc, finalScore, setTileStyle } from './util.js';
import { framesBoards, timelineMarks } from './replay-core.js';

const SPEED = { 1: 1400, 2: 700 };

/** 1 сокровище, 2 сокровища, 5 сокровищ */
const treasureWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'сокровище' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'сокровища' : 'сокровищ');

// подсказка разбора ботом (этап 5, 04.11): на кадре ошибки рамка и стрелка лучшего хода
const C = 60, G = 24, W = 16; // клетка и поле подписей, как в board.js
const at = (i) => [G + (i % W) * C, G + Math.floor(i / W) * C];

/** Ошибки разбора на кадре k: [{ seat, loss, best, bestMove }]. */
export function hintsAt(analysis, k) {
  if (!analysis || !k) return [];
  return Object.entries(analysis.players).flatMap(([seat, p]) => p.mistakes.filter((m) => m.k === k).map((m) => ({ seat: +seat, ...m })));
}

function drawHint(svg, box, hints, name) {
  box.hidden = !hints.length;
  box.innerHTML = hints.map((h) => `<b>Разбор: ${esc(name(h.seat))}, потеря ${String(h.loss).replace('.', ',')}</b><div>Бот советовал: ${esc(h.best)}</div>`).join('');
  const dyn = svg.querySelector('.dyn');
  let s = '<defs><marker id="hintArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#7ee08a"/></marker></defs>';
  for (const h of hints) {
    const m = h.bestMove;
    if (!m || !(m.pos >= 0)) continue;
    const [x, y] = at(m.pos);
    s += `<rect class="hint" x="${x + 2}" y="${y + 2}" width="${C - 4}" height="${C - 4}" rx="7" fill="none" stroke="#7ee08a" stroke-width="3.5"/>`;
    if (m.from >= 0) {
      const [fx, fy] = at(m.from);
      s += `<path d="M${fx + C / 2} ${fy + C / 2}L${x + C / 2} ${y + C / 2}" stroke="#1b1309" stroke-width="6" stroke-linecap="round"/><path d="M${fx + C / 2} ${fy + C / 2}L${x + C / 2} ${y + C / 2}" stroke="#7ee08a" stroke-width="3" stroke-linecap="round" marker-end="url(#hintArrow)"/>`;
    }
  }
  dyn.insertAdjacentHTML('beforeend', s);
}

/** Нарисовать просмотр. start — номер кадра из адреса. */
export async function renderReplay(app, code, top, bindTop, start = 0) {
  app.innerHTML = `<div class="page">${top}<main class="pcard replay"><p class="muted">Загружаю запись партии...</p></main></div>`;
  bindTop();
  let data;
  try {
    data = await api('GET', `tables/${code}/replay`);
  } catch (e) {
    app.querySelector('main').innerHTML = `<h1>Просмотр партии</h1><p class="muted">${esc(e.message)}</p><p><a class="btn" href="#/t/${esc(code)}">К столу</a></p>`;
    return;
  }
  const main = app.querySelector('main');
  if (!main) return; // пока грузили, ушли на другую страницу
  const boards = framesBoards(data);
  const N = data.frames.length;
  const seat = (id) => data.seats.find((s) => s.id === id);
  const name = (id) => seat(id)?.name || 'Бот';
  const heroOf = (p) => seat(data.order[p])?.hero;
  let k = Math.max(0, Math.min(N, start)), timer = null, speed = 1;

  main.innerHTML = `
    <div class="rhead"><h1>Просмотр: ${esc(data.title || data.code)}</h1><a class="btn sm" href="#/t/${esc(data.code)}">К итогу партии</a></div>
    <div class="rgrid">
      <div class="rleft">
        <div class="boardwrap"><svg id="rBoard" class="board" role="img" aria-label="Поле на момент действия"></svg></div>
        <div class="rctl">
          <button class="btn sm" data-go="first" title="В начало (Home)">|◀</button>
          <button class="btn sm" data-go="prev" title="Назад (стрелка влево)">◀</button>
          <button class="btn sm" data-go="next" title="Вперед (стрелка вправо)">▶</button>
          <button class="btn sm" data-go="last" title="В конец (End)">▶|</button>
          <button class="btn sm primary" id="rPlay" title="Играть и пауза (пробел)">▶ Играть</button>
          <span class="seg" id="rSpeed"><button data-s="1" class="on">x1</button><button data-s="2">x2</button></span>
        </div>
        <div class="rtime">
          <div class="rtrack"><input type="range" id="rRange" min="0" max="${N}" step="1" value="${k}" aria-label="Действие партии">
            <div class="rmarks">${timelineMarks(data.frames).map((m) => `<i class="${m.kind}" style="left:${(100 * m.k) / Math.max(N, 1)}%"></i>`).join('')}</div></div>
          <span id="rPos"></span>
        </div>
        <div class="rlegend"><span><i class="war"></i>бой</span><span><i class="mon"></i>монумент</span></div>
      </div>
      <aside class="rside">
        <div class="rtitle" id="rTitle"></div>
        <div class="rhint" id="rHint" hidden></div>
        <ul class="log rlog" id="rLog"></ul>
        <h3>Очки на этот момент</h3>
        <div id="rScore"></div>
      </aside>
    </div>`;

  const $ = (id) => main.querySelector('#' + id);
  const svg = $('rBoard');

  const draw = () => {
    const b = boards[k];
    const f = k ? data.frames[k - 1] : null;
    const g = {
      board: b.board, river: data.river, special: data.special, wonderPos: b.wonder, buildingPos: b.bpos,
      monuments: data.monDefs.map((m, j) => ({ ...m, pos: b.mons[j] })), order: data.order,
    };
    // след действия: рамки и номер на клетках, как у хода соперника, без вспышки
    const trail = f ? trailMarks(f.entries, -1).map((m) => ({ ...m, age: TRAIL_FRESH_MS, hero: seat(m.actor)?.hero })) : [];
    setTileStyle(data.options.tiles || 'plate');
    renderBoard(svg, g, heroOf, { trail, monument: data.options.monument, building: data.options.building }, data.options.look || 'relief');
    drawHint(svg, $('rHint'), hintsAt(data.analysis, k), name);
    $('rRange').value = k;
    $('rPos').textContent = `${k} / ${N}`;
    $('rTitle').innerHTML = f
      ? `Ход ${f.turn}, действие ${f.action} из 2 <b>${esc(name(f.actor))}</b>`
      : 'Начало партии: храмы и сокровища на поле, у всех по 6 тайлов';
    $('rLog').innerHTML = f ? logLines(f.entries, name).map((l) => `<li><i>${l.turn}</i><div class="lbody">${lineHTML(l, name)}</div></li>`).join('') : '';
    $('rScore').innerHTML = data.order.map((id, p) => {
      const [r, bl, gr, bk, tr] = b.scores[p];
      const sc = [r, bl, gr, bk];
      return `<div class="rsc"><b>${esc(name(id))}</b><span class="sc">${SCORE_ORDER.map((c) => `<span style="background:${HEX[c]}${c === 3 ? ';outline:1px solid #cfc6b4' : ''}" title="${COLNAME[c]}">${sc[c]}</span>`).join('')}</span>
        <small>${tr ? `+${tr} ${treasureWord(tr)}, ` : ''}итог ${finalScore(sc, tr)}</small></div>`;
    }).join('');
  };

  const go = (to) => {
    k = Math.max(0, Math.min(N, to));
    if (k >= N) stop();
    draw();
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    $('rPlay').textContent = '▶ Играть';
  };
  const play = () => {
    if (timer) return stop();
    if (k >= N) k = 0;
    $('rPlay').textContent = '❚❚ Пауза';
    timer = setInterval(() => go(k + 1), SPEED[speed]);
  };

  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    stop();
    go({ first: 0, prev: k - 1, next: k + 1, last: N }[b.dataset.go]);
  }));
  $('rPlay').addEventListener('click', play);
  $('rRange').addEventListener('input', (e) => { stop(); go(+e.target.value); });
  $('rSpeed').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    speed = +b.dataset.s;
    for (const x of $('rSpeed').children) x.classList.toggle('on', x === b);
    if (timer) { stop(); play(); }
  });
  // клавиши, пока открыт просмотр; со страницы ушли — слушатель снимается сам
  const keys = (e) => {
    if (!document.body.contains(main)) { stop(); removeEventListener('keydown', keys); return; }
    if (e.target.closest?.('input,select,textarea') && e.key !== ' ') return;
    const to = { ArrowLeft: k - 1, ArrowRight: k + 1, Home: 0, End: N }[e.key];
    if (to != null) { e.preventDefault(); stop(); go(to); } else if (e.key === ' ') { e.preventDefault(); play(); }
  };
  addEventListener('keydown', keys);
  draw();
}
