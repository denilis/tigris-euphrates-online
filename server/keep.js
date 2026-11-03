// Законченные партии хранятся бессрочно (решение Дениса 03.11). Раньше стол жил 90 дней после
// последней записи, а в истории не было кода стола. Один раз после выкладки снимаем срок с уже
// законченных столов и дописываем код в их записи истории, чтобы статистика вела на стол.
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
