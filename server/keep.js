// Законченные партии хранятся бессрочно (решение Дениса 03.11). Раньше стол жил 90 дней после
// последней записи, а в истории не было кода стола. Один раз после выкладки снимаем срок с уже
// законченных столов и дописываем код в их записи истории, чтобы статистика вела на стол.
import { gameDetails } from '../game/details.js';

const FLAG = 'keep-finished-1';

/** Сколько столов обработано; 0, если миграция уже прошла. Повтор безопасен. */
export async function keepFinishedOnce(store) {
  if (await store.getFlag(FLAG)) return 0;
  let n = 0;
  for (const code of await store.tableCodes()) {
    const r = await store.getTable(code);
    if (r?.doc.status !== 'over' || !r.doc.game?.id) continue;
    await store.keepTable(code);
    await store.patchHistory(r.doc.game.id, { code });
    n++;
  }
  await store.setFlag(FLAG);
  return n;
}

// Подробности партии для статистики турнира (этап 2, 04.11) пишутся в историю в конце партии.
// У партий, законченных раньше, их нет: один раз считаем по журналу их стола.
const DETAILS_FLAG = 'details-1';

/** Сколько записей истории дополнено; 0, если уже было. Повтор безопасен. */
export async function detailsOnce(store) {
  if (await store.getFlag(DETAILS_FLAG)) return 0;
  let n = 0;
  for (const e of await store.listHistory()) {
    if (!e.code || e.seats.every((s) => s.d)) continue;
    const r = await store.getTable(e.code);
    const g = r?.doc.game;
    if (r?.doc.status !== 'over' || g?.id !== e.id || !g.result) continue;
    const det = gameDetails(g.log, g.result);
    await store.patchHistory(e.id, { seats: e.seats.map((s) => ({ ...s, d: det[s.seatId] })) });
    n++;
  }
  await store.setFlag(DETAILS_FLAG);
  return n;
}
