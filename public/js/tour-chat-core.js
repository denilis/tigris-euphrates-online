// Строка чата турнира в «Статистике» (15.11): чистая функция без запросов, ее проверяют тесты в node.
import { esc } from './util.js';

const HEAD = '<span class="flab">Чат Telegram</span>';

/**
 * Строка чата турнира. tour: { id, chat } из GET tournaments; ready: бот работает (основной сайт);
 * wait: выданный код { link, command, minutes }, пока группа не подключена.
 */
export function chatRowHTML(tour, ready, wait = null) {
  if (!tour) return '';
  if (tour.chat?.fixed) return `<div class="tcline">${HEAD}<b class="tcname">${esc(tour.chat.title)}</b><span class="muted small">чат сезона, задан в настройках сайта</span></div>`;
  if (tour.chat) return `<div class="tcline">${HEAD}<b class="tcname">«${esc(tour.chat.title)}»</b><button class="btn sm" id="cOff" type="button">Отключить</button></div>`;
  if (!ready) return `<div class="tcline">${HEAD}<span class="muted small">подключается только на основном сайте</span></div>`;
  if (!wait) return `<div class="tcline">${HEAD}<span class="muted">не подключен</span><button class="btn sm" id="cOn" type="button">Подключить</button></div>`;
  return `<div class="tcline">${HEAD}<span class="muted">подключение</span></div>
    <ol class="tcsteps">
      <li>Нажмите кнопку и выберите группу, где сидят участники турнира. Бот сам добавится и подключит чат.
        <a class="btn sm primary" id="cLink" href="${esc(wait.link)}" target="_blank" rel="noopener">Добавить бота в чат</a></li>
      <li>Если бот уже в группе, отправьте там: <code>${esc(wait.command)}</code>
        <button class="btn sm" id="cCopy" type="button">Скопировать</button></li>
    </ol>
    <p class="muted small">Код действует ${wait.minutes} минут. Жду подключения... <button class="linkbtn" id="cCancel" type="button">Отмена</button></p>`;
}
