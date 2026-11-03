// Журнал партии по полочкам (просьба Дениса 03.11): действия строкой, каждый бой мини-таблицей
// (поле + рука = итог у каждой стороны), очки сводкой по игрокам цветными плашками.
// Чистые функции без DOM, их проверяют тесты.
import { HEX, COLNAME, COLGEN, TILE, LEADER, cellName, esc } from './util.js';

/**
 * Записи журнала → строки по действиям: { turn, actor, cell, parts, wars, pts } от старых к новым.
 * name(seat) — имя места: в журнале имена, а не «вы», так читаются обороты про бой.
 */
export function logLines(log, name) {
  const lines = [];
  let key = null, line = null;
  for (let li = 0; li < log.length; li++) {
    const e = log[li];
    const k = `${e.turn}:${e.actor}:${e.action}`;
    if (k !== key) {
      key = k;
      line = { turn: e.turn, actor: e.actor, parts: [], wars: [], pts: [], cell: null, unite: false };
      lines.push(line);
    }
    switch (e.ev) {
      case 'unite': line.unite = true; break;
      case 'tile':
        line.parts.push(`${TILE[e.c]} ${cellName(e.pos)}${line.unite ? ', объединение' : ''}`);
        line.unite = false;
        line.cell ??= e.pos;
        break;
      case 'undo': line.parts.push('отмена действия'); key = null; break;
      case 'leader': line.parts.push(`${LEADER[e.c]} ${e.from >= 0 ? 'переставлен на' : 'на'} ${cellName(e.pos)}`); line.cell ??= e.pos; break;
      case 'withdraw': line.parts.push(`${LEADER[e.c]} в руку`); break;
      case 'catastrophe': line.parts.push(`катастрофа ${cellName(e.pos)}`); line.cell = e.pos; break;
      case 'discard': line.parts.push(`сброс ${e.n}`); break;
      case 'war':
      case 'revolt':
        line.wars.push({
          i: li, kind: e.ev, color: e.color, att: e.att, def: e.def, winner: e.winner,
          attBoard: e.attBoard, attN: e.attN, attTotal: e.attTotal, defBoard: e.defBoard, defN: e.defN, defTotal: e.defTotal,
          // ходящий без лидера этого цвета в войне не участвует: атакует следующий по очереди
          note: e.ev === 'war' && e.att !== e.actor ? `У ходящего (${name(e.actor)}) нет ${COLGEN[e.color]} лидера, атакует следующий по очереди.` : '',
        });
        break;
      case 'monument': line.parts.push('монумент'); line.cell = e.tl; break;
      case 'wonder': line.parts.push('чудо'); line.cell = e.center; break;
      case 'building': line.parts.push(`здание «${TILE[e.c]}»`); line.cell = e.pos; break;
      case 'treasure': line.parts.push(`${name(e.seat)}: сокровище`); break;
      case 'leaderReturned': line.parts.push(`${LEADER[e.c]} (${name(e.seat)}) уходит с поля`); break;
      case 'score': line.pts.push(e); break;
      case 'gameOver': line.parts.push('конец партии'); break;
      default: break;
    }
  }
  return lines;
}

const WHY = { monument: 'монумент', wonder: 'чудо' };

const chip = (p) => `<span class="pchip${p.c === 3 ? ' k' : ''}" style="background:${HEX[p.c]}" title="${COLNAME[p.c]}${WHY[p.why] ? `, за ${WHY[p.why]}` : ''}">+${p.n}${WHY[p.why] ? ` <small>${WHY[p.why]}</small>` : ''}</span>`;

function warHTML(w, name) {
  const tie = w.attTotal === w.defTotal;
  const sum = (board, n, total) => (board != null ? `${board} + ${n} = ${total}` : String(total));
  const row = (id, role, board, n, total) => {
    const won = id === w.winner;
    return `<tr${won ? ' class="win"' : ''}><td>${esc(name(id))}</td><td>${role}</td><td>${sum(board, n, total)}</td><td>${won ? (tie ? 'ничья, победа' : 'победа') : ''}</td></tr>`;
  };
  const title = w.kind === 'revolt' ? `Восстание: ${LEADER[w.color]}` : `Война за ${COLNAME[w.color]}`;
  return `<div class="lwar"><div class="lwt"><i class="cdot" style="background:${HEX[w.color]}"></i>${title}<button class="lb" data-battle="${w.i}" title="Показать бой">бой</button></div>
    <table class="lwtab">${row(w.att, 'атака', w.attBoard, w.attN, w.attTotal)}${row(w.def, 'защита', w.defBoard, w.defN, w.defTotal)}</table>${
    w.note ? `<div class="lnote">${esc(w.note)}</div>` : ''}</div>`;
}

/** Строка журнала. Простое действие с очками ходящего остается одной строкой, иначе очки сводкой по игрокам. */
export function lineHTML(l, name) {
  const simple = !l.wars.length && l.pts.every((p) => p.seat === l.actor);
  const head = `<u>${esc(name(l.actor))}:</u> ${esc(l.parts.join(', '))}`;
  if (simple) return `<div class="lline">${head}${l.pts.length ? ' ' + l.pts.map(chip).join(' ') : ''}</div>`;
  const seats = [...new Set(l.pts.map((p) => p.seat))];
  const pts = seats.length
    ? `<div class="lpts">${seats.map((s) => `<span class="lpw">${esc(name(s))}</span><span>${l.pts.filter((p) => p.seat === s).map(chip).join('')}</span>`).join('')}</div>`
    : '';
  return `<div class="lline">${head}</div>${l.wars.map((w) => warHTML(w, name)).join('')}${pts}`;
}
