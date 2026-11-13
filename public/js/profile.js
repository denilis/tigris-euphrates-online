// Страница «Мой профиль» (13.11.2026, схема одобрена Денисом): фото, сводка партий с рейтингом,
// последние партии и настройки (имя, фон сайта, выход).
// Фото: браузер сам обрезает снимок в квадрат и уменьшает его, на сервер уходит картинка на 10-20 КБ,
// а не исходный файл на несколько мегабайт.
import { api, session } from './api.js';
import { esc, toast, faceBg } from './util.js';
import { squareCrop } from './avatar-core.js';
import { numsHTML, whereHTML, recentHTML, sinceText } from './profile-core.js';

const SIDE = 160, MAX_CHARS = 28000;
const NAME_MAX = 30;

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

/**
 * Нарисовать страницу в app. top и bindTop — шапка сайта и привязка ее кнопок.
 * opts: refresh() перерисовать страницу (после смены имени шапка показывает новое), logout() выйти,
 * bg: { still(), set(v) } — фон сайта: неподвижная картинка вместо ролика.
 */
export function renderProfile(app, top, bindTop, opts = {}) {
  const user = () => session.get()?.user || {};
  app.innerHTML = `<div class="page">${top}<main class="pcard profile">
    <h1>Мой профиль</h1>
    <div class="pfrow">
      <i class="face huge" id="pFace"></i>
      <div class="pfinfo">
        <b class="pfname">${esc(user().name)}</b>
        <span class="muted small" id="pSince"></span>
        <div class="pfbtns">
          <label class="btn primary">Загрузить фото<input type="file" id="pFile" accept="image/*" hidden></label>
          <button class="btn" id="pDrop" type="button">Убрать</button>
        </div>
        <p class="muted small">Фото обрежется по центру в квадрат. Его увидят другие игроки: за столом, в итоге партии и в статистике. Фото открывается по длинной случайной ссылке. Новое фото появится в следующих столах.</p>
        <p class="err" id="pErr" role="alert"></p>
      </div>
    </div>
    <div class="pnums" id="pNums"><p class="muted">Загружаю...</p></div>
    <p class="muted small pfnote">Рейтинг считается по партиям с людьми на сайте и по сезону BGA. Партии с ботами его не меняют.</p>
    <div id="pPlay"></div>
    <div class="pflinks"><a class="btn" href="#/stats/me">Вся моя статистика</a><a class="btn" href="#/tables">Мои столы</a></div>
    <h2>Настройки</h2>
    <form class="pfline" id="nForm" autocomplete="off">
      <label class="flab" for="nName">Имя</label>
      <input id="nName" maxlength="${NAME_MAX}" value="${esc(user().name)}" spellcheck="false" aria-describedby="nHint">
      <button class="btn primary" type="submit" id="nSave">Сохранить</button>
    </form>
    <p class="muted small" id="nHint">От 2 до ${NAME_MAX} знаков. Имя видят другие игроки. В новых столах, реваншах и статистике оно появится сразу. За столом, где вы уже сидите, и в сыгранных партиях останется прежнее.</p>
    <p class="err" id="nErr" role="alert"></p>
    <div class="pfline">
      <span class="flab">Фон сайта</span>
      <span class="seg" id="bgSeg"><button type="button" data-still="0">видео</button><button type="button" data-still="1">картинка</button></span>
    </div>
    <p class="muted small">Видео на фоне главной и других страниц можно заменить неподвижной картинкой. Выбор запоминается на этом устройстве.${opts.bg?.hasVideo === false ? ' У нынешней сцены ролика нет: выбор сработает, когда сцена сменится.' : ''}</p>
    <div class="pfline"><button class="btn" id="pOut" type="button">Выйти на этом устройстве</button></div>
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

  // сводка: партии, победы, рейтинг
  api('GET', 'me/profile').then((p) => {
    if (!$('pNums')) return; // страницу уже сменили
    $('pSince').textContent = sinceText(p);
    $('pNums').innerHTML = numsHTML(p);
    $('pPlay').innerHTML = whereHTML(p) + recentHTML(p);
  }).catch((e) => {
    if ($('pNums')) $('pNums').innerHTML = `<p class="err">${esc(e.message)}</p>`;
  });

  // имя
  $('nForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('nName').value;
    $('nErr').textContent = '';
    $('nSave').disabled = true; // двойное нажатие не должно тратить две смены из пяти за сутки
    try {
      const r = await api('POST', 'me/name', { name });
      const changed = r.user.name !== user().name;
      // nameAt: минуту после смены пульс с сервера не переписывает имя прежним (presence.js)
      session.set({ ...session.get(), user: r.user, ...(changed ? { nameAt: Date.now() } : {}) });
      toast(changed ? 'Имя сохранено' : 'Имя прежнее');
      if (!$('nForm')) return; // пока шел ответ, страницу сменили: чужую страницу не перерисовываем
      if (changed && opts.refresh) return opts.refresh(); // шапка и страница с новым именем
      $('nName').value = r.user.name;
    } catch (ex) {
      if ($('nErr')) $('nErr').textContent = ex.message;
    }
    if ($('nSave')) $('nSave').disabled = false;
  });

  // фон сайта
  const paintBg = () => {
    const still = Boolean(opts.bg?.still());
    $('bgSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.still === '1') === still));
  };
  $('bgSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !opts.bg) return;
    opts.bg.set(b.dataset.still === '1');
    paintBg();
  });
  paintBg();

  $('pOut').addEventListener('click', () => opts.logout?.());
}
