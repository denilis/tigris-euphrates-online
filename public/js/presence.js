// Кто на сайте и приглашения: пульс на всех экранах после входа, плашка приглашения, список людей.
import { api, session } from './api.js';
import { beatDelay, arrivals, pendingInvites } from './online.js';
import { esc, toast, faceBg } from './util.js';

const TITLE = document.title;
const HANDLED_KEY = 'tigris.letters'; // на какие письма уже отвечали на этом устройстве

function loadHandled() {
  try { return new Set(JSON.parse(localStorage.getItem(HANDLED_KEY)) || []); } catch { return new Set(); }
}

const st = {
  on: false, timer: null, busy: false, hiddenAt: document.hidden ? Date.now() : null,
  online: null, invites: [], handled: loadHandled(), accepted: new Set(), listeners: new Set(),
};

function markHandled(id) {
  st.handled.add(id);
  try { localStorage.setItem(HANDLED_KEY, JSON.stringify([...st.handled].slice(-50))); } catch { /* приватный режим: живем без памяти */ }
}

function schedule() {
  clearTimeout(st.timer);
  if (!st.on) return;
  const hiddenMs = document.hidden ? Date.now() - (st.hiddenAt ?? Date.now()) : null;
  const wait = beatDelay({ hiddenMs, busy: st.busy });
  if (wait != null) st.timer = setTimeout(beat, wait);
}

async function beat() {
  if (!st.on) return;
  try {
    apply(await api('POST', 'beat', { busy: st.busy }));
  } catch { /* нет связи: следующий пульс повторит */ }
  schedule();
}

function apply({ me, online, inbox }) {
  // права могли поменять, пока человек на сайте: шапка увидит это на следующей странице
  const s = session.get();
  if (s && JSON.stringify(s.user) !== JSON.stringify(me)) session.set({ ...s, user: me });
  const fresh = arrivals(st.online, online);
  st.online = online;
  if (fresh.length && !st.busy) toast(`${fresh.map((p) => p.name).join(', ')}: теперь на сайте`);
  for (const m of inbox) {
    if (m.kind !== 'declined' || st.handled.has(m.id)) continue;
    markHandled(m.id);
    toast(`${m.from}: приглашение за стол ${m.title} отклонено`);
  }
  // письма держит сервер: плашка переживает обновление страницы, а ответ на другом устройстве ее убирает
  const invites = pendingInvites(inbox, st.handled);
  if (invites.map((m) => m.id).join() !== st.invites.map((m) => m.id).join()) {
    st.invites = invites;
    paintInvites();
  }
  st.listeners.forEach((fn) => fn());
}

function paintInvites() {
  let box = document.getElementById('invBar');
  if (!box) {
    box = document.createElement('div');
    box.id = 'invBar';
    document.body.append(box);
    box.addEventListener('click', onInviteClick);
  }
  box.innerHTML = st.invites.map((m, i) => `<div class="inv"><span><b>${esc(m.from)}</b> зовет вас за стол <b>${esc(m.title)}</b></span>
    <button class="btn primary sm" data-yes="${i}">Принять</button><button class="btn sm" data-no="${i}">Отказаться</button></div>`).join('');
  document.title = st.invites.length ? `(${st.invites.length}) Приглашение | ${TITLE}` : TITLE;
}

function onInviteClick(e) {
  const yes = e.target.closest('[data-yes]'), no = e.target.closest('[data-no]');
  const m = st.invites[+(yes || no)?.dataset[yes ? 'yes' : 'no']];
  if (!m) return;
  markHandled(m.id);
  st.invites = st.invites.filter((x) => x !== m);
  paintInvites();
  api('POST', 'invites/answer', { id: m.id, accept: Boolean(yes) }).catch(() => {});
  if (no) return;
  if (!m.seated) st.accepted.add(m.code); // кого посадили, тому садиться не надо, а убранного письмо не вернет

  const hash = `#/t/${m.code}`;
  if (location.hash === hash) window.dispatchEvent(new Event('hashchange')); // уже на этом столе: перечитать и сесть
  else location.hash = hash;
}

/** Кто сейчас на сайте по последнему пульсу; null, пока пульса не было. */
export const onlineNow = () => st.online;

/** Приняли приглашение за этот стол? Ответ дается один раз. */
export const takeAccepted = (code) => st.accepted.delete(code);

/** Новичок пришел по ссылке за стол (06.11): лобби посадит его так же, как принявшего приглашение. */
export const markAccepted = (code) => st.accepted.add(code);

export function startPresence() {
  if (st.on) return;
  st.on = true;
  beat();
}

export function stopPresence() {
  st.on = false;
  st.online = null;
  clearTimeout(st.timer);
  st.accepted.clear();
  if (st.invites.length) { // следующий человек на этом устройстве не должен видеть чужие приглашения
    st.invites = [];
    paintInvites();
  }
}

/** Человек за партией: пульс реже, про вошедших на экране партии не сообщаем. */
export function setBusy(v) {
  if (st.busy === v) return;
  st.busy = v;
  clearTimeout(st.timer);
  beat(); // другие должны сразу увидеть пометку «в партии», а не через минуту
}

document.addEventListener('visibilitychange', () => {
  st.hiddenAt = document.hidden ? Date.now() : null;
  if (document.hidden) schedule();
  else beat();
});

/**
 * Список людей на сайте с выбором. onSend(ids) получает выбранных.
 */
export function mountOnline(el, { button, count = false, onSend }) {
  const selected = new Set();
  const paint = () => {
    if (!el.isConnected) {
      st.listeners.delete(paint);
      return;
    }
    const list = st.online || [];
    const head = count ? `<div class="ohead">Сейчас на сайте: ${(st.online?.length || 0) + 1}</div>` : '';
    const face = (p) => (p.avatar ? `<i class="face" style="background-image:${faceBg(p)}"></i>` : '');
    const rows = list.map((p) => (p.busy
      ? `<div class="oitem">${face(p)}<span class="oname">${esc(p.name)}</span><small>в партии</small></div>`
      : `<label class="oitem"><input type="checkbox" data-pick="${esc(p.id)}" ${selected.has(p.id) ? 'checked' : ''}>${face(p)}<span class="oname">${esc(p.name)}</span></label>`)).join('');
    const empty = st.online ? 'Кроме вас сейчас никого нет.' : 'Смотрю, кто на сайте...';
    el.innerHTML = `${head}${rows || `<p class="muted small">${empty}</p>`}
      ${rows ? `<button class="btn sm" data-send ${selected.size ? '' : 'disabled'}>${button}</button>` : ''}`;
  };
  el.addEventListener('change', (e) => {
    const id = e.target.dataset?.pick;
    if (!id) return;
    if (e.target.checked) selected.add(id);
    else selected.delete(id);
    paint();
  });
  el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-send]') || !selected.size) return;
    try {
      await onSend([...selected]);
      selected.clear();
      paint();
    } catch (ex) { toast(ex.message); }
  });
  st.listeners.add(paint);
  paint();
}
