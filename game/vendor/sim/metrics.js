// Метрики стиля игры бота по событиям движка: то, что сильный игрок
// сразу назовёт «играет без стратегии».
//   catEarly     катастрофы в первые 6 кругов
//   relocations  перестановки лидера, уже стоящего на поле
//   attacks      начатые конфликты (восстания и войны как атакующий)
//   attackWins   из них выиграно
//   attackTiles  тайлов поддержки, выложенных атакующим

export function makeCollector(labelOf) {
  const per = new Map();
  const get = (label) => {
    if (!per.has(label)) {
      per.set(label, {
        seats: 0, wins: 0, minSum: 0, rankSum: 0,
        catEarly: 0, catTotal: 0, leaderMoves: 0, relocations: 0,
        attacks: 0, attackWins: 0, attackTiles: 0, revolts: 0, wars: 0,
      });
    }
    return per.get(label);
  };
  let warAtt = -1;

  return {
    onDecision(s, p, res) {
      if (s.phase !== 'revoltSupport' && s.phase !== 'warSupport') return;
      const k = s.phase === 'revoltSupport' ? s.ctx.revolt : s.ctx.war;
      if (k.attN === null && k.att === p) get(labelOf(p)).attackTiles += res.move.n;
    },
    onEvent(ev, s, turn, cur) {
      const round = Math.ceil(turn / s.np);
      switch (ev.ev) {
        case 'leader': {
          const st = get(labelOf(ev.p));
          st.leaderMoves++;
          if (ev.from >= 0) st.relocations++;
          break;
        }
        case 'catastrophe': {
          const st = get(labelOf(ev.p));
          st.catTotal++;
          if (round <= 6) st.catEarly++;
          break;
        }
        case 'revolt': {
          // восстание начинает только ходящий игрок, ставя лидера
          const st = get(labelOf(cur));
          st.attacks++;
          st.revolts++;
          if (ev.winner === cur) st.attackWins++;
          break;
        }
        case 'warStart': {
          warAtt = ev.att;
          const st = get(labelOf(ev.att));
          st.attacks++;
          st.wars++;
          break;
        }
        case 'war':
          if (warAtt >= 0 && ev.winner === warAtt) get(labelOf(warAtt)).attackWins++;
          warAtt = -1;
          break;
        default:
          break;
      }
    },
    /** В конце партии: места и минимальный счёт. ranking — индексы от победителя. */
    endGame(ranking, vectors) {
      ranking.forEach((p, place) => {
        const st = get(labelOf(p));
        st.seats++;
        st.rankSum += place;
        st.minSum += vectors[p][0];
        if (place === 0) st.wins++;
      });
    },
    table() {
      const rows = [];
      for (const [label, st] of per) {
        const n = Math.max(1, st.seats);
        rows.push({
          label,
          seats: st.seats,
          winRate: +(st.wins / n).toFixed(3),
          avgPlace: +(st.rankSum / n + 1).toFixed(2),
          avgMin: +(st.minSum / n).toFixed(2),
          catEarly: +(st.catEarly / n).toFixed(2),
          catTotal: +(st.catTotal / n).toFixed(2),
          relocations: +(st.relocations / n).toFixed(2),
          leaderMoves: +(st.leaderMoves / n).toFixed(2),
          attacks: +(st.attacks / n).toFixed(2),
          attackWinRate: st.attacks ? +(st.attackWins / st.attacks).toFixed(2) : null,
          tilesPerAttack: st.attacks ? +(st.attackTiles / st.attacks).toFixed(2) : null,
        });
      }
      return rows;
    },
  };
}
