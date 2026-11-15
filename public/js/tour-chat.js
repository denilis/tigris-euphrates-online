// Чат турнира в «Статистике» (Денис 15.11, «Чат турнира»): подключить группу Telegram кодом, увидеть
// подключенную, отключить. Приглашения за столы турнира бот пишет в эту группу (server/routes.js).
import { api } from './api.js';
import { toast, copy } from './util.js';
import { chatRowHTML } from './tour-chat-core.js';

// пока открыт код, спрашиваем, подключилась ли группа: первые 2 минуты раз в 4 с (обычно хватает),
// потом раз в 15 с, в скрытой вкладке не спрашиваем (ревью 15.11: 30 минут по 4 с были дороги базе)
const FAST_MS = 4000, SLOW_MS = 15000, FAST_FOR = 2 * 60000;

/**
 * Привязать строку к box. info — ответ GET tournaments (tours обновляются на месте), current() —
 * выбранный турнир. Возвращает paint(): перерисовать при смене турнира.
 */
export function mountTourChat(box, info, current) {
  let wait = null, timer = 0;
  const tour = () => info.tours.find((t) => t.id === current());
  const stop = () => { clearTimeout(timer); timer = 0; wait = null; };
  const paint = () => {
    const t = tour();
    if (wait && wait.id !== t?.id) stop(); // выбрали другой турнир: ожидание первого не нужно
    box.hidden = !t;
    box.innerHTML = chatRowHTML(t, info.chatReady, wait);
  };
  // группа подключается в Telegram: узнаем об этом опросом, пока виден код
  const next = () => {
    clearTimeout(timer);
    timer = setTimeout(poll, Date.now() - wait.at < FAST_FOR ? FAST_MS : SLOW_MS);
  };
  const poll = async () => {
    if (!box.isConnected || !wait || Date.now() > wait.until) return (stop(), box.isConnected && paint());
    if (!document.hidden) {
      try {
        const fresh = await api('GET', 'tournaments');
        const t = fresh.tours.find((x) => x.id === wait?.id);
        if (t?.chat) {
          Object.assign(tour() || {}, { chat: t.chat });
          stop();
          paint();
          return toast('Чат подключен');
        }
      } catch { /* сеть моргнула: спросим в следующий раз */ }
    }
    if (wait) next();
  };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = tour();
    if (!t) return;
    if (b.id === 'cCopy') return copy(wait.command);
    if (b.id === 'cCancel') return (stop(), paint());
    b.disabled = true;
    try {
      if (b.id === 'cOn') {
        const r = await api('POST', `tournaments/${encodeURIComponent(t.id)}/chat`);
        wait = { ...r, id: t.id, at: Date.now(), until: Date.now() + r.minutes * 60000 };
        next();
      }
      if (b.id === 'cOff') {
        await api('POST', `tournaments/${encodeURIComponent(t.id)}/chat/off`);
        t.chat = null;
        toast('Чат отключен');
      }
    } catch (ex) {
      toast(ex.message);
    }
    paint();
  });
  paint();
  return paint;
}
