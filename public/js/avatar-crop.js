// Окно кадрирования фото (Денис 13.11, схема одобрена): после выбора файла фото можно подвинуть и
// увеличить, круг показывает, что попадет в аватар, три кружка ниже показывают его в настоящих
// размерах сайта. Окно одно на всех: свое фото в профиле и фото игроку от администратора.
// Расчеты кадра в avatar-core.js. На сервер уходит квадрат 160 на 160 весом 10-20 КБ, а не исходник.
import { fullCrop, panCrop, zoomCrop, sliderOf, cropAtSlider, cropRect, cropLimits } from './avatar-core.js';
import { esc } from './util.js';

export const SIDE = 160; // сторона сохраненного фото
export const PREVIEWS = [120, 52, 26]; // профиль, лобби, шапка
const MAX_CHARS = 28000; // сервер принимает до 30000 знаков
const WORK_MAX = 1600; // длинная сторона рабочей копии: снимок с телефона иначе тормозит окно
const FRAME = 0.8; // круг занимает столько от стороны окна: вокруг видно, что останется за кадром
const STEP = 1.25; // шаг кнопок «−» и «+» и клавиш
const KEY_MOVE = 16; // сдвиг стрелкой, точек экрана
const BACK = '#14110e';
const NO_FILE = 'Не удалось открыть файл. Подойдет обычное фото в JPEG или PNG.';
const NO_ROOM = 'Браузеру не хватило памяти на это фото. Попробуйте фото поменьше.';

/** Разметка окна. */
export function cropHTML(title) {
  return `<div class="pickin cropin">
    <div class="pickhead"><h2>${esc(title)}</h2><button class="btn sm lclose" type="button" data-cropcancel aria-label="Закрыть" title="Закрыть без сохранения">×</button></div>
    <canvas class="cropview" data-cropview tabindex="0" role="img" aria-label="Фото. Двигайте его, чтобы выбрать кадр: в круге то, что попадет в аватар"></canvas>
    <div class="cropzoom">
      <button class="btn sm" type="button" data-cropout aria-label="Уменьшить" title="Уменьшить">−</button>
      <input type="range" min="0" max="1000" step="1" value="0" data-cropscale aria-label="Масштаб">
      <button class="btn sm" type="button" data-cropin aria-label="Увеличить" title="Увеличить">+</button>
    </div>
    <div class="cropprev"><span class="muted small">Как будет на сайте</span>${PREVIEWS.map((d) => `<canvas data-prev="${d}" style="width:${d}px;height:${d}px" aria-hidden="true"></canvas>`).join('')}</div>
    <p class="muted small crophint">Двигайте фото мышью или пальцем: в круге то, что попадет в аватар. Масштаб меняют ползунок, колесо мыши или два пальца.</p>
    <p class="err" data-croperr role="alert"></p>
    <div class="cropbtns"><button class="btn" type="button" data-cropcancel>Отмена</button><button class="btn primary" type="button" data-cropok>Сохранить фото</button></div>
  </div>`;
}

/** Рисовальщик холста или понятная ошибка: на телефоне при нехватке памяти браузер его не дает. */
function pen(canvas) {
  const g = canvas.getContext('2d');
  if (!g) throw new Error(NO_ROOM);
  return g;
}

/** Рабочая копия снимка: холст не больше WORK_MAX по длинной стороне. Не картинка: ошибка с понятным текстом. */
async function loadWork(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = () => no(new Error(NO_FILE));
      img.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error(NO_FILE);
    const k = Math.min(1, WORK_MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const g = pen(c);
    g.fillStyle = BACK; // под прозрачными местами PNG темный фон, как у кружка на сайте
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Кадр как картинка для сервера: квадрат SIDE, webp (в Safari jpeg), качество ниже, пока не влезет. */
function encodeCrop(work, crop) {
  const { sx, sy, s } = cropRect(crop);
  const c = document.createElement('canvas');
  c.width = c.height = SIDE;
  const g = pen(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(work, sx, sy, s, s, 0, 0, SIDE, SIDE);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    let d = c.toDataURL('image/webp', q);
    if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', q); // Safari не умеет webp
    if (d.length <= MAX_CHARS) return d;
  }
  throw new Error('Не получилось уменьшить фото, попробуйте другое');
}

/**
 * Открыть окно для файла. save(image) отправляет готовую картинку (data:) и бросает ошибку, если
 * не вышло: ее текст покажется в окне, окно останется открытым. Возвращает true, если фото
 * сохранено, false, если окно закрыли или открывать его было уже незачем. Файл не открылся как
 * картинка: бросает ошибку до окна.
 */
export async function openCrop(file, { title = 'Фото профиля', save }) {
  const at = location.hash;
  const work = await loadWork(file);
  // пока большое фото открывалось, человек мог уйти со страницы или выбрать файл еще раз (ревью 13.11)
  if (location.hash !== at || document.querySelector?.('dialog.picker.crop')) return false;
  const W = work.width, H = work.height;
  const lim = cropLimits(W, H);
  let crop = fullCrop(W, H);

  const box = document.createElement('dialog');
  box.className = 'picker crop';
  box.innerHTML = cropHTML(title);
  document.body.append(box);
  const $ = (sel) => box.querySelector(sel);
  const stage = $('[data-cropview]'), scale = $('[data-cropscale]'), err = $('[data-croperr]'), ok = $('[data-cropok]');
  const previews = [...box.querySelectorAll('[data-prev]')];
  const cancels = [...box.querySelectorAll('[data-cropcancel]')];
  const fixed = !(lim.max > lim.min); // крошечная картинка: масштабировать нечего
  for (const el of [scale, $('[data-cropout]'), $('[data-cropin]')]) el.disabled = fixed;

  let V = 0, D = 0, dpr = 1; // сторона окна и диаметр круга в точках экрана
  const measure = () => {
    V = Math.max(120, Math.round(stage.getBoundingClientRect().width));
    D = Math.round(V * FRAME);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.width = stage.height = Math.round(V * dpr);
    for (const cv of previews) cv.width = cv.height = Math.round(Number(cv.dataset.prev) * dpr);
  };
  const draw = () => {
    const g = pen(stage);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = BACK;
    g.fillRect(0, 0, V, V);
    const k = D / crop.s;
    g.imageSmoothingQuality = 'high';
    g.drawImage(work, V / 2 - crop.cx * k, V / 2 - crop.cy * k, W * k, H * k);
    // все, что вне круга, затемнено; сам круг обведен
    g.beginPath();
    g.rect(0, 0, V, V);
    g.moveTo(V / 2 + D / 2, V / 2);
    g.arc(V / 2, V / 2, D / 2, 0, Math.PI * 2, true);
    g.fillStyle = 'rgba(10,7,4,.64)';
    g.fill('evenodd');
    g.beginPath();
    g.arc(V / 2, V / 2, D / 2, 0, Math.PI * 2);
    g.strokeStyle = '#e0b65a';
    g.lineWidth = 2;
    g.stroke();
    const { sx, sy, s } = cropRect(crop);
    for (const cv of previews) {
      const p = pen(cv);
      p.imageSmoothingQuality = 'high';
      p.drawImage(work, sx, sy, s, s, 0, 0, cv.width, cv.height);
    }
    scale.value = String(Math.round(sliderOf(crop, W, H) * 1000));
  };
  // Рисуем не чаще кадра экрана: два пальца шлют сотни событий в секунду, а перерисовка не дешевая.
  // Запасной таймер нужен фоновой странице: там браузер кадров не дает. Функции браузера зовем
  // через globalThis: оторванные от окна они бросают «Illegal invocation»
  let queued = false, raf = 0, timer = 0;
  const unqueue = () => {
    queued = false;
    clearTimeout(timer);
    if (raf && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(raf);
    raf = 0;
  };
  const flush = () => {
    if (!queued) return;
    unqueue();
    draw();
  };
  const set = (next) => {
    crop = next;
    if (queued) return;
    queued = true;
    raf = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(flush) : 0;
    timer = setTimeout(flush, 50);
  };
  /** Точка экрана относительно центра круга. */
  const fromCenter = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  // мышь и пальцы: один указатель двигает фото, два меняют масштаб вокруг середины между ними
  const pts = new Map();
  const spread = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // правая кнопка и колесо фото не двигают
    if (e.isPrimary) pts.clear(); // потерянное раньше «отпускание» не должно превращать сдвиг в щипок
    if (pts.size >= 2) return;
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, fromCenter(e));
  });
  stage.addEventListener('pointermove', (e) => {
    const was = pts.get(e.pointerId);
    if (!was) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return void pts.delete(e.pointerId); // кнопку отпустили за окном
    const now = fromCenter(e);
    if (pts.size === 1) {
      pts.set(e.pointerId, now);
      return set(panCrop(crop, now.x - was.x, now.y - was.y, D, W, H));
    }
    const before = spread();
    pts.set(e.pointerId, now);
    const after = spread();
    // масштаб вокруг прежней середины, потом сдвиг на ее перемещение: точки под пальцами не уплывают
    const zoomed = fixed ? crop : zoomCrop(crop, after.d / before.d, before.x, before.y, D, W, H);
    set(panCrop(zoomed, after.x - before.x, after.y - before.y, D, W, H));
  });
  const drop = (e) => pts.delete(e.pointerId);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, drop);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); // страница под окном не едет
    if (fixed) return;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const p = fromCenter(e);
    set(zoomCrop(crop, Math.exp(-delta * 0.0015), p.x, p.y, D, W, H));
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const move = { ArrowLeft: [-KEY_MOVE, 0], ArrowRight: [KEY_MOVE, 0], ArrowUp: [0, -KEY_MOVE], ArrowDown: [0, KEY_MOVE] }[e.key];
    if (move) {
      e.preventDefault();
      return set(panCrop(crop, move[0], move[1], D, W, H));
    }
    if (fixed) return;
    if (e.key === '+' || e.key === '=') set(zoomCrop(crop, STEP, 0, 0, D, W, H));
    else if (e.key === '-' || e.key === '−') set(zoomCrop(crop, 1 / STEP, 0, 0, D, W, H));
  });
  scale.addEventListener('input', () => set(cropAtSlider(crop, Number(scale.value) / 1000, W, H)));
  $('[data-cropout]').addEventListener('click', () => set(zoomCrop(crop, 1 / STEP, 0, 0, D, W, H)));
  $('[data-cropin]').addEventListener('click', () => set(zoomCrop(crop, STEP, 0, 0, D, W, H)));

  const resize = () => {
    measure();
    draw();
  };
  window.addEventListener('resize', resize);

  return new Promise((resolve, reject) => {
    // Конец: один раз убрать окно и ответить. Событие close браузер шлет вместе с кадром экрана, на
    // фоновой странице оно опаздывает, поэтому свои пути (сохранили, отменили) его не ждут
    let over = false;
    const cleanup = () => {
      window.removeEventListener('resize', resize);
      unqueue();
      box.remove();
    };
    const finish = (result) => {
      if (over) return;
      over = true;
      if (box.open) box.close();
      cleanup();
      resolve(result);
    };

    // Сохранение. Пока фото отправляется, окно закрыть нельзя: иначе человек нажал бы «Отмена», а фото
    // все равно сохранилось бы (ревью 13.11). Уход со страницы окно закроет, но ответа мы дождемся
    let saved = false, sending = null;
    for (const b of cancels) b.addEventListener('click', () => { if (!sending) finish(false); });
    box.addEventListener('cancel', (e) => { if (sending) e.preventDefault(); }); // Esc во время отправки
    ok.addEventListener('click', async () => {
      if (sending) return; // двойное нажатие не должно отправить фото дважды
      ok.disabled = true;
      for (const b of cancels) b.disabled = true;
      err.textContent = '';
      sending = (async () => save(encodeCrop(work, crop)))();
      try {
        await sending;
        saved = true;
      } catch (e) {
        err.textContent = e?.message || 'Не получилось сохранить фото, попробуйте еще раз';
      }
      sending = null;
      ok.disabled = false;
      for (const b of cancels) b.disabled = false;
      if (saved) finish(true);
    });
    // закрытие мимо наших кнопок: Esc, уход со страницы (closePicker в lobby.js закрывает dialog.picker)
    box.addEventListener('close', async () => {
      if (sending) await sending.catch(() => {}); // закрыли посреди отправки: исход известен только после ответа
      finish(saved);
    });
    try {
      box.showModal();
      resize();
      stage.focus?.({ preventScroll: true });
    } catch (e) {
      // окно не открылось или холст не дался: не оставляем на странице пустое окно
      over = true;
      cleanup();
      reject(e instanceof Error && [NO_ROOM, NO_FILE].includes(e.message) ? e : new Error(NO_ROOM));
    }
  });
}
