// Учебный стол для экскурсии «Начать партию и настроить стол» (Денис 05.11): настоящий стол в лобби,
// собранный кодом сайта, чтобы экскурсия показывала ту же страницу, что видит хозяин стола.
// Хозяин Ученик, за столом Соперник, одно место свободно, одно у бота. Собирает tools/build-lessons.js.
import { createTable, sit, setHero } from '../game/table.js';
import { viewFor } from '../game/view.js';

export function tourLobby() {
  const host = { userId: 'student', name: 'Ученик' };
  const t = createTable({ code: 'UCHEBA', title: 'Учебный', host, now: 0 });
  sit(t, { userId: 'rival', name: 'Соперник' }, 1, 0);
  setHero(t, host.userId, 0, 'lion', 0);
  setHero(t, 'rival', 1, 'bull', 0);
  return { ...viewFor(t, host.userId, { now: 0 }), version: 0 };
}
