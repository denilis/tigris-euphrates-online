// Страница новичка по ссылке-приглашению (Денис 06.11, схема одобрена): кто зовет, поле «Как вас
// будут видеть другие игроки», код показывается один раз, вход сразу. Ссылка за стол ведет на стол,
// и лобби сажает на первое свободное место, как принявшего приглашение.
import { api, session } from './api.js';
import { esc, copy } from './util.js';
import { markAccepted } from './presence.js';
import { joinError } from './join-link.js';

export function renderJoin(app, token) {
  const at = location.hash; // ответ сервера рисуем, только если человек еще на этой странице
  const here = () => location.hash === at;
  const shell = (inner, links = true) => {
    app.innerHTML = `<div class="gate"><div class="gcard jcard">${inner}${links ? '<a class="glink" href="#/rules">Правила игры</a><a class="glink" href="#/learn">Обучение</a>' : ''}</div></div>`;
  };
  const gone = (text) => shell(`<h1>Тигр и Евфрат</h1><p>${esc(text)}</p><a class="btn" href="#/">У меня есть код</a>`);
  const already = (name) => shell(`<h1>Тигр и Евфрат</h1><p>Вы уже вошли как <b>${esc(name || '')}</b>. Эта ссылка для нового игрока: перешлите ее тому, кого зовете.</p><a class="btn primary" href="#/">На главную</a>`);
  shell('<h1>Тигр и Евфрат</h1><p>Проверяем приглашение</p>');
  const me = session.get();
  if (me?.token) {
    // уже вошедший по чужой ссылке не регистрируется второй раз и ссылку не тратит. Сессию сверяем с
    // сервером: устаревшая дает 401, api.js стирает ее, и маршрут заново откроет эту страницу с формой
    api('GET', 'me').then((u) => here() && already(u.name)).catch((e) => { if (e.status !== 401 && here()) already(me.user?.name); });
    return;
  }
  api('POST', 'join/info', { token }).then((info) => {
    if (!here()) return;
    shell(`<h1>Тигр и Евфрат</h1>
      <p><b>${esc(info.by)}</b> приглашает вас${info.table ? ` за стол ${esc(info.table.title)}` : ''} в онлайн-игру «Тигр и Евфрат».</p>
      <form id="jForm" class="jform" autocomplete="off">
        <label for="jName">Как вас будут видеть другие игроки</label>
        <input id="jName" class="jname" maxlength="30" placeholder="Имя или ник" autocomplete="nickname">
        <small>Можно указать ник. Почта и телефон не нужны.</small>
        <button class="btn primary" type="submit">Получить код и войти</button>
        <p class="err" id="jErr" role="alert"></p>
      </form>`);
    const input = app.querySelector('#jName');
    input.focus();
    app.querySelector('#jForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = app.querySelector('#jErr'), btn = e.submitter || app.querySelector('#jForm button');
      err.textContent = '';
      if (!input.value.trim()) { err.textContent = 'Впишите имя или ник.'; return; }
      btn.disabled = true;
      try {
        const r = await api('POST', 'join', { token, name: input.value });
        session.set({ token: r.token, user: r.user });
        done(r);
      } catch (ex) {
        if (ex.code === 'join-gone') return gone(joinError(ex));
        err.textContent = joinError(ex);
        btn.disabled = false;
      }
    });
  }).catch((e) => here() && gone(joinError(e)));

  // код показываем один раз: человек уже вошел, код нужен для другого устройства. Ссылок «Правила»
  // и «Обучение» тут нет: уйти с экрана, не сохранив код, можно только кнопкой дальше
  function done(r) {
    shell(`<h1>Готово</h1>
      <p>${esc(r.user.name)}, вот ваш личный код:</p>
      <div class="codebox jcode"><code>${esc(r.code)}</code><button class="btn sm" id="jCopy" type="button">Скопировать</button></div>
      <p>Сохраните его: он нужен, чтобы войти на другом устройстве или через 90 дней. Больше код не покажется.</p>
      <button class="btn primary" id="jGo" type="button">${r.table ? 'К столу' : 'Начать'}</button>`, false);
    app.querySelector('#jCopy').addEventListener('click', () => copy(r.code));
    app.querySelector('#jGo').addEventListener('click', () => {
      if (r.table) markAccepted(r.table.code);
      location.hash = r.table ? `#/t/${r.table.code}` : '#/';
    });
  }
}
