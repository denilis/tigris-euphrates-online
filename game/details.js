// Подробности партии для статистики турнира (этап 2 пакета 04.11): очки по цветам, откуда очки,
// бои в атаке и защите, монументы, катастрофы, самый сильный бой. Один формат для партий сайта
// (считается по журналу) и для партий BGA (tools/season-details.mjs из логов tigris-bot).
//
// Подробности игрока:
//   c:   очки по цветам [красный, синий, зеленый, черный] без сокровищ
//   tr:  сокровища
//   src: { tile, building, monument, war, revolt } — откуда очки
//   war, revolt: [выиграл в атаке, проиграл в атаке, выиграл в защите, проиграл в защите]
//   mon: построено монументов (чудо считается), cat: сыграно катастроф
//   big: самая большая сила в одном бою (поле + рука) или 0, если боев не было

export const emptyDetails = () => ({
  c: [0, 0, 0, 0], tr: 0, src: { tile: 0, building: 0, monument: 0, war: 0, revolt: 0 },
  war: [0, 0, 0, 0], revolt: [0, 0, 0, 0], mon: 0, cat: 0, big: 0,
});

/**
 * Подробности по журналу партии сайта и ее итогу: { [место]: подробности }.
 * result.seats — [{ seatId, score, treasures }] из t.game.result.
 */
export function gameDetails(log, result) {
  const out = {};
  // у старых итогов (и в тестах с выдуманным итогом) очков по цветам нет: подробностей тоже нет
  if (!result?.seats?.length || result.seats.some((r) => !Array.isArray(r.score))) return out;
  for (const r of result.seats) {
    const d = emptyDetails();
    d.c = [...r.score];
    d.tr = r.treasures ?? 0;
    out[r.seatId] = d;
  }
  const at = (seat) => out[seat] || (out[seat] = emptyDetails());
  for (const e of log) {
    if (e.ev === 'war' || e.ev === 'revolt') {
      const key = e.ev;
      const attWon = e.winner === e.att;
      at(e.att)[key][attWon ? 0 : 1]++;
      at(e.def)[key][attWon ? 3 : 2]++;
      // сила стороны: итог боя (в записях до 29.10 только он и есть)
      if (Number.isFinite(e.attTotal)) at(e.att).big = Math.max(at(e.att).big, e.attTotal);
      if (Number.isFinite(e.defTotal)) at(e.def).big = Math.max(at(e.def).big, e.defTotal);
    } else if (e.ev === 'monument' || e.ev === 'wonder') at(e.seat).mon++;
    else if (e.ev === 'catastrophe') at(e.seat).cat++;
    else if (e.ev === 'score') {
      const s = at(e.seat).src;
      // доплата здания приходит одной записью с тайлом: два очка вместо одного
      if (e.why === 'tile') {
        s.tile += Math.min(e.n, 1);
        s.building += Math.max(0, e.n - 1);
      } else if (e.why === 'monument' || e.why === 'wonder') s.monument += e.n;
      else if (e.why === 'war') s.war += e.n;
      else if (e.why === 'revolt') s.revolt += e.n;
    }
  }
  return out;
}
