// Страница «Мой профиль»: свое фото. Браузер сам обрезает снимок в квадрат и уменьшает его,
// на сервер уходит картинка на 10-20 КБ, а не исходный файл на несколько мегабайт.
import { api, session } from './api.js';
import { esc, toast, faceBg } from './util.js';
import { squareCrop } from './avatar-core.js';

const SIDE = 160, MAX_CHARS = 28000;

async function encode(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = () => no(new Error('Не удалось открыть файл. Подойдет обычное фото в JPEG или PNG.'));
      img.src = url;
    });
    const { sx, sy, s } = squareCrop(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = SIDE;
    c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, SIDE, SIDE);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      let d = c.toDataURL('image/webp', q);
      if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', q); // Safari не умеет webp
      if (d.length <= MAX_CHARS) return d;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  throw new Error('Не получилось уменьшить фото, попробуйте другое');
}

/** Нарисовать страницу в app. top и bindTop — шапка сайта и привязка ее кнопок. */
export function renderProfile(app, top, bindTop) {
  const user = () => session.get()?.user || {};
  app.innerHTML = `<div class="page">${top}<main class="pcard profile">
    <h1>Мой профиль</h1>
    <div class="pfrow">
      <i class="face huge" id="pFace"></i>
      <div class="pfinfo">
        <b>${esc(user().name)}</b>
        <div class="pfbtns">
          <label class="btn primary">Загрузить фото<input type="file" id="pFile" accept="image/*" hidden></label>
          <button class="btn" id="pDrop" type="button">Убрать</button>
        </div>
        <p class="muted small">Фото обрежется по центру в квадрат. Его увидят другие игроки: за столом, в итоге партии и в статистике. Фото открывается по длинной случайной ссылке. Новое фото появится в следующих столах.</p>
        <p class="err" id="pErr" role="alert"></p>
      </div>
    </div>
  </main></div>`;
  bindTop();

  const $ = (id) => app.querySelector('#' + id);
  const paint = () => {
    $('pFace').style.backgroundImage = faceBg(user());
    $('pDrop').hidden = !user().avatar;
  };
  const save = async (image) => {
    $('pErr').textContent = '';
    try {
      const r = await api('POST', 'me/avatar', { image });
      session.set({ ...session.get(), user: r.user });
      paint();
      toast(image ? 'Фото сохранено' : 'Фото убрано');
    } catch (e) {
      $('pErr').textContent = e.message;
    }
  };
  $('pFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // тот же файл можно выбрать снова
    if (!file) return;
    try {
      await save(await encode(file));
    } catch (ex) {
      $('pErr').textContent = ex.message;
    }
  });
  $('pDrop').addEventListener('click', () => save(null));
  paint();
}
