// Статистика партии по журналу, как таблица в конце партии на BGA: чистые функции без DOM.

const zero = () => ({
  revoltWinAtt: 0, revoltWinDef: 0, revoltLoseAtt: 0, revoltLoseDef: 0,
  warWinAtt: 0, warWinDef: 0, warLoseAtt: 0, warLoseDef: 0,
  monuments: 0, catastrophes: 0, ptsMonument: 0, ptsWar: 0, ptsRevolt: 0, ptsTile: 0,
});

/** Сколько ходов сделал игрок на месте i очереди из n, если партия закончилась на ходе total. */
export const turnsOf = (i, n, total) => (total > i ? Math.floor((total - 1 - i) / n) + 1 : 0);

/** Подсчет по журналу партии: { [место]: счетчики }. Чудо считается монументом. */
export function matchStats(log, seats) {
  const out = Object.fromEntries(seats.map((s) => [s, zero()]));
  for (const e of log) {
    if (e.ev === 'revolt' || e.ev === 'war') {
      const head = e.ev === 'revolt' ? 'revolt' : 'war';
      out[e.winner][`${head}Win${e.winner === e.att ? 'Att' : 'Def'}`]++;
      out[e.loser][`${head}Lose${e.loser === e.att ? 'Att' : 'Def'}`]++;
    } else if (e.ev === 'monument' || e.ev === 'wonder') out[e.seat].monuments++;
    else if (e.ev === 'catastrophe') out[e.seat].catastrophes++;
    else if (e.ev === 'score') {
      const key = { monument: 'ptsMonument', wonder: 'ptsMonument', war: 'ptsWar', revolt: 'ptsRevolt', tile: 'ptsTile' }[e.why];
      if (key) out[e.seat][key] += e.n;
    }
  }
  return out;
}

/** Строки таблицы: подпись и значение игрока по его счетчикам s и строке итога r. */
export const STAT_ROWS = [
  ['Красные очки', (s, r) => r.score[0]],
  ['Черные очки', (s, r) => r.score[3]],
  ['Зеленые очки', (s, r) => r.score[2]],
  ['Синие очки', (s, r) => r.score[1]],
  ['Сокровища', (s, r) => r.treasures],
  ['Восстания, выигранные как атакующий', (s) => s.revoltWinAtt],
  ['Восстания, выигранные как защитник', (s) => s.revoltWinDef],
  ['Восстания, проигранные как атакующий', (s) => s.revoltLoseAtt],
  ['Восстания, проигранные как защитник', (s) => s.revoltLoseDef],
  ['Войны, выигранные как атакующий', (s) => s.warWinAtt],
  ['Войны, выигранные как защитник', (s) => s.warWinDef],
  ['Войны, проигранные как атакующий', (s) => s.warLoseAtt],
  ['Войны, проигранные как защитник', (s) => s.warLoseDef],
  ['Построено монументов', (s) => s.monuments],
  ['Сыграно катастроф', (s) => s.catastrophes],
  ['Очки за монументы', (s) => s.ptsMonument],
  ['Очки за войны', (s) => s.ptsWar],
  ['Очки за восстания', (s) => s.ptsRevolt],
];
