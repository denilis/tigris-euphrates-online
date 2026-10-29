// Ход боя (просьба Дениса 29.10, как на BGA): после войны и восстания видно, сколько тайлов
// у каждой стороны было на поле и сколько выложено из руки, итог и победитель. Особенно нужно,
// когда отбивается бот: он отвечает сразу, без окна, и иначе его поддержку не увидеть.
import { HEX, COLNAME, COLDAT, LEADER, LEADERACC, tileImg, tokenImg, esc, plural } from './util.js';

/** Бои в журнале начиная с записи from: { i, e, points, removed }. */
export function battlesIn(log, from = 0) {
  const out = [];
  for (let i = from; i < log.length; i++) {
    const e = log[i];
    if (e.ev !== 'war' && e.ev !== 'revolt') continue;
    let points = 1, removed = 0;
    if (e.ev === 'war') {
      // очки победителя войны (1 + снятые тайлы) движок пишет отдельной записью сразу после боя
      for (let j = i + 1; j < log.length && !['war', 'revolt', 'warStart'].includes(log[j].ev); j++) {
        if (log[j].ev === 'score' && log[j].why === 'war') { points = log[j].n; removed = log[j].n - 1; break; }
      }
    }
    out.push({ i, e, points, removed });
  }
  return out;
}

const STEP = 0.18; // секунды между тайлами из руки

/** Карточка одного боя. Тайлы из руки выкладываются по очереди: сначала атака, потом защита. */
export function battleCard({ e, points, removed }, view) {
  const seat = (id) => view.seats.find((s) => s.id === id);
  const name = (id) => esc(seat(id)?.name || 'Бот') + (id === view.me ? ' (вы)' : '');
  const revolt = e.ev === 'revolt';
  const lc = e.color; // цвет лидеров
  const tc = revolt ? 0 : lc; // цвет тайлов: в восстании храмы
  const full = e.attBoard != null; // в записях до 29.10 сторон нет, только итог
  const attFrom = 0.45, defFrom = attFrom + (e.attN || 0) * STEP + 0.35;
  const end = defFrom + (e.defN || 0) * STEP + 0.2;
  const tiles = (n, cls, from) => Array.from({ length: n }, (_, j) =>
    `<i class="mt ${cls}" style="--d:${(from + j * STEP).toFixed(2)}s;background-image:url(${tileImg(tc)})"></i>`).join('');
  const side = (id, role, cls, board, add, total, from) => `
    <div class="sbox ${cls} ${id === e.winner ? 'win' : 'lose'}" style="--w:${(end + 0.2).toFixed(2)}s">
      <div class="shead">
        <div class="stok" style="border-color:${HEX[lc]};background-image:url(${tokenImg(seat(id)?.hero, lc)})"></div>
        <div class="sname"><span class="role">${role}</span><b>${name(id)}</b></div>
        <div class="stot" style="--d:${end.toFixed(2)}s">${total}</div>
      </div>${full ? `
      <div class="trow"><span>${revolt ? 'храмы рядом' : 'на поле'}</span><div class="tiles">${board ? tiles(board, 'brd', 0.1) : '<em>нет</em>'}</div></div>
      <div class="trow"><span>из руки</span><div class="tiles">${add ? tiles(add, 'sent', from) : '<em>ничего</em>'}</div></div>` : ''}
    </div>`;
  const lost = !revolt && removed ? ` и ${removed} ${plural(removed, tc)}` : '';
  const tie = e.attTotal === e.defTotal ? 'Ничья, побеждает защитник. ' : '';
  const title = revolt ? `Восстание: ${LEADER[lc]}` : `Война за ${COLNAME[lc]}`;
  return `<div class="bcard">
    <div class="bhead"><i style="background:${HEX[lc]}"></i><b>${title}</b><small>ход ${e.turn}</small></div>
    <div class="sides">
      ${side(e.att, 'атака', 'att', e.attBoard, e.attN, e.attTotal, attFrom)}
      ${side(e.def, 'защита', 'def', e.defBoard, e.defN, e.defTotal, defFrom)}
    </div>
    <p class="bres" style="--d:${(end + 0.2).toFixed(2)}s">${tie}Победа: ${name(e.winner)}, +${points} к ${COLDAT[tc]}. ${name(e.loser)} теряет ${LEADERACC[lc]}${lost}.</p>
  </div>`;
}
