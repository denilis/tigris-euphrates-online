// Журнал удалений столов (схема одобрена Денисом 04.11): какой стол, когда и кто удалил или
// вернул. Администратор видит все записи на «Кодах игроков», игрок свои в «Моих столах».
// Глагол без рода («Стол удален», а не «Денис удалил»): за столом играют и женщины.
import { esc } from './util.js';

const WAS = { lobby: 'собирался', playing: 'шла партия', over: 'партия окончена', closed: 'партия завершена досрочно' };

/** Время записи: «04.11 18:40», запись прошлых лет с годом. */
export function stamp(at, now = Date.now()) {
  const d = new Date(at), p = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `.${d.getFullYear()}` : '';
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}${year} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Строки журнала; у удаления, которое можно отменить, кнопка «Вернуть». */
export function deletionsHTML(list, { now = Date.now(), empty = 'Удалений не было.' } = {}) {
  if (!list.length) return `<p class="muted">${empty}</p>`;
  return list.map((e) => {
    const name = `<b>${esc(e.title || e.code)}</b>`;
    const back = e.kind === 'restore';
    const what = back ? `Стол ${name} возвращен` : `Стол ${name} удален${WAS[e.from] ? `, ${WAS[e.from]}` : ''}`;
    const seats = !back && e.seats?.length ? `<small>${e.seats.map(esc).join(', ')}</small>` : '';
    return `<div class="dlog${back ? ' back' : ''}">
      <span class="when">${stamp(e.at, now)}</span>
      <span class="what">${what}${seats}</span>
      <span class="who">${esc(e.byName || '')}</span>
      <span class="acts">${e.canRestore ? `<button class="btn sm" data-restore="${esc(e.code)}" type="button">Вернуть</button>` : ''}</span>
    </div>`;
  }).join('');
}

/** Кнопки «Вернуть» в box: стол возвращается, затем done() перерисовывает списки. */
export function bindRestore(box, { api, toast, done }) {
  box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; // второе нажатие вернуло бы ошибку «стол не удален»
    try {
      await api('POST', `tables/${b.dataset.restore}/restore`);
      toast('Стол возвращен');
      done();
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  }));
}
