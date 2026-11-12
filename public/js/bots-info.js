// Карточки ботов «Какого бота выбрать» (просьба Дениса 05.11, схема одобрена): характер каждого
// стиля, на что ориентирован, как создан, кому подойдет, и как выбрать силу. Шкалы характера
// выведены из весов стилей (game/vendor/bot/styles_data.js); test/bots-info.test.js сверяет, что
// точки идут в том же порядке, что и веса. Цифры обучения: tigris-bot data/analysis/training.json
// от 22.10 (отложенные партии), турниры: PROJECT_MEMORY. Описания ботов Андрея и Влада только по
// поведению бота, без данных из личных профилей игроков.
import { esc, STYLES, BOT_FACES } from './util.js';
import { LADDER } from './bot-ladder.js';
import { STRENGTH_GUIDE } from './bot-steps.js';

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
    short: 'Хозяин в своем царстве: к соперникам лидеров не подсаживает, а чужого у себя выжидает и выбивает.',
    traits: { war: 4, revolt: 2, leader: 2, move: 2, weak: 3 },
    focus: 'Воюет за свое: выбивает чужих лидеров из своего царства и отнимает чужие монументы. Свои строит чуть реже других.',
    made: 'Обучен на ходах Дениса в 57 общих партиях на BGA (1 601 решение). Повторяет его ход в 27% решений, до обучения было 23%. В турнире против Базового выиграл 7 партий из 20: острее, но не сильнее.',
    fit: 'Тем, кто любит острые войны и не боится потерять лидера.',
  },
  andrey: {
    tag: 'по партиям Андрея',
    short: 'Сначала строитель, потом каток: первые 10 раундов растит царства без боев, потом идет войнами.',
    traits: { war: 3, revolt: 1, leader: 2, move: 2, weak: 5 },
    focus: 'В начале партии в бой идет только с почти верной победой и держит лидеров на месте. С 11-го раунда войны начинает чаще и чаще, но только с сильной позиции. Восстаний почти не начинает, монументы строит реже других.',
    made: 'Обучен на ходах Андрея в общих партиях на BGA (1 464 решения). Повторяет его ход в 22% решений, до обучения было 18%. Поверх обучения задан характер: мирное начало и поздние войны.',
    fit: 'Тем, кто любит спокойное начало и готов к тяжелой концовке.',
  },
  vlad: {
    tag: 'по партиям Влада',
    short: 'Самый задиристый: чаще всех воюет и восстает, смело ставит лидеров в чужие царства.',
    traits: { war: 5, revolt: 3, leader: 2, move: 2, weak: 4 },
    focus: 'Стычки по ходу всей партии: войны, восстания, монументы. Слабейший цвет держит, но без упрямства.',
    made: 'Обучен на ходах Влада в общих партиях на BGA (1 506 решений). Повторяет его ход в 25% решений, до обучения было 24%.',
    fit: 'Тем, кто любит живую партию с частыми боями.',
  },
};

export { STRENGTH_GUIDE };

const COUNT_TEXT = { none: 'не считает', approx: 'примерно', exact: 'точно' };

// шансы по калибровочному турниру ботов (05.11, tools/calibrate.mjs): ступень карточки ищется по настройкам
const sameSet = (a, b) => a.strength === b.strength && a.errors === b.errors && a.counting === b.counting;
const ladderIdx = (set) => LADDER.levels.findIndex((l) => sameSet(l.set, set));
const BASE_IDX = LADDER.levels.findIndex((l) => l.id === LADDER.anchor);

/** Строка шанса ступени против бота по умолчанию, один на один. */
export function stepChance(set) {
  const i = ladderIdx(set);
  if (i < 0) return '';
  if (i === BASE_IDX) return 'Это бот по умолчанию.';
  return `Против бота по умолчанию выигрывает ${LADDER.chance[i][BASE_IDX]}% партий один на один.`;
}

const riskText = (r) => (r > 50 ? 'чаще нападает' : r < 50 ? 'бережет лидеров' : 'как по умолчанию');

/** Ступень силы для настроек: ступень турнира при точном совпадении, иначе ближайшая по силе из карточек. */
export function stepOf(set) {
  const i = ladderIdx(set);
  if (i >= 0) return { title: LADDER.levels[i].title, exact: true };
  const d = (g) => Math.abs(g.set.strength - set.strength);
  return { title: STRENGTH_GUIDE.reduce((a, g) => (d(g) < d(a) ? g : a)).title, exact: false };
}

/** Досье бота за столом (Денис 05.11, схема одобрена): стиль, настройки простыми словами, ступень силы. */
export function dossierHTML({ face, settings: s }) {
  const style = BOT_INFO[s.style] ? s.style : 'universal';
  const st = stepOf(s);
  const step = st.exact
    ? `Ступень силы «${esc(st.title)}». ${esc(stepChance(s))}`
    : `Ближе всего к ступени «${esc(st.title)}». Точных шансов для такой настройки нет: турнир ботов играл только ступени из списка ниже.`;
  return `<div class="bdoss">
    <i class="face" style="background-image:${face}"></i>
    <div><p><b>Стиль ${esc(STYLES[style])}.</b> ${esc(BOT_INFO[style].short)}</p>
      <p>Сила ${s.strength}, ошибки ${s.errors}%, подсчет тайлов: ${COUNT_TEXT[s.counting] || COUNT_TEXT.none}, риск ${s.risk} (${riskText(s.risk)}).</p>
      <p class="bchance">${step}</p></div>
  </div>`;
}

/** Таблица шансов один на один: строка против столбца. */
function ladderTable() {
  const L = LADDER.levels;
  return `<details class="bladder"><summary>Шансы один на один по турниру ботов (${LADDER.games} партий)</summary>
    <div class="tw"><table><thead><tr><th>Кто против кого</th>${L.map((l) => `<th>${esc(l.title)}</th>`).join('')}</tr></thead>
    <tbody>${L.map((l, i) => `<tr><th>${esc(l.title)}<small>сила ${l.set.strength}, ошибки ${l.set.errors}%</small></th>${L.map((_, j) => (i === j ? '<td class="self">-</td>' : `<td>${LADDER.chance[i][j]}%</td>`)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="muted">Строка против столбца: какую долю партий вдвоем выигрывает бот строки. Все боты стиля Универсальный, продвинутое поле и правила сайта по умолчанию, раздумья как на сервере. Против трех соперников шансы любого бота ниже, чем один на один.</p>
  </details>`;
}
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

/** Разметка окна: досье бота за столом (если bot), вкладки стилей, карточка выбранного, ступени силы. */
export function guideHTML(style = 'universal', { canPick = false, bot = null } = {}) {
  const cur = BOT_INFO[style] ? style : 'universal';
  const title = bot ? `Досье: ${bot.name}` : 'Какого бота выбрать';
  return `<div class="bguide" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="bgtop"><h2>${esc(title)}</h2><button class="btn sm" data-bgclose type="button">Закрыть</button></div>
    ${bot ? `${dossierHTML(bot)}<h3>Какого бота выбрать</h3>` : ''}
    <p class="muted">Стили отличаются характером, а не силой: считают все одинаково глубоко. Силу задают ползунки «Сила» и «Ошибки» в настройках бота. Бот по партиям игрока похож на него выбором ходов, но не копия.</p>
    <div class="btabs">${Object.keys(BOT_INFO).map((k) => `<button class="${k === cur ? 'on' : ''}" data-bgstyle="${k}" type="button"><i class="face" style="background-image:url(/img/bots/${k}.webp)"></i>${esc(STYLES[k])}</button>`).join('')}</div>
    <div id="bgCard">${cardHTML(cur, canPick)}</div>
    <h3>Сила игры: как выбрать</h3>
    <div class="bsteps">${STRENGTH_GUIDE.map((g, i) => `<div class="bstep"><b>${esc(g.title)}</b><span>сила ${g.set.strength}, ошибки ${g.set.errors}%, подсчет тайлов: ${COUNT_TEXT[g.set.counting]}</span><small>${esc(g.text)}</small>${stepChance(g.set) ? `<small class="bchance">${esc(stepChance(g.set))}</small>` : ''}${canPick ? `<button class="btn sm" data-pickstep="${i}" type="button">Поставить</button>` : ''}</div>`).join('')}</div>
    ${ladderTable()}
    <p class="muted"><b>Риск</b>: выше значит чаще нападает, ниже значит бережет лидеров; по умолчанию 50. <b>Ошибки</b>: доля решений, где бот нарочно берет не лучший ход.</p>
  </div>`;
}

/**
 * Открыть окно поверх страницы. onPick(settings) есть у хозяина стола в лобби: кнопки ставят
 * стиль или ступень силы выбранному боту. bot = { name, face, settings }: досье бота за столом.
 * Закрывается кнопкой, щелчком мимо окна и Esc.
 */
export function openBotGuide(style, { onPick = null, bot = null } = {}) {
  closeBotGuide();
  const wrap = document.createElement('div');
  wrap.className = 'bgwrap';
  wrap.id = 'botGuide';
  let cur = style;
  const draw = () => { wrap.innerHTML = guideHTML(cur, { canPick: Boolean(onPick), bot }); };
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
