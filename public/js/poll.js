// Как часто спрашивать сервер о столе. Каждый опрос стоит одну команду Upstash, поэтому
// быстро опрашиваем только там, где ход может прийти от других: чужой ход, бот, окно
// подтверждения. В свой ход чужие ничего не меняют, а свои действия возвращают вид сразу.
// Без DOM, чтобы проверять тестами.

const HIDDEN_LIMIT_MS = 30 * 60 * 1000; // забытая вкладка за месяц съела бы половину лимита базы

/**
 * Пауза до следующего опроса в мс, null: не опрашивать, пока вкладку не откроют.
 * view — последний вид стола (или null), hidden — вкладка скрыта, hiddenMs — сколько она скрыта.
 */
export function pollDelay(view, hidden, hiddenMs = 0) {
  if (hidden && hiddenMs >= HIDDEN_LIMIT_MS) return null;
  if (!view) return hidden ? 10000 : 1200;
  if (view.status === 'closed') return hidden ? 60000 : 30000;
  if (view.status === 'over') return hidden ? 60000 : (view.next ? 30000 : 5000); // 5 с: вдруг кто-то нажал «Ещё партию»
  if (hidden) return 10000;
  const g = view.game;
  if (view.status !== 'playing' || !g) return 2000;
  if (g.clock?.confirmBy) return 1200; // срок окна выйдет, и кто-то должен завершить ход
  const decider = view.seats?.find((s) => s.id === g.toMove);
  if (decider?.kind === 'bot') return 1200;
  return g.toMove === view.me ? 5000 : 2000;
}
