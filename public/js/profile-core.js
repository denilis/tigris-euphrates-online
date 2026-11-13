// «Мой профиль»: разметка сводки без обращения к странице (проверяется тестами в Node).
// Данные приходят с сервера (GET me/profile, server/profile.js и server/rating.js).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 1,9 вместо 1.9. */
export const oneDec = (x) => x.toFixed(1).replace('.', ',');
/** Место словом для подписи: «2-е». */
export const placeText = (n) => `${n}-е`;
/** Изменение рейтинга со знаком: «+12», «-7», «0». */
export const signed = (n) => (n > 0 ? `+${n}` : String(n));

const two = (n) => String(n).padStart(2, '0');
/** День по времени в мс: «20.03.2026» (по часам браузера). */
export function dayText(at) {
  const d = new Date(at);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}
/** День партии из «2026-11-13»: «13.11». */
export const shortDay = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Строка под именем: с какого дня играет. */
export function sinceText(p) {
  if (p.since) return `играет с ${dayText(p.since)}`;
  if (p.joinedAt) return `на сайте с ${dayText(p.joinedAt)}`;
  return '';
}

const tile = (value, label, note = '') => `<div><b>${value}</b><span>${label}</span>${note ? `<small>${note}</small>` : ''}</div>`;

/** Четыре числа: рейтинг, партии, победы, среднее место. */
export function numsHTML(p) {
  const r = p.rating;
  const rating = r
    ? tile(r.value, 'рейтинг', `${placeText(r.rank)} место из ${r.of}${r.last ? `, последняя партия ${signed(r.last)}` : ''}`)
    : tile('нет', 'рейтинг', 'появится после партии с людьми');
  return rating
    + tile(p.games, 'партий', p.games ? `за неделю ${p.week}` : '')
    + tile(p.wins, 'побед', p.pct == null ? '' : `${p.pct}% партий`)
    + tile(p.avgPlace == null ? 'нет' : oneDec(p.avgPlace), 'среднее место');
}

/** Где играл: одна строка. */
export function whereHTML(p) {
  if (!p.games) return '<p class="muted">Партий пока нет. Первую можно сыграть с ботами: «Начать игру».</p>';
  return `<p class="pfwhere"><span class="muted">Где играл:</span> с людьми <b>${p.where.people}</b> | с ботами <b>${p.where.bots}</b> | BGA <b>${p.where.bga}</b></p>`;
}

/** Последние партии: день, вид, состав с местами, свое место, ссылка на стол сайта. */
export function recentHTML(p) {
  if (!p.recent.length) return '';
  const rows = p.recent.map((g) => {
    const seats = g.seats.map((s) => `${s.self ? '<b>' : ''}${esc(s.name || 'Бот')} ${s.place}${s.self ? '</b>' : ''}`).join(', ');
    const table = g.code ? `<a href="#/t/${esc(g.code)}">стол</a>` : '';
    return `<li><span class="pfday">${shortDay(g.date)}</span><span class="pfgrp">${esc(g.group)}</span><span class="pfseats">${seats}</span><span class="pfplace">${placeText(g.place)} из ${g.of}</span><span class="pftab">${table}</span></li>`;
  }).join('');
  return `<h2>Последние партии</h2><ul class="pfrecent">${rows}</ul>`;
}
