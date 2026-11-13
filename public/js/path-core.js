// Путь новичка (Денис 13.11, схема одобрена): опрос после регистрации по ссылке и блок на главной.
// Здесь разметка и тексты без браузерных зависимостей (их проверяет test/path.test.js); запросы и
// кнопки в path.js. Правила пути на сервере: server/novice.js.
import { esc } from './util.js';

export const LESSONS = 8; // уроков в «Обучении»
const WITH_BOTS = ['', 'с одним ботом', 'с двумя ботами', 'с тремя ботами'];

/** Путь не пройден: в записи игрока есть path (сервер убирает его, когда все открыто). */
export const isNovice = (user) => Boolean(user?.path);

/**
 * Показать ли опрос: игрок еще не отвечал. answered ставится в сессию сразу после ответа: пульс
 * соседнего экземпляра сервера до минуты может вернуть прежнее состояние, и вопрос вылез бы снова.
 */
export const needsSurvey = (s) => Boolean(s?.token) && s.user?.path?.state === 'ask' && !s.pathAnswered;

/** Опрос «играли раньше?»: два равных ответа, ниже что от ответа зависит. */
export function surveyHTML(name) {
  return `<div class="gate"><div class="gcard survey">
    <h1>Тигр и Евфрат</h1>
    <p class="svq">${name ? `${esc(name)}, вы` : 'Вы'} уже играли в «Тигр и Евфрат»?</p>
    <div class="svbtns">
      <button class="btn" type="button" data-played="1">Да, правила знаю</button>
      <button class="btn" type="button" data-played="0">Нет, я новичок</button>
    </div>
    <p class="svnote">Новичку предложим обучение и три партии с ботами: с одним, с двумя и с тремя. После них откроются турниры и приглашения новых игроков. Тем, кто знает правила, все открыто сразу.</p>
    <p class="err" id="svErr" role="alert"></p>
  </div></div>`;
}

/** Строка обучения: сколько уроков пройдено в этом браузере (lessons) и пропущено ли (learn). */
function learnRow(learn, lessons) {
  const done = lessons >= LESSONS;
  const got = lessons > 0 && !done ? `, пройдено ${lessons} из ${LESSONS}` : '';
  let side;
  if (done) side = '<span class="npmark">пройдено</span>';
  else if (learn === 'skip') side = '<span class="npmark off">пропущено</span><a class="btn sm" href="#/learn">Пройти</a>';
  else side = '<a class="btn sm" href="#/learn">Пройти</a><button class="btn sm" type="button" data-npskip>Пропустить</button>';
  return `<li class="npi${done ? ' np-done' : learn === 'skip' ? ' np-skip' : ''}">
    <span class="npn" aria-hidden="true">У</span>
    <span class="npt"><b>Обучение</b><small>${LESSONS} уроков с ботом-тренером${got}</small></span>
    <span class="npa">${side}</span>
  </li>`;
}

function stepRow(s, table) {
  let side;
  if (s.status === 'done') side = '<span class="npmark">сыграно</span>';
  else if (s.status === 'now') side = `<button class="btn primary" type="button" data-npplay>${table ? 'Продолжить' : 'Играть'}</button>`;
  else side = '<span class="npmark off">закрыто</span>';
  return `<li class="npi np-${esc(s.status)}">
    <span class="npn" aria-hidden="true">${s.n}</span>
    <span class="npt"><b>Партия ${WITH_BOTS[s.bots] || `с ботами: ${s.bots}`}</b><small>уровень «${esc(s.level)}»${s.status === 'now' && table ? ', партия идет' : ''}</small></span>
    <span class="npa">${side}</span>
  </li>`;
}

/**
 * Блок «Путь новичка» на главной. p: ответ GET me/path в состоянии novice; lessons: сколько уроков
 * пройдено в этом браузере.
 */
export function pathHTML(p, lessons = 0) {
  return `<h2>Путь новичка</h2>
    <p class="npsub">Три партии с ботами, от простой к сложной. Партию запускает кнопка «Играть»: стол собирается сам, вы ходите первым.</p>
    <ol class="npl">${learnRow(p.learn, lessons)}${p.list.map((s) => stepRow(s, p.table)).join('')}</ol>
    <p class="npend">После трех партий откроются турниры и приглашения новых игроков. Засчитывается партия, сыгранная до конца, с любым местом.</p>`;
}

/** Строка в окне итога партии шага: что дальше по пути. n: номер сыгранного шага. */
export function stepNote(n) {
  if (n >= 3) return 'Путь новичка пройден: вам открыты турниры и приглашения новых игроков.';
  return `Партия ${n} из 3 пути новичка сыграна. Дальше партия ${WITH_BOTS[n + 1]}.`;
}

/** Подпись новичка в «Кодах игроков»: на каком он шаге. */
export function pathLabel(path) {
  if (!path) return '';
  return path.state === 'novice' ? `новичок: сыграно ${path.steps} из 3` : 'новичок: еще не ответил на опрос';
}
