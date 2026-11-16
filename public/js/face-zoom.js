// Крупное фото игрока в партии (Денис 16.11, схема одобрена): нажатие на аватар в карточке игрока
// открывает окно поверх партии. Квадрат со скругленными углами, чтобы видно было все фото, под ним
// имя и герой, у бота стиль и сила. Закрывается крестиком, щелчком по затемнению и Esc. Партия под
// окном идет как обычно: окно ничего не ждет и ходы не держит. Фото людей с 16.11 хранятся 400 на 400,
// прежние 160 на 160 крупно выглядят мягче.
import { esc, faceBg, HERONAME, STYLES } from './util.js';

/** Разметка окна. s: место за столом из вида; mine: это вы; color: цвет жетона под фото, как в карточке. */
export function faceZoomHTML(s = {}, { mine = false, color = 3 } = {}) {
  const name = s.name || (s.kind === 'bot' ? 'Бот' : 'Игрок');
  const hero = HERONAME[s.hero] ? `герой ${HERONAME[s.hero]}` : '';
  const bot = s.kind === 'bot'
    ? ['бот', STYLES[s.bot?.style], s.bot?.strength != null ? `сила ${s.bot.strength}` : ''].filter(Boolean).join(', ')
    : '';
  const sub = [hero, bot].filter(Boolean).join('. ');
  return `<div class="fzin">
    <button class="btn sm lclose" type="button" data-fzclose aria-label="Закрыть" title="Закрыть">×</button>
    <div class="fzpic" role="img" aria-label="${esc(`Фото: ${name}`)}" style="background-image:${faceBg(s, color)}"></div>
    <p class="fzname">${esc(name)}${mine ? ' <small>(вы)</small>' : ''}</p>
    ${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}
  </div>`;
}

/** Открыть окно. Второе нажатие на другой аватар заменяет окно, а не кладет второе поверх. */
export function openFaceZoom(s, opts) {
  document.querySelectorAll('dialog.facezoom').forEach((d) => d.close());
  const box = document.createElement('dialog');
  box.className = 'picker facezoom';
  box.innerHTML = faceZoomHTML(s, opts);
  box.addEventListener('close', () => box.remove());
  // щелчок по затемнению приходит на сам dialog: у окна нет полей, содержимое заполняет его целиком
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.closest('[data-fzclose]')) box.close();
  });
  document.body.append(box);
  box.showModal();
  return box;
}
