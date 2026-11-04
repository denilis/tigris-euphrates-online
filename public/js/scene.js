// Стартовая картинка по очереди (просьба Дениса 04.11): при каждой загрузке сайта летняя сцена
// с роликом-заставкой и зимняя сменяют друг друга. Зимнего ролика нет, поэтому зимой фоном
// неподвижная картинка, а кнопки «Остановить видео» нет.
export const SCENES = {
  summer: { img: '/img/lobby-bg.jpg', video: '/media/zastavka.mp4' },
  winter: { img: '/img/lobby-bg-winter.jpg', video: null },
};

const KEY = 'tigris.scene';

/** Сцена этой загрузки: не та, что была в прошлый раз (первая зимняя); выбор запоминается. */
export function pickScene(store = globalThis.localStorage) {
  let prev = null;
  try { prev = store?.getItem(KEY) ?? null; } catch { /* приватный режим: памяти нет */ }
  const next = prev === 'winter' ? 'summer' : 'winter';
  try { store?.setItem(KEY, next); } catch { /* приватный режим: памяти нет */ }
  return next;
}
