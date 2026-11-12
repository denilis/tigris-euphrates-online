// Итог партии: места, очки по цветам и сокровища, «Еще партию» (реванш: тот же состав,
// первым ходит последнее место) и возврат к столам. Партия, завершенная организатором
// досрочно, итога не имеет: только сообщение и те же выходы.
import { HEX, HERONAME, COLNAME, SCORE_ORDER, faceBg, esc, ANALYSIS_SHOWN } from './util.js';
import { matchStats, turnsOf, STAT_ROWS } from './matchstats.js';
import { fmtTotal } from './clock.js';

/** Таблица как в конце партии на BGA: столбцы в порядке мест. */
function statsTable(view, list, seat) {
  const g = view.game;
  const stats = matchStats(g.log, view.seats.map((s) => s.id));
  const row = (name, cell) => `<tr><th scope="row">${name}</th>${list.map((r) => `<td>${cell(r)}</td>`).join('')}</tr>`;
  const value = (f) => (r) => f(stats[r.seatId], r);
  const turns = (r) => turnsOf(g.order.indexOf(r.seatId), g.order.length, g.turn);
  const time = (r) => fmtTotal(g.clock?.used?.[r.seatId] || 0);
  const rows = STAT_ROWS.map(([name, f]) => row(name, value(f)));
  rows.splice(5, 0, row('Количество ходов', turns));
  return `<h3 class="stathead">Статистика партии</h3><div class="statwrap"><table class="stattbl">
    <thead><tr><th></th>${list.map((r) => `<th scope="col">${esc(seat(r.seatId)?.name || 'Бот')}</th>`).join('')}</tr></thead>
    <tbody>${row('Результат', (r) => `${r.place}-е (${r.vector[0]})`)}${row('Время на обдумывание', time)}${rows.join('')}</tbody>
  </table></div>`;
}

/** Почему партия кончилась (endReason движка). 12 ходов = STALL_TURNS в game/table.js. */
export function endReasonText(reason) {
  if (reason === 'bag') return 'В мешке кончились тайлы.';
  if (reason === 'stall') return '12 ходов подряд из мешка не брали тайлов и с поля не уходили сокровища.';
  return 'На поле осталось два сокровища.';
}

/** Почему партия остановлена без итога. 400 ходов = BOT_TABLE_TURN_LIMIT в game/table.js. */
export function stopText(g) {
  if (g?.stopReason === 'long') return 'Боты играли без людей больше 400 ходов, и сервер остановил партию. Итога нет, в статистику она не идет.';
  return 'Организатор завершил партию досрочно. Итога нет, в статистику она не идет.';
}

// Крестик и Esc закрывают итог, как «Посмотреть поле» (Денис 12.11). Слушатель Esc один на модуль:
// renderEnd зовется на каждом обновлении стола и только запоминает, какое окно закрывать.
const X_BTN = '<button class="btn sm endx" id="eX" type="button" aria-label="Закрыть" title="Закрыть и посмотреть поле. Итог снова откроет кнопка «Итог партии»">×</button>';
let escTarget = null;
let escBound = false;
function onEsc(e) {
  if (e.key !== 'Escape' || !escTarget) return;
  const { box, close } = escTarget;
  if (!box.isConnected || box.hidden) return;
  if (document.querySelector('.shot')) return; // сверху открыта «Картинка итога»
  e.preventDefault();
  close();
}

export function renderEnd(box, view, { act, go }) {
  const g = view.game;
  const stopped = Boolean(g?.stopped);
  const show = stopped || (view.status === 'over' && g?.result);
  const opening = box.hidden || box.dataset.openCode !== view.code;
  box.hidden = !show;
  escTarget = null;
  if (!show) return;
  // за итогом картина праздника (Денис 04.11), у досрочно завершенной партии обычное затемнение
  box.classList.toggle('feast', !stopped);
  if (box.dataset.closed === view.code) {
    box.hidden = true;
    box.parentElement.querySelector('#gReopen')?.remove();
    const btn = document.createElement('button');
    btn.id = 'gReopen';
    btn.className = 'btn primary reopen';
    btn.textContent = stopped ? 'Партия завершена' : 'Итог партии';
    btn.addEventListener('click', () => { delete box.dataset.closed; renderEnd(box, view, { act, go }); });
    box.parentElement.append(btn);
    return;
  }
  box.parentElement.querySelector('#gReopen')?.remove();
  // окно начинается под шапкой партии (CSS), а на телефоне страница могла уехать вниз: при открытии наверх
  box.dataset.openCode = view.code;
  if (opening) globalThis.scrollTo?.(0, 0);
  const close = () => { box.dataset.closed = view.code; renderEnd(box, view, { act, go }); };
  escTarget = { box, close };
  if (!escBound) { escBound = true; globalThis.addEventListener?.('keydown', onEsc); }
  const bindClose = () => ['#eX', '#eClose'].forEach((id) => box.querySelector(id).addEventListener('click', close));
  if (stopped) {
    box.innerHTML = `<div class="endcard" role="dialog" aria-label="Партия завершена">
      <div class="endhead"><h2>Партия завершена</h2>${X_BTN}</div>
      <p class="msub">${stopText(g)}</p>
      <div class="mfoot"><button class="btn" id="eClose">Посмотреть поле</button><button class="btn primary" id="eHome">К столам</button></div>
    </div>`;
    bindClose();
    box.querySelector('#eHome').addEventListener('click', () => go('#/tables'));
    return;
  }
  const seat = (id) => view.seats.find((s) => s.id === id);
  const list = [...g.result.seats].sort((a, b) => a.place - b.place);
  const rows = list.map((r) => {
    const s = seat(r.seatId) || {};
    const chips = SCORE_ORDER.map((c) => `<span style="background:${HEX[c]}" title="${COLNAME[c]}">${r.score[c]}</span>`).join('');
    return `<tr class="${r.seatId === view.me ? 'me' : ''}">
      <td class="place">${r.place}</td>
      <td><span class="who"><i style="background-image:${faceBg(s)}"></i>${esc(s.name || 'Бот')}<small>${HERONAME[s.hero] || ''}</small></span></td>
      <td class="fin">${r.vector[0]}</td>
      <td><span class="sc2">${chips}<em title="сокровища">+${r.treasures}</em></span></td>
    </tr>`;
  }).join('');
  box.innerHTML = `<div class="endcard" role="dialog" aria-label="Итог партии">
    <div class="endhead"><h2>Партия окончена</h2>${X_BTN}</div>
    <p class="msub">${endReasonText(g.endReason)} Итог считается по слабейшему цвету, сокровища добавляются к слабейшим.</p>
    <table class="endtbl"><thead><tr><th>Место</th><th>Игрок</th><th>Итог</th><th>Очки и сокровища</th></tr></thead><tbody>${rows}</tbody></table>
    ${statsTable(view, list, seat)}
    ${g.replay && ANALYSIS_SHOWN ? '<div class="ana" id="eAna"></div>' : ''}
    <div class="mfoot">
      <button class="btn" id="eClose">Посмотреть поле</button>
      ${g.replay ? '<button class="btn" id="eReplay">Просмотр по ходам</button>' : ''}
      <button class="btn" id="ePicture">Картинка итога</button>
      <button class="btn" id="eHome">К столам</button>
      ${view.me != null ? `<button class="btn primary" id="eAgain">${view.next ? 'Перейти к реваншу' : 'Еще партию'}</button>` : ''}
    </div>
    ${view.me != null && !view.next ? '<p class="mnote">В реванше тот же состав и правила, первым ходит последнее место.</p>' : ''}
  </div>`;
  bindClose();
  box.querySelector('#eHome').addEventListener('click', () => go('#/tables'));
  box.querySelector('#eReplay')?.addEventListener('click', () => go(`#/t/${view.code}/replay`));
  // картинка итога (этап 4, 04.11): модуль грузится по нажатию, поле берется с экрана партии
  box.querySelector('#ePicture').addEventListener('click', async () => (await import('./endshot.js')).openPicture(view, document.querySelector('#board')));
  // разбор ботом (этап 5, 04.11): готовый с сервера или кнопкой, модуль грузится только здесь
  const ana = box.querySelector('#eAna');
  if (ana) import('./analysis.js').then((m) => m.mountAnalysis(ana, view, { go }));
  box.querySelector('#eAgain')?.addEventListener('click', async () => {
    if (view.next) return go(`#/t/${view.next}`);
    const v = await act({ action: 'rematch' });
    if (v?.next) go(`#/t/${v.next}`);
  });
}
