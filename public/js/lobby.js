// Лобби стола: места, герои, боты, очередность и правила. Менять правила, места и ботов
// может хозяин стола; героя выбирает тот, кто сидит; начать может любой сидящий.
import { HEROES, HERONAME, STYLES, tokenImg, faceBg, esc, copy, toast } from './util.js';
import { api } from './api.js';
import { mountOnline } from './presence.js';
import { fitTours, tourChoice } from './season.js';

const ORDER = [
  { id: 'loser', t: 'Первым ходит проигравший прошлой партии', d: 'Если эта компания уже играла: и для реванша, и для новой партии после перерыва. Остальные по кругу.' },
  { id: 'random', t: 'Случайно', d: 'Сервер перемешает места при старте.' },
  { id: 'custom', t: 'Вручную', d: 'Хозяин стола расставляет места, порядок сверху вниз.' },
];
const COUNTING = { none: 'не считает', approx: 'примерно', exact: 'точно' };

// выбранные для приглашения: лобби перерисовывается с каждым опросом, выбор должен пережить это
const picked = new Set();

// турниры меняются редко: лобби перерисовывается часто, а список обновляем раз в 20 секунд
const TOURS_MS = 20000;
let tours = null, toursAt = 0;

function tourLine(view, fit) {
  const on = tourChoice(fit, view.options.tournament);
  const dis = view.isHost ? '' : 'disabled';
  const name = fit.length > 1
    ? `<select id="lTourPick" aria-label="Турнир" ${dis}>${fit.map((t) => `<option value="${esc(t.id)}" ${t === on ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`
    : `<b>${esc(fit[0].name)}</b>`;
  return `<span class="muted">Турнир</span>${name}<label><input type="checkbox" id="lTourOn" ${on ? 'checked' : ''} ${dis}> партия идет в зачет</label>`;
}

/** Строка турнира: появляется, когда люди за столом совпали с составом турнира. */
function mountTour(box, view, act) {
  const paint = () => {
    const fit = fitTours(tours || [], view.seats);
    box.hidden = !fit.length;
    if (!fit.length) return;
    box.innerHTML = tourLine(view, fit);
    const pick = box.querySelector('#lTourPick');
    pick?.addEventListener('change', () => act({ action: 'options', options: { tournament: pick.value } }));
    box.querySelector('#lTourOn').addEventListener('change', (e) => {
      act({ action: 'options', options: { tournament: e.target.checked ? pick?.value || fit[0].id : 'none' } });
    });
  };
  paint();
  if (tours && Date.now() - toursAt < TOURS_MS) return;
  toursAt = Date.now();
  api('GET', 'tournaments').then((r) => {
    tours = r.tours;
    if (box.isConnected) paint();
  }).catch(() => {});
}

export function renderLobby(root, view, { act }) {
  const host = view.isHost, me = view.me;
  const freeSeats = view.seats.filter((s) => !s.taken).length;
  const canInvite = (me != null || host) && freeSeats > 0;
  const ready = view.seats.every((s) => s.taken && s.hero);
  const canStart = ready && (me != null || host);
  const heroOwner = (h) => view.seats.find((s) => s.hero === h);
  const link = location.origin + location.pathname + location.search + '#/t/' + view.code;

  const seats = view.seats.map((s, i) => {
    const mine = s.id === me;
    const editHero = mine || (s.kind === 'bot' && host);
    const heroes = HEROES.map((h) => {
      const owner = heroOwner(h);
      const on = s.hero === h, taken = owner && owner.id !== s.id;
      return `<button class="hero${on ? ' on' : ''}${taken ? ' taken' : ''}" data-hero="${h}" data-seat="${s.id}" ${editHero && !taken ? '' : 'disabled'} title="${taken ? `занят: ${esc(owner.name || 'бот')}` : HERONAME[h]}"><i style="background-image:url(${tokenImg(h, on ? 0 : 3)})"></i>${HERONAME[h]}</button>`;
    }).join('');
    let who;
    if (s.kind === 'bot') who = `<b>${esc(s.name || 'Бот')}</b>`;
    else if (s.taken) who = `${s.avatar ? `<i class="face" style="background-image:${faceBg(s)}"></i>` : ''}<b>${esc(s.name)}</b>${mine ? ' <small>(вы)</small>' : ''}`;
    else who = me == null ? `<button class="btn primary sm" data-sit="${s.id}">Сесть сюда</button>` : '<span class="muted">Свободно</span>';
    const kindSwitch = host && !(s.kind === 'human' && s.taken)
      ? `<span class="seg sm"><button data-kind="human" data-seat="${s.id}" class="${s.kind === 'human' ? 'on' : ''}">Человек</button><button data-kind="bot" data-seat="${s.id}" class="${s.kind === 'bot' ? 'on' : ''}">Бот</button></span>` : '';
    const move = host && view.options.order === 'custom'
      ? `<span class="mv"><button class="iconbtn" data-move="${s.id}" data-to="${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="Выше"><svg viewBox="0 0 16 16"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button><button class="iconbtn" data-move="${s.id}" data-to="${i + 1}" ${i === view.seats.length - 1 ? 'disabled' : ''} aria-label="Ниже"><svg viewBox="0 0 16 16"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></span>` : '';
    const b = s.bot || {};
    const dis = host ? '' : 'disabled';
    const botset = s.kind === 'bot' ? `<div class="botset">
        <label>Стиль <select data-bot="style" data-seat="${s.id}" ${dis}>${Object.entries(STYLES).map(([k, v]) => `<option value="${k}" ${b.style === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Сила <input type="range" min="0" max="100" step="5" value="${b.strength}" data-bot="strength" data-seat="${s.id}" ${dis}> <b>${b.strength}</b></label>
        <label>Подсчет тайлов <select data-bot="counting" data-seat="${s.id}" ${dis}>${Object.entries(COUNTING).map(([k, v]) => `<option value="${k}" ${b.counting === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Риск <input type="range" min="0" max="100" step="5" value="${b.risk}" data-bot="risk" data-seat="${s.id}" ${dis}> <b>${b.risk}</b></label>
        <label>Ошибки <input type="range" min="0" max="30" step="1" value="${b.errors}" data-bot="errors" data-seat="${s.id}" ${dis}> <b>${b.errors}%</b></label>
        ${host ? `<button class="btn sm" data-max="${s.id}">Максимум</button>` : ''}
      </div>` : '';
    return `<div class="seat">
      <div class="num">Место ${i + 1}<small>${s.kind === 'bot' ? 'бот' : mine && host ? 'вы, хозяин стола' : mine ? 'вы' : s.taken ? 'игрок' : 'ждет игрока'}</small>${move}</div>
      <div class="who">${who}${kindSwitch}${mine ? '<button class="linkbtn" data-leave="1">Встать</button>' : ''}</div>
      <div class="heroes">${heroes}</div>
      ${botset}
    </div>`;
  }).join('');

  const o = view.options;
  const dis = host ? '' : 'disabled';
  const notReady = view.seats.some((s) => !s.taken) ? 'Не все места заняты.' : view.seats.some((s) => !s.hero) ? 'Не у всех выбран герой.' : '';
  root.innerHTML = `<div class="lobby">
    <div class="lcard">
      <div class="lhead"><h1>Стол ${esc(view.title || view.code)}</h1><a class="linkbtn" href="#/">Мои столы</a></div>
      <p class="sub">Отправьте ссылку игрокам: каждый садится на свободное место и выбирает героя. Двух одинаковых героев за столом не бывает.</p>
      <div class="invite"><code>${esc(link)}</code><button class="btn sm" id="lCopy">Скопировать ссылку</button></div>
      ${canInvite ? `<h2>Пригласить (свободно мест: ${freeSeats})</h2><section class="online" id="lInvite"></section>` : ''}

      <h2>Места и герои</h2>
      ${host ? `<div class="opts"><span class="muted">Мест за столом</span><span class="seg">${[2, 3, 4].map((n) => `<button data-count="${n}" class="${view.seats.length === n ? 'on' : ''}">${n}</button>`).join('')}</span></div>` : ''}
      <div id="lSeats">${seats}</div>

      <h2>Кто ходит первым</h2>
      <div class="order">${ORDER.map((x) => `<label class="opt${o.order === x.id ? ' on' : ''}"><input type="radio" name="ord" value="${x.id}" ${o.order === x.id ? 'checked' : ''} ${dis}><div><b>${x.t}</b><span>${x.d}</span></div></label>`).join('')}</div>

      <h2>Правила стола</h2>
      <div class="opts">
        <span class="seg"><button data-board="standard" class="${o.board === 'standard' ? 'on' : ''}" ${dis}>Обычное поле</button><button data-board="advanced" class="${o.board === 'advanced' ? 'on' : ''}" ${dis}>Продвинутое поле</button></span>
        <label><input type="checkbox" data-opt="englishSupport" ${o.englishSupport ? 'checked' : ''} ${dis}> Английская поддержка</label>
        <label><input type="checkbox" data-opt="buildings" ${o.buildings ? 'checked' : ''} ${dis}> Здания</label>
        <label><input type="checkbox" data-opt="wonder" ${o.wonder ? 'checked' : ''} ${dis}> Чудо</label>
        <label><input type="checkbox" data-opt="openScore" ${o.openScore ? 'checked' : ''} ${dis}> Открытый счет (видны очки соперников)</label>
      </div>
      <div class="opts" id="lTour" hidden></div>
      <h2>Время</h2>
      <div class="opts">
        <span class="muted">На ход</span><span class="seg">${[20, 30, 45, 60, 90].map((n) => `<button data-time="turnSeconds" data-val="${n}" class="${(o.turnSeconds ?? 30) === n ? 'on' : ''}" ${dis}>${n} с</button>`).join('')}</span>
        <span class="muted">Окно отмены</span><span class="seg">${[[0, 'нет'], [10, '10 с'], [20, '20 с'], [30, '30 с']].map(([n, t]) => `<button data-time="confirmSeconds" data-val="${n}" class="${(o.confirmSeconds ?? 10) === n ? 'on' : ''}" ${dis}>${t}</button>`).join('')}</span>
      </div>
      <p class="muted small">Ход не отнимается: когда время выходит, таймер уходит в минус и горит красным, у каждого копится общее время за партию. После второго действия ход еще можно отменить, пока идет окно отмены. Сброс тайлов и нападение не отменяются.</p>
      ${host ? '' : '<p class="muted small">Правила, места и ботов меняет хозяин стола.</p>'}

      <div class="lfoot">
        ${notReady ? `<span class="muted">${notReady}</span>` : ''}
        ${me == null && !host ? '<span class="muted">Сядьте на свободное место, чтобы играть.</span>' : ''}
        <button class="btn primary" id="lStart" ${canStart ? '' : 'disabled'}>Начать партию</button>
      </div>
    </div>
  </div>`;

  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  root.querySelector('#lCopy').addEventListener('click', () => copy(link));
  mountTour(root.querySelector('#lTour'), view, act);
  if (canInvite) {
    mountOnline(root.querySelector('#lInvite'), {
      button: 'Пригласить',
      selected: picked,
      exclude: (p) => view.seats.some((s) => s.name === p.name), // уже за столом
      onSend: async (ids) => {
        const r = await api('POST', 'invite', { code: view.code, to: ids });
        toast(r.sent ? `Приглашений отправлено: ${r.sent}` : 'Некого приглашать');
      },
    });
  }
  on('[data-sit]', 'click', (el) => act({ action: 'sit', seat: +el.dataset.sit }));
  on('[data-leave]', 'click', () => act({ action: 'leave' }));
  on('[data-hero]', 'click', (el) => act({ action: 'hero', seat: +el.dataset.seat, hero: el.dataset.hero }));
  on('[data-kind]', 'click', (el) => act({ action: 'seatKind', seat: +el.dataset.seat, kind: el.dataset.kind }));
  on('[data-count]', 'click', (el) => act({ action: 'seatCount', n: +el.dataset.count }));
  on('[data-move]', 'click', (el) => act({ action: 'moveSeat', seat: +el.dataset.move, to: +el.dataset.to }));
  on('[data-bot]', 'change', (el) => act({ action: 'bot', seat: +el.dataset.seat, settings: { [el.dataset.bot]: el.type === 'range' ? +el.value : el.value } }));
  on('[data-bot][type=range]', 'input', (el) => { el.nextElementSibling.textContent = el.value + (el.dataset.bot === 'errors' ? '%' : ''); });
  on('[data-max]', 'click', (el) => act({ action: 'bot', seat: +el.dataset.max, settings: { strength: 100, errors: 0, counting: 'exact' } }));
  on('input[name=ord]', 'change', (el) => act({ action: 'options', options: { order: el.value } }));
  on('[data-board]', 'click', (el) => act({ action: 'options', options: { board: el.dataset.board } }));
  on('[data-opt]', 'change', (el) => act({ action: 'options', options: { [el.dataset.opt]: el.checked } }));
  on('[data-time]', 'click', (el) => act({ action: 'options', options: { [el.dataset.time]: +el.dataset.val } }));
  root.querySelector('#lStart').addEventListener('click', () => act({ action: 'start' }));
}
