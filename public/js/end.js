// Итог партии: места, очки по цветам и сокровища, «Еще партию» (реванш: тот же состав,
// первым ходит последнее место) и возврат к столам. Партия, завершенная организатором
// досрочно, итога не имеет: только сообщение и те же выходы.
import { HEX, HERONAME, COLNAME, SCORE_ORDER, faceBg, esc } from './util.js';
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

export function renderEnd(box, view, { act, go }) {
  const g = view.game;
  const stopped = Boolean(g?.stopped);
  const show = stopped || (view.status === 'over' && g?.result);
  box.hidden = !show;
  if (!show) return;
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
  if (stopped) {
    box.innerHTML = `<div class="endcard" role="dialog" aria-label="Партия завершена">
      <h2>Партия завершена</h2>
      <p class="msub">Организатор завершил партию досрочно. Итога нет, в статистику она не идет.</p>
      <div class="mfoot"><button class="btn" id="eClose">Посмотреть поле</button><button class="btn primary" id="eHome">К столам</button></div>
    </div>`;
    box.querySelector('#eClose').addEventListener('click', () => { box.dataset.closed = view.code; renderEnd(box, view, { act, go }); });
    box.querySelector('#eHome').addEventListener('click', () => go('#/'));
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
    <h2>Партия окончена</h2>
    <p class="msub">${g.endReason === 'bag' ? 'В мешке кончились тайлы.' : 'На поле осталось два сокровища.'} Итог считается по слабейшему цвету, сокровища добавляются к слабейшим.</p>
    <table class="endtbl"><thead><tr><th>Место</th><th>Игрок</th><th>Итог</th><th>Очки и сокровища</th></tr></thead><tbody>${rows}</tbody></table>
    ${statsTable(view, list, seat)}
    <div class="mfoot">
      <button class="btn" id="eClose">Посмотреть поле</button>
      ${g.replay ? '<button class="btn" id="eReplay">Просмотр по ходам</button>' : ''}
      <button class="btn" id="eHome">К столам</button>
      ${view.me != null ? `<button class="btn primary" id="eAgain">${view.next ? 'Перейти к реваншу' : 'Еще партию'}</button>` : ''}
    </div>
    ${view.me != null && !view.next ? '<p class="mnote">В реванше тот же состав и правила, первым ходит последнее место.</p>' : ''}
  </div>`;
  box.querySelector('#eClose').addEventListener('click', () => { box.dataset.closed = view.code; renderEnd(box, view, { act, go }); });
  box.querySelector('#eHome').addEventListener('click', () => go('#/'));
  box.querySelector('#eReplay')?.addEventListener('click', () => go(`#/t/${view.code}/replay`));
  box.querySelector('#eAgain')?.addEventListener('click', async () => {
    if (view.next) return go(`#/t/${view.next}`);
    const v = await act({ action: 'rematch' });
    if (v?.next) go(`#/t/${v.next}`);
  });
}
