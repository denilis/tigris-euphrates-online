// Стартовая картинка по очереди (просьба Дениса 04.11): при каждой загрузке сайта летняя сцена
// и зимняя сменяют друг друга. Сцена без ролика: фоном неподвижная картинка, кнопки «Остановить
// видео» нет. 15.11 обе сцены стали фото (Gemini), Денис: «Фото без видео». Прежний летний ролик
// media/zastavka.mp4 сделан с картины и к фото не подходит; новый ролик ставится сюда в video.
export const SCENES = {
  summer: { img: '/img/lobby-bg.jpg', video: null },
  winter: { img: '/img/lobby-bg-winter2.jpg', video: null }, // с 15.11 фото Дениса (Gemini) вместо картины 04.11
};

/** Есть ли ролик хоть у одной сцены: без него выбор «видео / картинка» в профиле не нужен. */
export const ANY_VIDEO = Object.values(SCENES).some((s) => Boolean(s.video));

const KEY = 'tigris.scene';

/** Сцена этой загрузки: не та, что была в прошлый раз (первая зимняя); выбор запоминается. */
export function pickScene(store = globalThis.localStorage) {
  let prev = null;
  try { prev = store?.getItem(KEY) ?? null; } catch { /* приватный режим: памяти нет */ }
  const next = prev === 'winter' ? 'summer' : 'winter';
  try { store?.setItem(KEY, next); } catch { /* приватный режим: памяти нет */ }
  return next;
}
