// Лобби стола: места, герои, боты, очередность и правила. Менять правила, места и ботов
// может хозяин стола; героя выбирает тот, кто сидит; начинает хозяин стола, когда все люди на месте (04.11).
import { HEROES, HERONAME, STYLES, tokenImg, faceBg, esc, copy, toast } from './util.js';
import { api, session } from './api.js';
import { onlineNow } from './presence.js';
import { pickList, chatAllowed, chatNote } from './online.js';
import { fitTours, tourChoice } from './season.js';
import { play } from './signals.js';

const ORDER = [
  { id: 'loser', t: 'Первым ходит проигравший прошлой партии', d: 'Если эта компания уже играла: и для реванша, и для новой партии после перерыва. Остальные по кругу.' },
  { id: 'random', t: 'Случайно', d: 'Сервер перемешает места при старте.' },
  { id: 'custom', t: 'Вручную', d: 'Хозяин стола расставляет места, порядок сверху вниз.' },
];
const COUNTING = { none: 'не считает', approx: 'примерно', exact: 'точно' };
// вид монумента (выбор Дениса 03.11): номер, как Денис их называл, и короткое имя
const MONUMENTS = [['enamel', '1 Печать'], ['frame', '2 Рамка'], ['ziggurat', '3 Зиккурат']];

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

/** Закрыть окно выбора: стола под ним больше нет на экране. */
export const closePicker = () => document.querySelector('dialog.picker')?.close();

/**
 * Окно выбора игроков. Живет в body: лобби под ним перерисовывается с каждым опросом стола.
 * По щелчку мимо не закрывается: второй щелчок двойного нажатия закрыл бы его сразу.
 */
function openPicker(view, act, seat) {
  const free = view.seats.filter((s) => !s.taken).length;
  const box = document.createElement('dialog');
  box.className = 'picker';
  box.innerHTML = `<div class="pickin">
    <div class="pickhead"><h2>Кого позвать (свободно мест: ${free})</h2><button class="linkbtn" data-close type="button">Закрыть</button></div>
    <div class="picklist" id="pickList"><p class="muted">Загружаю...</p></div>
    <button class="btn primary" data-go type="button" disabled>Пригласить выбранных</button>
  </div>`;
  const list = box.querySelector('#pickList'), go = box.querySelector('[data-go]');
  const chosen = new Set();
  let sending = false;
  const paint = () => {
    list.querySelectorAll('input').forEach((c) => { c.disabled = sending || (!c.checked && chosen.size >= free); });
    go.disabled = sending || !chosen.size;
  };
  box.addEventListener('close', () => box.remove());
  box.querySelector('[data-close]').addEventListener('click', closePicker);
  list.addEventListener('change', (e) => {
    if (e.target.checked) chosen.add(e.target.value);
    else chosen.delete(e.target.value);
    paint();
  });
  go.addEventListener('click', async () => {
    sending = true;
    paint();
    const v = await act({ action: 'invitePeople', ids: [...chosen], seat });
    box.close();
    if (v) toast(chatNote(v.chat));
  });
  document.body.append(box);
  box.showModal();
  api('GET', 'people').then((people) => {
    const rows = pickList(people, view, onlineNow(), session.get()?.user?.id);
    list.innerHTML = rows.map((p) => `<label class="pickrow"><input type="checkbox" value="${esc(p.id)}">${p.avatar ? `<i class="face" style="background-image:${faceBg(p)}"></i>` : ''}<span>${esc(p.name)}</span><small>${p.note}</small></label>`).join('')
      || '<p class="muted">Все игроки уже за столом.</p>';
    paint();
  }).catch((e) => { list.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
}

// кто уже был на месте у этого стола: новых показываем всплывающей строкой и звонком
const seenHere = { code: null, ids: new Set(), ready: false };
function arrivals(view, here) {
  if (seenHere.code !== view.code) Object.assign(seenHere, { code: view.code, ids: new Set(here), ready: Array.isArray(view.here) });
  if (!Array.isArray(view.here)) return; // опрос еще не ответил: не знаем, кто на месте
  if (!seenHere.ready) {
    seenHere.ids = new Set(here); // первый ответ опроса: кто уже сидел, тот не «зашел»
    seenHere.ready = true;
    return;
  }
  const fresh = view.seats.filter((s) => here.has(s.id) && !seenHere.ids.has(s.id) && s.id !== view.me);
  seenHere.ids = new Set(here);
  if (!fresh.length) return;
  toast(`${fresh.map((s) => s.name).join(', ')} ${fresh.length > 1 ? 'зашли' : 'зашел'} за стол`);
  play({ events: ['arrive'] });
}

export function renderLobby(root, view, { act, bar = '', bindBar }) {
  const host = view.isHost, me = view.me;
  const canChat = (me != null || host) && chatAllowed(view, session.get()?.user?.name);
  const ready = view.seats.every((s) => s.taken && s.hero);
  // кто на месте за столом (просьба Дениса 04.11): опрос лобби приносит места людей, открывших стол
  const here = new Set([...(view.here || []), ...(me != null ? [me] : [])]);
  const waiting = view.seats.filter((s) => s.kind === 'human' && s.taken && !here.has(s.id));
  // начинает только хозяин стола и только когда все люди на месте
  const canStart = ready && host && !waiting.length;
  arrivals(view, here);
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
    else if (s.taken) who = `${s.avatar ? `<i class="face" style="background-image:${faceBg(s)}"></i>` : ''}<b>${esc(s.name)}</b>${mine ? ' <small>(вы)</small>' : ''}${here.has(s.id) ? '<span class="here on" title="открыл стол">на месте</span>' : '<span class="here" title="еще не открыл стол">еще не зашел</span>'}${host && !mine ? `<button class="linkbtn" data-unseat="${s.id}">Убрать</button>` : ''}`;
    else {
      const free = `${me == null ? `<button class="btn primary sm" data-sit="${s.id}">Сесть сюда</button>` : ''}${host ? `<button class="btn sm" data-people="${s.id}">Выбрать игрока</button>` : ''}`;
      who = free || '<span class="muted">Свободно</span>';
    }
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
  const notReady = view.seats.some((s) => !s.taken) ? 'Не все места заняты.' : view.seats.some((s) => !s.hero) ? 'Не у всех выбран герой.'
    : waiting.length ? `Ждем за столом: ${waiting.map((s) => s.name).join(', ')}.` : '';
  // сверху меню сайта, как на других страницах (просьба Дениса 03.11): раньше из лобби был
  // только путь через «Мои столы»
  // лобби глиняной табличкой (схема одобрена Денисом 04.11): полосы клинописи сверху и снизу,
  // буквы выбиты, места разделены процарапанными линиями, «Начать партию» оттиском печати
  root.innerHTML = `${bar}<div class="lobby">
    <div class="lcard clay">
      <div class="band top" aria-hidden="true"></div>
      <div class="lhead"><h1>Стол ${esc(view.title || view.code)}</h1></div>
      <p class="sub">Отправьте ссылку игрокам: каждый садится на свободное место и выбирает героя. Двух одинаковых героев за столом не бывает.</p>
      <div class="invite"><code>${esc(link)}</code><button class="btn sm" id="lCopy">Скопировать ссылку</button>${canChat ? '<button class="btn sm" id="lChat">Позвать в чат</button>' : ''}</div>

      <h2>Места и герои</h2>
      ${host ? `<div class="opts"><span class="muted">Мест за столом</span><span class="seg">${[2, 3, 4].map((n) => `<button data-count="${n}" class="${view.seats.length === n ? 'on' : ''}">${n}</button>`).join('')}</span></div>` : ''}
      <div id="lSeats">${seats}</div>

      <h2>Кто ходит первым</h2>
      <div class="order">${ORDER.map((x) => `<label class="opt${o.order === x.id ? ' on' : ''}"><input type="radio" name="ord" value="${x.id}" ${o.order === x.id ? 'checked' : ''} ${dis}><div><b>${x.t}</b><span>${x.d}</span></div></label>`).join('')}</div>

      <h2>Правила стола</h2>
      <div class="opts">
        <span class="seg"><button data-board="standard" class="${o.board === 'standard' ? 'on' : ''}" ${dis}>Обычное поле</button><button data-board="advanced" class="${o.board === 'advanced' ? 'on' : ''}" ${dis}>Продвинутое поле</button></span>
        <span class="seg" title="Вид поля, на правила не влияет. В партии каждый может сменить его для себя">${[['relief', 'Рельеф'], ['cells', 'Клетки']].map(([id, t]) => `<button data-look="${id}" class="${(o.look ?? 'relief') === id ? 'on' : ''}" ${dis}>${t}</button>`).join('')}</span>
        <span class="seg monseg" title="Вид монумента на поле, на правила не влияет">${MONUMENTS.map(([id, t]) => `<button data-monument="${id}" class="${(o.monument ?? 'enamel') === id ? 'on' : ''}" ${dis}><img src="/img/monuments/${id}/red-blue.webp" width="26" height="26" alt="">${t}</button>`).join('')}</span>
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
      <p class="muted small">Ход не отнимается: когда время выходит, таймер уходит в минус и горит красным, у каждого копится общее время за партию. После второго действия ход еще можно отменить, пока идет окно отмены. Нападение можно отменить, пока соперник не ответил; сброс тайлов не отменяется.</p>
      ${host ? '' : '<p class="muted small">Правила, места и ботов меняет хозяин стола.</p>'}

      <div class="lfoot">
        ${notReady ? `<span class="muted">${notReady}</span>` : ''}
        ${me == null && !host ? '<span class="muted">Сядьте на свободное место, чтобы играть.</span>' : ''}
        ${host ? `<button class="btn primary seal" id="lStart" ${canStart ? '' : 'disabled'}>Начать партию</button>` : '<span class="muted">Партию начнет хозяин стола, когда все будут на месте.</span>'}
      </div>
      <div class="band bot" aria-hidden="true"></div>
    </div>
  </div>`;

  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  bindBar?.();
  root.querySelector('#lCopy').addEventListener('click', () => copy(link));
  root.querySelector('#lChat')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('POST', 'invite/chat', { code: view.code });
      toast('Приглашение отправлено в чат');
    } catch (ex) { toast(ex.message); }
    const b = root.querySelector('#lChat'); // пока шел запрос, лобби могло перерисоваться
    if (b) b.disabled = false;
  });
  mountTour(root.querySelector('#lTour'), view, act);
  on('[data-people]', 'click', (el) => openPicker(view, act, +el.dataset.people));
  on('[data-unseat]', 'click', (el) => act({ action: 'unseat', seat: +el.dataset.unseat }));
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
  on('[data-look]', 'click', (el) => act({ action: 'options', options: { look: el.dataset.look } }));
  on('[data-monument]', 'click', (el) => act({ action: 'options', options: { monument: el.dataset.monument } }));
  on('[data-opt]', 'change', (el) => act({ action: 'options', options: { [el.dataset.opt]: el.checked } }));
  on('[data-time]', 'click', (el) => act({ action: 'options', options: { [el.dataset.time]: +el.dataset.val } }));
  root.querySelector('#lStart')?.addEventListener('click', () => act({ action: 'start' }));
}
