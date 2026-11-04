// Приветствие на главной (просьба Дениса 04.11, схема одобрена): что это за игра и где что
// искать на сайте. «Больше не показывать» помнит браузер, ссылка «О сайте» внизу главной
// возвращает приветствие.
import { esc } from './util.js';

const KEY = 'tigris.welcome.hidden';

export function welcomeHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setWelcomeHidden(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* приватный режим: живем без памяти */ }
}

/** Разделы сайта в приветствии: адрес, название, что там. */
export const SECTIONS = [
  ['#/rules', 'Правила', 'полные правила со схемами'],
  ['#/learn', 'Обучение', '8 уроков: проходите ходы против бота-тренера'],
  ['#/stats', 'Статистика', 'сыгранные партии, зачет турниров, рекорды и награды; здесь же можно завести новый турнир'],
  ['#/', 'Мои столы', 'ваши партии: новый стол, приглашение партнеров или ботов, сыгранные партии и их просмотр по ходам'],
  ['#/admin', 'Коды игроков', 'завести нового игрока и выдать ему код'],
];

export function welcomeHTML(user) {
  return `<section class="welcome" id="welcome">
    <h2>Добро пожаловать в «Тигр и Евфрат»${user?.name ? `, ${esc(user.name)}` : ''}</h2>
    <p>Знаменитая настольная игра Райнера Книции (1997) о первых цивилизациях Месопотамии: царства между двух рек, лидеры, войны и монументы. Побеждает тот, у кого слабейший цвет сильнее, чем у соперников.</p>
    <div class="wnav">${SECTIONS.map(([href, title, text]) => `<a class="wlink" href="${href}"><b>${title}</b><span>${text}</span></a>`).join('')}</div>
    <div class="wfoot"><button class="linkbtn" id="welcomeHide">Больше не показывать</button></div>
  </section>`;
}
