// Итог партии: места, очки по цветам и сокровища, «Еще партию» (реванш: тот же состав,
// первым ходит последнее место) и возврат к столам.
import { HEX, HERONAME, COLNAME, tokenImg, esc } from './util.js';

export function renderEnd(box, view, { act, go }) {
  const g = view.game;
  const show = view.status === 'over' && g?.result;
  box.hidden = !show;
  if (!show) return;
  if (box.dataset.closed === view.code) {
    box.hidden = true;
    box.parentElement.querySelector('#gReopen')?.remove();
    const btn = document.createElement('button');
    btn.id = 'gReopen';
    btn.className = 'btn primary reopen';
    btn.textContent = 'Итог партии';
    btn.addEventListener('click', () => { delete box.dataset.closed; renderEnd(box, view, { act, go }); });
    box.parentElement.append(btn);
    return;
  }
  box.parentElement.querySelector('#gReopen')?.remove();
  const seat = (id) => view.seats.find((s) => s.id === id);
  const rows = [...g.result.seats].sort((a, b) => a.place - b.place).map((r) => {
    const s = seat(r.seatId) || {};
    const chips = r.score.map((v, c) => `<span style="background:${HEX[c]}" title="${COLNAME[c]}">${v}</span>`).join('');
    return `<tr class="${r.seatId === view.me ? 'me' : ''}">
      <td class="place">${r.place}</td>
      <td><span class="who"><i style="background-image:url(${tokenImg(s.hero, 0)})"></i>${esc(s.name || 'Бот')}<small>${HERONAME[s.hero] || ''}</small></span></td>
      <td class="fin">${r.vector[0]}</td>
      <td><span class="sc2">${chips}<em title="сокровища">+${r.treasures}</em></span></td>
    </tr>`;
  }).join('');
  box.innerHTML = `<div class="endcard" role="dialog" aria-label="Итог партии">
    <h2>Партия окончена</h2>
    <p class="msub">${g.endReason === 'bag' ? 'В мешке кончились тайлы.' : 'На поле осталось два сокровища.'} Итог считается по слабейшему цвету, сокровища добавляются к слабейшим.</p>
    <table class="endtbl"><thead><tr><th>Место</th><th>Игрок</th><th>Итог</th><th>Очки и сокровища</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="mfoot">
      <button class="btn" id="eClose">Посмотреть поле</button>
      <button class="btn" id="eHome">К столам</button>
      ${view.me != null ? `<button class="btn primary" id="eAgain">${view.next ? 'Перейти к реваншу' : 'Еще партию'}</button>` : ''}
    </div>
    ${view.me != null && !view.next ? '<p class="mnote">В реванше тот же состав и правила, первым ходит последнее место.</p>' : ''}
  </div>`;
  box.querySelector('#eClose').addEventListener('click', () => { box.dataset.closed = view.code; renderEnd(box, view, { act, go }); });
  box.querySelector('#eHome').addEventListener('click', () => go('#/'));
  box.querySelector('#eAgain')?.addEventListener('click', async () => {
    if (view.next) return go(`#/t/${view.next}`);
    const v = await act({ action: 'rematch' });
    if (v?.next) go(`#/t/${v.next}`);
  });
}
