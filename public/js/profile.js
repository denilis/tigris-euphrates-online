// Страница «Мой профиль» (13.11.2026, схема одобрена Денисом): фото, сводка партий с рейтингом,
// последние партии и настройки (имя, фон сайта, выход).
// Фото: после выбора файла открывается окно кадрирования (avatar-crop.js, 13.11): фото можно подвинуть
// и увеличить. На сервер уходит квадрат на 10-20 КБ, а не исходный файл на несколько мегабайт.
import { api, session } from './api.js';
import { esc, toast, faceBg } from './util.js';
import { openCrop } from './avatar-crop.js';
import { numsHTML, whereHTML, recentHTML, sinceText, playerNote } from './profile-core.js';

const NAME_MAX = 30;

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
        <p class="muted small">После выбора файла фото можно подвинуть и увеличить: круг покажет, что попадет в кадр. Фото увидят другие игроки: за столом, в итоге партии и в статистике. Фото открывается по длинной случайной ссылке. Новое фото появится в следующих столах.</p>
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
  /** Отправить фото (или null, чтобы убрать). Ошибку бросает: ее покажет тот, кто звал. */
  const put = async (image) => {
    const r = await api('POST', 'me/avatar', { image });
    // avatarAt: пару минут пульс с сервера не переписывает фото прежним (presence.js)
    session.set({ ...session.get(), user: r.user, avatarAt: Date.now() });
    if ($('pFace')) paint(); // пока шел ответ, страницу могли сменить
    toast(image ? 'Фото сохранено' : 'Фото убрано');
  };
  $('pFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // тот же файл можно выбрать снова
    if (!file) return;
    $('pErr').textContent = '';
    try {
      // окно кадрирования: сбой отправки оно показывает у себя, сюда попадает только «файл не открылся»
      await openCrop(file, { title: 'Фото профиля', save: put });
    } catch (ex) {
      if ($('pErr')) $('pErr').textContent = ex.message;
    }
  });
  $('pDrop').addEventListener('click', async () => {
    $('pErr').textContent = '';
    try {
      await put(null);
    } catch (ex) {
      if ($('pErr')) $('pErr').textContent = ex.message;
    }
  });
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

/**
 * Профиль другого игрока (Денис 13.11): только просмотр, раскладка как у «Моего профиля», без
 * настроек и загрузки фото. Открывает администратор из «Кодов игроков»; сервер чужой профиль
 * игроку не отдает. Отсюда же переход в личную статистику этого игрока.
 */
export async function renderPlayer(app, top, bindTop, id) {
  app.innerHTML = `<div class="page">${top}<main class="pcard profile">
    <h1>Профиль игрока</h1>
    <div class="pfrow">
      <i class="face huge" id="pFace"></i>
      <div class="pfinfo">
        <b class="pfname" id="pName"></b>
        <span class="muted small" id="pSince"></span>
        <span class="muted small" id="pNote"></span>
      </div>
    </div>
    <div class="pnums" id="pNums"><p class="muted">Загружаю...</p></div>
    <p class="muted small pfnote">Рейтинг считается по партиям с людьми на сайте и по сезону BGA. Партии с ботами его не меняют.</p>
    <div id="pPlay"></div>
    <div class="pflinks"><a class="btn primary" href="#/stats/p/${esc(id)}">Вся статистика игрока</a><a class="btn" href="#/admin">Коды игроков</a></div>
  </main></div>`;
  bindTop();
  const $ = (x) => app.querySelector('#' + x);
  try {
    const p = await api('GET', `players/${encodeURIComponent(id)}/profile`);
    if (!$('pNums')) return; // страницу уже сменили
    $('pFace').style.backgroundImage = faceBg(p.user);
    $('pName').textContent = p.user.name;
    $('pSince').textContent = sinceText(p);
    $('pNote').textContent = playerNote(p);
    $('pNums').innerHTML = numsHTML(p);
    $('pPlay').innerHTML = whereHTML(p) + recentHTML(p);
  } catch (e) {
    if ($('pNums')) $('pNums').innerHTML = `<p class="err">${esc(e.status === 403 ? 'Профиль другого игрока открывает только администратор.' : e.message)}</p>`;
  }
}
