// Окно конфликта (решения Дениса 28.10): встает справа вместо боковой панели, поле видно,
// но не нажимается, партия ждет решения. Поддержка выбирается тайлами в руке, исход каждого
// варианта считает сервер (view.game.preview). Восстание и выбор цвета войны — здесь же.
import {
  HEX, COLNAME, COLGEN, COLDAT, TILE, TILEPL, TILEDAT, TILEACCPL, LEADER, LEADERACC, tileImg, tokenImg, cellName, esc, plural, finalScore,
} from './util.js';

const PHASES = ['warSupport', 'revoltSupport', 'warChoose'];

export function warActive(view) {
  const g = view.game;
  return Boolean(g && g.legal && !g.over && PHASES.includes(g.phase));
}

/** Нарисовать окно в box; вернуть true, если окно сейчас нужно. */
export function renderWarDock(box, view, ui, { move, redraw }) {
  const active = warActive(view);
  box.hidden = !active;
  if (!active) return false;
  const g = view.game, me = view.me, legal = g.legal;
  const seat = (id) => view.seats.find((s) => s.id === id);
  const name = (id) => (id === me ? 'Вы' : seat(id)?.name || 'Бот');

  if (ui.collapsed) {
    box.className = 'modal pill';
    box.innerHTML = `<span class="dotc" style="background:${HEX[g.ctx.war?.color ?? 0]}"></span><b>${g.phase === 'revoltSupport' ? 'Восстание' : 'Война'}</b><span>Партия ждет вашего решения</span><button class="btn primary" id="wExpand">Развернуть</button>`;
    box.querySelector('#wExpand').addEventListener('click', () => { ui.collapsed = false; redraw(); });
    return true;
  }
  box.className = 'modal dock';

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
    return true;
  }

  // --- поддержка в войне или восстании
  const isRevolt = g.phase === 'revoltSupport';
  const k = isRevolt ? g.ctx.revolt : g.ctx.war;
  const color = isRevolt ? 0 : k.color; // в восстании поддержка храмами
  const isAtt = k.attN === null;
  const myP = g.order.indexOf(me);
  const pl = g.players[myP];
  const opp = isAtt ? k.def : k.att;
  const legalNs = legal.map((m) => m.n);
  const n = ui.chosen.size;
  const ok = legalNs.includes(n);
  const attAdd = isAtt ? n : k.attN;
  const attTot = k.attBoard + attAdd, defTot = k.defBoard + (isAtt ? 0 : n);
  const tiles = (cnt, cls = '') => Array.from({ length: cnt }, () => `<i class="mt ${cls}" style="background-image:url(${tileImg(color)})"></i>`).join('');
  const side = (id, role, cls, board, add, total, mine, waiting) => `
    <div class="sbox ${cls}${mine ? ' mine' : ''}">
      <div class="shead">
        <div class="stok" style="border-color:${HEX[isRevolt ? k.leaderColor : color]};background-image:url(${tokenImg(seat(id)?.hero, isRevolt ? k.leaderColor : color)})"></div>
        <div class="sname"><span class="role">${role}</span><b>${esc(name(id))}</b></div>
        <div class="stot">${waiting ? `${board}<small>+?</small>` : total}</div>
      </div>
      <div class="trow"><span>${isRevolt ? 'храмы рядом' : 'на поле'}</span><div class="tiles">${tiles(board)}</div></div>
      <div class="trow"><span>из руки</span><div class="tiles add">${
        waiting ? '<em>ответит после вас</em>' : add > 0 ? tiles(add, 'sent') : mine ? '<em>нажмите тайлы в руке ниже</em>' : '<em>ничего</em>'}</div></div>
    </div>`;

  let hand = '', idx = 0;
  for (let c = 0; c < 4; c++) for (let j = 0; j < g.hand[c]; j++, idx++) {
    const on = ui.chosen.has(idx), usable = c === color;
    hand += `<button class="ht2${on ? ' on' : ''}${usable ? '' : ' off'}" data-k="${idx}" ${usable ? '' : 'disabled'} title="${TILE[c]}" style="background-image:url(${tileImg(c)})">${on ? '<span>в бой</span>' : ''}</button>`;
  }

  // сведения для решения: мешок процентом, сокровища до конца, свои очки и итог по слабейшему
  const treasuresLeft = g.board.treasure.reduce((a, b) => a + b, 0);
  const myFinal = finalScore(pl.score, pl.treasures);
  const minC = Math.min(...pl.score);
  const chips = pl.score.map((v, c) => `<span class="${v === minC ? 'weak' : ''}" style="background:${HEX[c]}" title="${COLNAME[c]}">${v}</span>`).join('');

  // точный исход каждого варианта (сервер прогнал движком)
  const rows = (g.preview?.options || []).map((o) => {
    const iWin = o.winner === me;
    const after = pl.score.slice();
    if (iWin) after[o.pointsColor] += o.points;
    const fin = finalScore(after, pl.treasures);
    const lost = o.removedTiles;
    const label = o.n === 0 ? 'Не добавлять' : `Добавить ${o.n}`;
    const leaderLost = isRevolt ? LEADERACC[k.leaderColor] : LEADERACC[color];
    let text = iWin
      ? `побеждаете вы: +${o.points} к ${COLDAT[o.pointsColor]}, ваш ${COLNAME[o.pointsColor]} ${pl.score[o.pointsColor]} станет ${after[o.pointsColor]}. ${esc(name(opp))} теряет ${leaderLost}${lost ? ` и ${lost} ${plural(lost, color)}` : ''}.`
      : `побеждает ${esc(name(o.winner))}: +${o.points} к ${COLDAT[o.pointsColor]}. Вы теряете ${leaderLost}${lost ? ` и ${lost} ${plural(lost, color)}` : ''}.`;
    if (o.leadersReturned.length) text += ` Без храма уходят с поля: ${o.leadersReturned.map((x) => `${LEADER[x.c]} (${esc(name(x.seat))})`).join(', ')}.`;
    const finText = fin === myFinal ? `итог по слабейшему не меняется: ${fin}` : `итог по слабейшему: ${myFinal}, станет ${fin}`;
    return `<div class="orow${n === o.n ? ' on' : ''}${iWin ? ' win' : ' lose'}"><b>${label}</b><span>${text}</span><small>${finText}</small></div>`;
  }).join('');

  const english = view.options.englishSupport;
  const allowed = legalNs.filter((x) => x > 0);
  const rule = english
    ? `Английская поддержка: ${isAtt ? 'атакующий добавляет, только если превысит защитника' : 'защитник добавляет ровно столько, чтобы сравнять'}${allowed.length ? `, сейчас можно ${allowed.join(' или ')}` : ', сейчас добавить нельзя'}.`
    : `Можно добавить от 0 до ${Math.max(...legalNs)}.`;
  const title = isRevolt ? `Восстание: ${LEADER[k.leaderColor]}` : `Война за ${COLNAME[color]}`;
  const who = isAtt ? `Вы атакуете, защищается ${esc(name(opp))}.` : `Атакует ${esc(name(opp))}, вы защищаетесь.`;
  const cause = !isRevolt && g.ctx.unite ? `Тайл на ${cellName(g.ctx.pos)} объединил два царства. ` : '';
  // ходящий без лидера этого цвета в войне не участвует: атакует следующий по очереди участник
  const why = !isRevolt && k.att !== g.cur ? ` У ходящего (${esc(name(g.cur))}) нет ${COLGEN[color]} лидера в этих царствах, поэтому атакует следующий по очереди участник.` : '';
  const strength = isRevolt ? 'Сила по храмам рядом с лидером и храмам из руки.' : `Сила по ${TILEDAT[color]}, стороны подсвечены на поле.`;

  box.innerHTML = `<div class="mcard" role="dialog" aria-label="${title}">
    <div class="mtop"><h2><i style="background:${HEX[isRevolt ? k.leaderColor : color]}"></i>${title}</h2><button class="peekbtn" id="wCollapse">Свернуть</button></div>
    <p class="msub">${cause}${who}${why} ${strength}</p>
    <div class="sides">
      ${side(k.att, 'атака', 'att', k.attBoard, attAdd, attTot, isAtt, false)}
      ${side(k.def, 'защита', 'def', k.defBoard, isAtt ? 0 : n, defTot, !isAtt, isAtt)}
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
    <div class="orows">${rows}</div>
    ${isAtt ? '<p class="msub">Исход посчитан на случай, если защитник ничего не добавит.</p>' : ''}
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
  return true;
}
