// Путь новичка в браузере (Денис 13.11): опрос перед сайтом и блок на главной. Разметка в path-core.js.
import { api, session } from './api.js';
import { toast } from './util.js';
import { loadDone } from './lesson-core.js';
import { surveyHTML, pathHTML } from './path-core.js';

/** Сколько уроков пройдено в этом браузере (уроки открыты без входа, отметки лежат в браузере). */
function lessonsDone() {
  try { return loadDone(() => localStorage).size; } catch { return 0; }
}

/** Записать в сессию то, что сервер знает о пути: шапка и лобби смотрят на session.user.path. */
function keepPath(user, extra = {}) {
  const s = session.get();
  if (s) session.set({ ...s, user: { ...s.user, ...user }, ...extra });
}

/**
 * Опрос «играли раньше?» вместо страницы, пока нет ответа. done(novice) зовется после ответа:
 * novice = true, если человек назвался новичком.
 */
export function renderSurvey(app, { done }) {
  app.innerHTML = surveyHTML(session.get()?.user?.name);
  const err = app.querySelector('#svErr');
  const btns = [...app.querySelectorAll('[data-played]')];
  btns.forEach((b) => b.addEventListener('click', async () => {
    const played = b.dataset.played === '1';
    btns.forEach((x) => { x.disabled = true; });
    err.textContent = '';
    try {
      const r = await api('POST', 'me/path', { played });
      const s = session.get();
      if (s) session.set({ ...s, user: r.user, pathAnswered: true });
      done(!played);
    } catch (e) {
      // ответ уже дан на другом устройстве: вопрос больше не нужен, а что там ответили, знает сервер
      if (e.code === 'answered') {
        const user = await api('GET', 'me').catch(() => null);
        const s = session.get();
        if (s) session.set({ ...s, ...(user ? { user } : {}), pathAnswered: true });
        return done(Boolean(user?.path));
      }
      err.textContent = e.message;
      btns.forEach((x) => { x.disabled = false; });
    }
  }));
}

/**
 * Блок «Путь новичка» на главной: box уже на странице. go(hash) открывает стол партии шага;
 * opened() зовется, если путь тем временем пройден (страницу стоит перерисовать).
 */
export async function mountPath(box, { go, opened }) {
  let p;
  try {
    p = await api('GET', 'me/path');
  } catch {
    // нет связи: без блока новичок остался бы без кнопки «Играть», поэтому даем повторить (ревью 13.11)
    if (!box.isConnected) return;
    box.innerHTML = '<h2>Путь новичка</h2><p class="npsub">Не удалось загрузить путь. <button class="btn sm" type="button" data-npretry>Повторить</button></p>';
    box.querySelector('[data-npretry]').addEventListener('click', () => {
      box.querySelector('.npsub').textContent = 'Загружаю...';
      mountPath(box, { go, opened });
    });
    return;
  }
  if (!box.isConnected) return;
  if (p.state !== 'novice') {
    // путь пройден или его открыл администратор: убрать отметку из сессии и блок со страницы.
    // Сообщаем один раз и только тому, кто шел по пути: ответившему «играл» поздравление ни к чему
    if (p.state !== 'ask') {
      const s = session.get();
      if (s?.user?.path) {
        const { path, ...user } = s.user;
        session.set({ ...s, user, pathOpened: true });
        if (path.state === 'novice' && !s.pathOpened) opened?.();
      }
    }
    box.remove();
    return;
  }
  keepPath({ path: { state: 'novice', steps: p.steps } });
  const paint = () => {
    box.innerHTML = pathHTML(p, lessonsDone());
    box.querySelector('[data-npplay]')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; // двойное нажатие завело бы две партии
      try {
        const r = await api('POST', 'me/path/play');
        scrollTo(0, 0);
        go(`#/t/${r.code}`);
      } catch (ex) {
        toast(ex.message);
        b.disabled = false;
      }
    });
    box.querySelector('[data-npskip]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        p = (await api('POST', 'me/path', { learn: 'skip' })).path;
        if (box.isConnected) paint();
      } catch (ex) {
        toast(ex.message);
        if (box.isConnected) paint();
      }
    });
  };
  paint();
}
