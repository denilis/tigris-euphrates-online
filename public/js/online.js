// Кто на сайте: расчеты без DOM, их проверяют тесты.

const SEEN_MS = 20 * 1000; // на виду: новости доходят за это время
const QUIET_MS = 60 * 1000; // в партии и на скрытой вкладке приглашения ждать незачем так часто
const HIDDEN_LIMIT_MS = 30 * 60 * 1000; // забытая вкладка не должна съедать лимит базы

/** Через сколько следующий пульс; null, если вкладка скрыта слишком давно. hiddenMs: null, пока вкладка на виду. */
export function beatDelay({ hiddenMs, busy }) {
  if (hiddenMs != null) return hiddenMs >= HIDDEN_LIMIT_MS ? null : QUIET_MS;
  return busy ? QUIET_MS : SEEN_MS;
}

/** Кто появился по сравнению с прошлым пульсом; первый пульс никого не объявляет. */
export function arrivals(prev, next) {
  if (!prev) return [];
  const had = new Set(prev.map((p) => p.id));
  return next.filter((p) => !had.has(p.id));
}

/** Приглашения, на которые на этом устройстве еще не ответили. */
export const pendingInvites = (inbox, handled) => inbox.filter((m) => m.kind === 'invite' && !handled.has(m.id));

/** Номер первого свободного места для человека или null. */
export function freeSeat(view) {
  return view.seats.find((s) => s.kind === 'human' && !s.taken)?.id ?? null;
}
