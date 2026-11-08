// Полный экран (просьба Дениса 08.11): на планшете панели браузера (адрес, «Поиск», «Алиса», «Сайты»)
// закрывают низ поля. Кнопка в шапке прячет их и системные панели; вернуть: та же кнопка или «Назад».
// Подпись кнопки меняет CSS по :fullscreen (app.css), поэтому шапки, собранные заранее, не устаревают.
// Браузер без полного экрана (Safari на iPhone) кнопку не получает.

const ICON_IN = '<svg class="fs-in" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const ICON_OUT = '<svg class="fs-out" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 1v4H1M11 1v4h4M11 15v-4h4M5 15v-4H1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

/** Умеет ли браузер полный экран. */
export const fsCan = (doc = globalThis.document) => !!(doc && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled));

/** Включен ли сейчас полный экран. */
export const fsOn = (doc = globalThis.document) => !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));

/** Кнопка для шапки или пустая строка. cls — классы кнопок этой шапки. */
export function fsButton(cls = '', doc = globalThis.document) {
  if (!fsCan(doc)) return '';
  return `<button type="button" class="${cls} fsbtn" data-fs title="Спрятать панели браузера и системы. Вернуть: эта же кнопка или «Назад»">${ICON_IN}${ICON_OUT}<span class="fs-in">Весь экран</span><span class="fs-out">Обычный экран</span></button>`;
}

/** Войти в полный экран или выйти из него. Отказ браузера не ломает страницу. */
export function toggleFullscreen(doc = globalThis.document) {
  try {
    if (fsOn(doc)) return Promise.resolve((doc.exitFullscreen || doc.webkitExitFullscreen).call(doc)).catch(() => {});
    const el = doc.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    return Promise.resolve(req.call(el, { navigationUI: 'hide' })).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/** Один раз на страницу: нажатия на любую кнопку [data-fs], в том числе в шапках, нарисованных позже. */
export function bindFullscreen(doc = globalThis.document) {
  doc.addEventListener('click', (e) => {
    if (e.target?.closest?.('[data-fs]')) toggleFullscreen(doc);
  });
}
