// Что можно нажать на поле: чистые функции без DOM, их проверяют тесты.

/** Четыре клетки монумента по левой верхней (ширина поля 16). */
export const squareCells = (tl) => [tl, tl + 1, tl + 16, tl + 17];

/** Цвет лидера на клетке i, которого игрок может взять: у него есть перестановка или возврат в руку. */
export function pickableLeader(player, legal, i) {
  if (i < 0) return null;
  const c = player.leaders.indexOf(i);
  if (c < 0) return null;
  return legal.some((m) => (m.type === 'leader' || m.type === 'withdraw') && m.color === c) ? c : null;
}

/** Клетки, где щелчок сработает: цели хода, места монумента, центры чуда и лидеры, которых можно взять. */
export function hitCells({ targets = [], squares = [], crosses = [] }, leaders = []) {
  return new Set([...targets, ...crosses, ...squares.flatMap(squareCells), ...leaders]);
}
