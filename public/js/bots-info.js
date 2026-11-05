// Карточки ботов «Какого бота выбрать» (просьба Дениса 05.11, схема одобрена): характер каждого
// стиля, на что ориентирован, как создан, кому подойдет, и как выбрать силу. Шкалы характера
// выведены из весов стилей (game/vendor/bot/styles_data.js); test/bots-info.test.js сверяет, что
// точки идут в том же порядке, что и веса. Цифры обучения: tigris-bot data/analysis/training.json
// от 22.10 (отложенные партии), турниры: PROJECT_MEMORY. Описания ботов Андрея и Влада только по
// поведению бота, без данных из личных профилей игроков.
import { esc, STYLES, BOT_FACES } from './util.js';

/** Черты характера: подпись и что значат точки (1 мало, 5 много). */
export const TRAITS = [
  ['war', 'Войны', 'как охотно начинает войну между царствами'],
  ['revolt', 'Восстания', 'как охотно начинает восстание внутри царства'],
  ['leader', 'Новые лидеры', 'как охотно выводит нового лидера на поле'],
  ['move', 'Перестановки', 'как часто переставляет лидеров с места на место'],
  ['weak', 'Слабейший цвет', 'насколько упорно подтягивает самый слабый цвет'],
];

export const BOT_INFO = {
  universal: {
    tag: 'по умолчанию',
    short: 'Сильный и ровный: охотно воюет, восстаний избегает, растит все четыре цвета.',
    traits: { war: 4, revolt: 2, leader: 2, move: 3, weak: 2 },
    focus: 'Войны за царства и монументы. Растит все цвета сразу, а не только слабейший, и рассчитывает подтянуть его позже.',
    made: 'Обучен на ходах игроков топ-20 рейтинга BGA и победителей всех 120 партий выборки (3 662 решения). Его лучший ход совпадает с ходом человека в 26% решений, до обучения было 23%. В турнире ботов обыграл Базового в 15 партиях из 20, поэтому стоит по умолчанию.',
    fit: 'Всем, кто хочет честную партию против сильного соперника без перекосов.',
  },
  base: {
    tag: 'без характера',
    short: 'Чистый расчет по общим весам, без привычек живых игроков.',
    traits: { war: 3, revolt: 3, leader: 3, move: 3, weak: 4 },
    focus: 'Ни к войнам, ни к восстаниям не тянется: решает только оценка позиции. Крепко держит слабейший цвет.',
    made: 'Ручные веса оценки позиции, с которых начиналось обучение всех стилей. На партиях людей не обучался.',
    fit: 'Для спокойной предсказуемой игры и для сравнения с остальными стилями.',
  },
  top: {
    tag: 'как мастера BGA',
    short: 'Подвижный: из обученных стилей чаще всех выводит и переставляет лидеров, войны слегка избегает.',
    traits: { war: 3, revolt: 2, leader: 3, move: 4, weak: 3 },
    focus: 'Гибкая игра лидерами, быстрый захват новых царств, монументы. В войну идет реже Универсального.',
    made: 'Обучен на 59 партиях игроков топ-20 рейтинга BGA (1 707 решений). Совпадает с ходом мастера в 29% решений, до обучения было 25%; ход мастера входит в три лучших хода бота в 44% решений.',
    fit: 'Тем, кто хочет посмотреть, как играют сильнейшие на BGA, и поучиться маневру.',
  },
  denis: {
    tag: 'по партиям Дениса',
    short: 'Самый воинственный: чаще всех начинает войны и охотится за чужими монументами.',
    traits: { war: 5, revolt: 2, leader: 2, move: 2, weak: 3 },
    focus: 'Войны и захват чужих царств вместе с монументами: строит их чуть реже других, охотнее отнимает.',
    made: 'Обучен на ходах Дениса в 57 общих партиях на BGA (1 601 решение). Повторяет его ход в 27% решений, до обучения было 23%. В турнире против Базового выиграл 7 партий из 20: острее, но не сильнее.',
    fit: 'Тем, кто любит острые войны и не боится потерять лидера.',
  },
  andrey: {
    tag: 'по партиям Андрея',
    short: 'Осторожный строитель: восстаний избегает сильнее всех, упорно подтягивает слабейший цвет.',
    traits: { war: 3, revolt: 1, leader: 2, move: 2, weak: 5 },
    focus: 'Строит царства и монументы, держит лидеров на месте и переставляет их реже других. Восстаний почти не начинает.',
    made: 'Обучен на ходах Андрея в общих партиях на BGA (1 464 решения). Повторяет его ход в 22% решений, до обучения было 18%.',
    fit: 'Тем, кто хочет спокойную позиционную партию и проверить себя в долгой игре.',
  },
  vlad: {
    tag: 'по партиям Влада',
    short: 'Задиристый: охотно воюет и из обученных стилей чаще других решается на восстания.',
    traits: { war: 4, revolt: 3, leader: 2, move: 2, weak: 4 },
    focus: 'Стычки по ходу всей партии: войны, восстания, монументы. Слабейший цвет держит, но без упрямства.',
    made: 'Обучен на ходах Влада в общих партиях на BGA (1 506 решений). Повторяет его ход в 25% решений, до обучения было 24%.',
    fit: 'Тем, кто любит живую партию с частыми боями.',
  },
};

/** Ступени силы. set: что ставит кнопка «Поставить» (как кнопка «Максимум» в лобби). */
export const STRENGTH_GUIDE = [
  { title: 'Учу правила', text: 'Делает заметные ошибки и не считает вышедшие тайлы. Можно спокойно разбираться в правилах.', set: { strength: 10, errors: 25, counting: 'none' } },
  { title: 'Играю иногда', text: 'Как бот по умолчанию: играет разумно, иногда ошибается.', set: { strength: 50, errors: 5, counting: 'none' } },
  { title: 'Уверенный игрок', text: 'Почти без ошибок, примерно помнит, какие тайлы вышли.', set: { strength: 80, errors: 2, counting: 'approx' } },
  { title: 'Серьезный бой', text: 'Кнопка «Максимум»: полная сила, без ошибок, точно считает тайлы.', set: { strength: 100, errors: 0, counting: 'exact' } },
];

const COUNT_TEXT = { none: 'не считает', approx: 'примерно', exact: 'точно' };
const dots = (n) => `<span class="bdots" aria-label="${n} из 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

/** Строка под выбором стиля в лобби. */
export const botShort = (style) => BOT_INFO[style]?.short || BOT_INFO.universal.short;

function cardHTML(style, canPick) {
  const b = BOT_INFO[style];
  return `<div class="bcard">
    <div class="bhead"><i class="face" style="background-image:url(/img/bots/${BOT_FACES.includes(style) ? style : 'universal'}.webp)"></i>
      <div><h3>${esc(STYLES[style])}</h3><small>${esc(b.tag)}</small><p>${esc(b.short)}</p></div></div>
    <div class="btraits">${TRAITS.map(([k, t, hint]) => `<div title="${esc(hint)}"><span>${t}</span>${dots(b.traits[k])}</div>`).join('')}</div>
    <p><b>На что ориентирован.</b> ${esc(b.focus)}</p>
    <p><b>Как создан.</b> ${esc(b.made)}</p>
    <p><b>Кому подойдет.</b> ${esc(b.fit)}</p>
    ${canPick ? `<button class="btn primary sm" data-pickstyle="${style}" type="button">Поставить этого бота</button>` : ''}
  </div>`;
}

/** Разметка окна: вкладки стилей, карточка выбранного, ступени силы. */
export function guideHTML(style = 'universal', { canPick = false } = {}) {
  const cur = BOT_INFO[style] ? style : 'universal';
  return `<div class="bguide" role="dialog" aria-modal="true" aria-label="Какого бота выбрать">
    <div class="bgtop"><h2>Какого бота выбрать</h2><button class="btn sm" data-bgclose type="button">Закрыть</button></div>
    <p class="muted">Стили отличаются характером, а не силой: считают все одинаково глубоко. Силу задают ползунки «Сила» и «Ошибки» в настройках бота. Бот по партиям игрока похож на него выбором ходов, но не копия.</p>
    <div class="btabs">${Object.keys(BOT_INFO).map((k) => `<button class="${k === cur ? 'on' : ''}" data-bgstyle="${k}" type="button"><i class="face" style="background-image:url(/img/bots/${k}.webp)"></i>${esc(STYLES[k])}</button>`).join('')}</div>
    <div id="bgCard">${cardHTML(cur, canPick)}</div>
    <h3>Сила игры: как выбрать</h3>
    <div class="bsteps">${STRENGTH_GUIDE.map((g, i) => `<div class="bstep"><b>${esc(g.title)}</b><span>сила ${g.set.strength}, ошибки ${g.set.errors}%, подсчет тайлов: ${COUNT_TEXT[g.set.counting]}</span><small>${esc(g.text)}</small>${canPick ? `<button class="btn sm" data-pickstep="${i}" type="button">Поставить</button>` : ''}</div>`).join('')}</div>
    <p class="muted"><b>Риск</b>: выше значит чаще нападает, ниже значит бережет лидеров; по умолчанию 50. <b>Ошибки</b>: доля решений, где бот нарочно берет не лучший ход. Что известно о силе по замерам: бот силы 80 выиграл у бота силы 0 все 10 партий, «Максимум» против трех ботов по умолчанию выигрывает 42% партий при честной доле 25%. Таблица примерная: точные шансы появятся после турнира ботов разной силы.</p>
  </div>`;
}

/**
 * Открыть окно поверх страницы. onPick(settings) есть у хозяина стола в лобби: кнопки ставят
 * стиль или ступень силы выбранному боту. Закрывается кнопкой, щелчком мимо окна и Esc.
 */
export function openBotGuide(style, { onPick = null } = {}) {
  closeBotGuide();
  const wrap = document.createElement('div');
  wrap.className = 'bgwrap';
  wrap.id = 'botGuide';
  let cur = style;
  const draw = () => { wrap.innerHTML = guideHTML(cur, { canPick: Boolean(onPick) }); };
  draw();
  const key = (e) => { if (e.key === 'Escape') closeBotGuide(); };
  wrap._key = key;
  document.addEventListener('keydown', key);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-bgclose]')) return closeBotGuide();
    const t = e.target.closest('[data-bgstyle]');
    if (t) { cur = t.dataset.bgstyle; draw(); return; }
    const p = e.target.closest('[data-pickstyle]');
    if (p && onPick) { onPick({ style: p.dataset.pickstyle }); closeBotGuide(); return; }
    const s = e.target.closest('[data-pickstep]');
    if (s && onPick) { onPick({ ...STRENGTH_GUIDE[+s.dataset.pickstep].set }); closeBotGuide(); }
  });
  document.body.append(wrap);
  wrap.querySelector('[data-bgclose]').focus();
}

export function closeBotGuide() {
  const w = document.getElementById('botGuide');
  if (!w) return;
  document.removeEventListener('keydown', w._key);
  w.remove();
}
