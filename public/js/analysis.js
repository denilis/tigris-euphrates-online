// Блок «Разбор партии ботом» на экране итога (этап 5 пакета 04.11, схема одобрена Денисом).
// Готовый разбор берется с сервера; если его нет, кнопка «Разобрать партию» считает его в фоне
// браузера (analysis-worker.js) и сохраняет на сервере, чтобы второй раз не считать.
import { api } from './api.js';
import { esc } from './util.js';

const num = (v) => String(v).replace('.', ',');

function render(el, view, a, go) {
  const seat = (id) => view.seats.find((s) => s.id === +id);
  const order = [...view.game.result.seats].sort((x, y) => x.place - y.place).map((r) => String(r.seatId)).filter((id) => a.players[id]);
  el.innerHTML = `<h3>Разбор партии ботом</h3>
    <p class="mnote">Бот оценил каждое действие людей: насколько сыгранный ход хуже лучшего, если смотреть глазами игрока, без знания чужих рук. Точность: доля ходов, уступивших лучшему меньше 0,5 очка оценки.</p>
    <div class="anacards">${order.map((id) => {
      const p = a.players[id];
      return `<div class="anacard">
        <div class="anahead"><b>${esc(seat(id)?.name || 'Игрок')}</b><span>Точность ${p.accuracy ?? 0}%</span></div>
        <small>точных ${p.exact} из ${p.actions}</small>
        ${p.mistakes.length ? `<ol>${p.mistakes.map((m) => `<li>
          <div class="anam"><b>Ход ${m.turn}, потеря ${num(m.loss)}</b><button class="btn sm" data-frame="${m.k}" type="button">на поле</button></div>
          <div>Сыграно: ${esc(m.played)}</div><div class="anabest">Лучше: ${esc(m.best)}</div>
        </li>`).join('')}</ol>` : '<p class="mnote">Ошибок нет.</p>'}
      </div>`;
    }).join('')}</div>`;
  el.querySelectorAll('[data-frame]').forEach((b) => b.addEventListener('click', () => go(`#/t/${view.code}/replay/${b.dataset.frame}`)));
}

/** Повесить блок разбора в el. */
export async function mountAnalysis(el, view, { go }) {
  let info;
  try {
    info = await api('GET', `tables/${view.code}/analysis`);
  } catch {
    el.remove();
    return;
  }
  if (info.analysis) return render(el, view, info.analysis, go);
  if (!info.can) {
    el.remove();
    return;
  }
  el.innerHTML = `<h3>Разбор партии ботом</h3>
    <p class="mnote">Бот покажет у каждого до пяти ходов, где потеряно больше всего, и что было бы лучше. Считает ваш браузер, обычно меньше минуты.</p>
    <button class="btn" id="anaGo" type="button">Разобрать партию</button>
    <div class="anabar" hidden><i></i></div><p class="mnote" id="anaNote"></p>`;
  const bar = el.querySelector('.anabar'), note = el.querySelector('#anaNote');
  el.querySelector('#anaGo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    note.textContent = 'Загружаю запись партии...';
    let rec;
    try {
      rec = await api('GET', `tables/${view.code}/record`);
    } catch (err) {
      note.textContent = err.message;
      e.target.disabled = false;
      return;
    }
    bar.hidden = false;
    note.textContent = 'Бот разбирает партию...';
    const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = async ({ data }) => {
      if (data.progress != null) bar.firstElementChild.style.width = `${Math.round(100 * data.progress)}%`;
      if (data.error) {
        worker.terminate();
        note.textContent = `Не получилось: ${data.error}`;
        e.target.disabled = false;
      }
      if (data.result) {
        worker.terminate();
        // сохраняем, чтобы другим не считать заново; если уже сохранил кто-то, показываем его разбор
        const saved = await api('POST', `tables/${view.code}/analysis`, { analysis: data.result }).catch(() => null);
        render(el, view, saved?.analysis || data.result, go);
      }
    };
    worker.onerror = () => {
      note.textContent = 'Не получилось запустить разбор в этом браузере';
      e.target.disabled = false;
    };
    worker.postMessage(rec);
  });
}
