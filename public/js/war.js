// Окно конфликта (решения Дениса 28.10): встает справа вместо боковой панели, поле видно,
// но не нажимается, партия ждет решения. Поддержка выбирается тайлами в руке, исход каждого
// варианта считает сервер (view.game.preview). Восстание и выбор цвета войны — здесь же.
import {
  HEX, COLNAME, SCORE_ORDER, COLGEN, COLDAT, TILE, TILEPL, TILEDAT, TILEACCPL, LEADER, LEADERACC, tileImg, tokenImg, cellName, esc, plural, finalScore,
} from './util.js';

const PHASES = ['warSupport', 'revoltSupport', 'warChoose'];

export function warActive(view) {
  const g = view.game;
  return Boolean(g && g.legal && !g.over && PHASES.includes(g.phase));
}

/** Бой в фазе поддержки, который смотрящий сам сейчас не решает; null, если такого нет. */
function openConflict(view) {
  const g = view.game;
  if (!g || g.legal || g.over || g.stopped) return null;
  return (g.phase === 'revoltSupport' ? g.ctx?.revolt : g.phase === 'warSupport' ? g.ctx?.war : null) || null;
}

/** Бой идет, решает соперник, а смотрящий в нем участвует: окно остается, только без решений. */
export function warWaiting(view) {
  const k = openConflict(view);
  return Boolean(k) && view.me != null && (k.att === view.me || k.def === view.me);
}

/**
 * Бой идет без смотрящего (просьба Дениса 03.11): третий игрок и зритель видят то же окно,
 * что ждущий участник: силу сторон на поле и тайлы атаки, как только атакующий их отправил.
 */
export function warWatching(view) {
  const k = openConflict(view);
  return Boolean(k) && k.att !== view.me && k.def !== view.me;
}

/** Нарисовать окно в box; вернуть 'decide', если решает смотрящий, 'wait', если он ждет, 'watch', если смотрит чужой бой, иначе false. */
export function renderWarDock(box, view, ui, { move, redraw, undo }) {
  const active = warActive(view), watch = warWatching(view);
  box.hidden = !active && !watch && !warWaiting(view);
  if (box.hidden) return false;
  const state = active ? 'decide' : watch ? 'watch' : 'wait';
  const g = view.game, me = view.me, legal = g.legal;
  const seat = (id) => view.seats.find((s) => s.id === id);
  const name = (id) => (id === me ? 'Вы' : seat(id)?.name || 'Бот');

  if (ui.collapsed) {
    box.className = 'modal pill';
    box.innerHTML = `<span class="dotc" style="background:${HEX[g.ctx.war?.color ?? 0]}"></span><b>${g.phase === 'revoltSupport' ? 'Восстание' : 'Война'}</b><span>${active ? 'Партия ждет вашего решения' : `Ждём решения: ${esc(name(g.toMove))}`}</span><button class="btn primary" id="wExpand">Развернуть</button>`;
    box.querySelector('#wExpand').addEventListener('click', () => { ui.collapsed = false; redraw(); });
    return state;
  }
  box.className = 'modal dock';
  // нападение не отменяется (решение Дениса 04.11): кнопки «Отменить нападение» нет

  // --- выбор, какая война первой
  if (g.phase === 'warChoose') {
    const pv = g.preview;
    const rows = pv.options.map((o) => {
      const i = legal.findIndex((m) => m.type === 'warColor' && m.color === o.color);
      return `<button class="orow pick" data-idx="${i}"><b><i class="cdot" style="background:${HEX[o.color]}"></i>Война за ${COLNAME[o.color]}</b>
        <span>Атакует ${esc(name(o.att))} (${TILEPL[o.color]} на поле ${o.attBoard}), защищается ${esc(name(o.def))} (${o.defBoard}).</span></button>`;
    }).join('');
    box.innerHTML = `<div class="mcard" role="dialog" aria-label="Выбор войны">
      <div class="mtop"><h2>Какая война первая?</h2><button class="peekbtn" id="wCollapse">Свернуть</button></div>
      <p class="msub">Тайл на ${cellName(g.ctx.pos)} объединил царства, где сошлись лидеры сразу нескольких цветов. Остальные войны пойдут следом.</p>
      <div class="orows">${rows}</div>
      <div class="mfoot"><div class="mnote">Пока вы не решите, партия стоит.</div></div>
    </div>`;
    box.querySelectorAll('[data-idx]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.idx)));
    box.querySelector('#wCollapse').addEventListener('click', () => { ui.collapsed = true; redraw(); });
    return state;
  }

  // --- поддержка в войне или восстании
  const isRevolt = g.phase === 'revoltSupport';
  const k = isRevolt ? g.ctx.revolt : g.ctx.war;
  const color = isRevolt ? 0 : k.color; // в восстании поддержка храмами
  const isAtt = k.attN === null; // решает атакующий
  const iAtt = k.att === me, iDef = k.def === me;
  const myP = g.order.indexOf(me);
  const pl = g.players[myP];
  const opp = iAtt ? k.def : k.att;
  const tiles = (cnt, cls = '') => Array.from({ length: cnt }, () => `<i class="mt ${cls}" style="background-image:url(${tileImg(color)})"></i>`).join('');
  const side = (id, role, cls, board, add, total, mine, note) => `
    <div class="sbox ${cls}${mine ? ' mine' : ''}">
      <div class="shead">
        <div class="stok" style="border-color:${HEX[isRevolt ? k.leaderColor : color]};background-image:url(${tokenImg(seat(id)?.hero, isRevolt ? k.leaderColor : color)})"></div>
        <div class="sname"><span class="role">${role}</span><b>${esc(name(id))}</b></div>
        <div class="stot">${note ? `${board}<small>+?</small>` : total}</div>
      </div>
      <div class="trow"><span>${isRevolt ? 'храмы рядом' : 'на поле'}</span><div class="tiles">${tiles(board)}</div></div>
      <div class="trow"><span>из руки</span><div class="tiles add">${
        note ? `<em>${note}</em>` : add > 0 ? tiles(add, 'sent') : mine && active ? '<em>нажмите тайлы в руке ниже</em>' : '<em>ничего</em>'}</div></div>
    </div>`;

  const title = isRevolt ? `Восстание: ${LEADER[k.leaderColor]}` : `Война за ${COLNAME[color]}`;
  const who = watch ? `Атакует ${esc(name(k.att))}, защищается ${esc(name(k.def))}.`
    : iAtt ? `Вы атакуете, защищается ${esc(name(opp))}.` : `Атакует ${esc(name(opp))}, вы защищаетесь.`;
  const cause = !isRevolt && g.ctx.unite ? `Тайл на ${cellName(g.ctx.pos)} объединил два царства. ` : '';
  // ходящий без лидера этого цвета в войне не участвует: атакует следующий по очереди участник
  const why = !isRevolt && k.att !== g.cur ? ` У ходящего (${esc(name(g.cur))}) нет ${COLGEN[color]} лидера в этих царствах, поэтому атакует следующий по очереди участник.` : '';
  const strength = isRevolt ? 'Сила по храмам рядом с лидером и храмам из руки.' : `Сила по ${TILEDAT[color]}, стороны подсвечены на поле.`;
  const top = `<div class="mtop"><h2><i style="background:${HEX[isRevolt ? k.leaderColor : color]}"></i>${title}</h2><button class="peekbtn" id="wCollapse">Свернуть</button></div>
    <p class="msub">${cause}${who}${why} ${strength}</p>`;

  // решает соперник или смотрим чужой бой: видно, что уже известно всем, руки и исхода здесь нет
  if (!active) {
    const attSide = isAtt ? side(k.att, 'атака', 'att', k.attBoard, 0, k.attBoard, iAtt, 'решает') : side(k.att, 'атака', 'att', k.attBoard, k.attN, k.attBoard + k.attN, iAtt, null);
    const defSide = side(k.def, 'защита', 'def', k.defBoard, 0, k.defBoard, iDef, isAtt ? (iDef ? 'вы ответите следом' : 'ответит следом') : 'решает');
    box.innerHTML = `<div class="mcard" role="dialog" aria-label="${title}">
      ${top}
      <div class="sides">${attSide}${defSide}</div>
      <div class="mfoot"><div class="mnote">Ждём решения: ${esc(name(g.toMove))}.</div></div>
    </div>`;
    box.querySelector('#wCollapse').addEventListener('click', () => { ui.collapsed = true; redraw(); });
    return state;
  }

  const legalNs = legal.map((m) => m.n);
  const n = ui.chosen.size;
  const ok = legalNs.includes(n);
  const attAdd = isAtt ? n : k.attN;
  const attTot = k.attBoard + attAdd, defTot = k.defBoard + (isAtt ? 0 : n);

  let hand = '', idx = 0;
  for (let c = 0; c < 4; c++) for (let j = 0; j < g.hand[c]; j++, idx++) {
    const on = ui.chosen.has(idx), usable = c === color;
    hand += `<button class="ht2${on ? ' on' : ''}${usable ? '' : ' off'}" data-k="${idx}" ${usable ? '' : 'disabled'} title="${TILE[c]}" style="background-image:url(${tileImg(c)})">${on ? '<span>в бой</span>' : ''}</button>`;
  }

  // сведения для решения: мешок процентом, сокровища до конца, свои очки и итог по слабейшему
  const treasuresLeft = g.board.treasure.reduce((a, b) => a + b, 0);
  const myFinal = finalScore(pl.score, pl.treasures);
  const minC = Math.min(...pl.score);
  const chips = SCORE_ORDER.map((c) => `<span class="${pl.score[c] === minC ? 'weak' : ''}" style="background:${HEX[c]}" title="${COLNAME[c]}">${pl.score[c]}</span>`).join('');

  // подсказки с исходом каждого варианта убраны (Денис 04.11: «не понимаю смысла, не нужны»)

  const english = view.options.englishSupport;
  const allowed = legalNs.filter((x) => x > 0);
  const rule = english
    ? `Английская поддержка: ${isAtt ? 'атакующий добавляет, только если превысит защитника' : 'защитник добавляет ровно столько, чтобы сравнять'}${allowed.length ? `, сейчас можно ${allowed.join(' или ')}` : ', сейчас добавить нельзя'}.`
    : `Можно добавить от 0 до ${Math.max(...legalNs)}.`;
  box.innerHTML = `<div class="mcard" role="dialog" aria-label="${title}">
    ${top}
    <div class="sides">
      ${side(k.att, 'атака', 'att', k.attBoard, attAdd, attTot, isAtt, null)}
      ${side(k.def, 'защита', 'def', k.defBoard, isAtt ? 0 : n, defTot, !isAtt, isAtt ? 'ответит после вас' : null)}
    </div>
    <div class="myhand">
      <div class="hl2">Ваша рука, ${g.hand.reduce((a, b) => a + b, 0)} тайлов. Нажмите ${TILEACCPL[color]}, которые отправляете в поддержку:</div>
      <div class="htiles">${hand}</div>
      <div class="rule${ok ? '' : ' bad'}">${ok ? rule : `Так нельзя. ${rule}`}</div>
    </div>
    <div class="facts">
      <div><span>Мешок</span><b>${g.bagPct}%</b><small>тайлов осталось</small></div>
      <div><span>Сокровищ на поле</span><b>${treasuresLeft}</b><small>конец партии при 2</small></div>
      <div><span>Ваши очки</span><div class="sc2">${chips}<em title="сокровища">+${pl.treasures}</em></div><small>итог по слабейшему: ${myFinal}</small></div>
    </div>
    <div class="mfoot">
      <button class="btn" id="wZero">Не добавлять</button>
      <button class="btn primary" id="wSend"${n > 0 && ok ? '' : ' disabled'}>${n > 0 ? `Отправить ${n} ${plural(n, color)}` : 'Выберите тайлы в руке'}</button>
      <div class="mnote">Пока вы не решите, партия стоит.</div>
    </div>
  </div>`;

  box.querySelectorAll('.ht2:not(.off)').forEach((b) => b.addEventListener('click', () => {
    const key = +b.dataset.k;
    if (ui.chosen.has(key)) ui.chosen.delete(key); else ui.chosen.add(key);
    redraw();
  }));
  box.querySelector('#wCollapse').addEventListener('click', () => { ui.collapsed = true; redraw(); });
  box.querySelector('#wZero').addEventListener('click', () => move(legal.findIndex((m) => m.n === 0)));
  box.querySelector('#wSend').addEventListener('click', () => { if (n > 0 && ok) move(legal.findIndex((m) => m.n === n)); });
  return state;
}
