// Приглашения в чат через бота Telegram. Другого в чат не пишем (решение Дениса 01.11):
// ни кто зашел на сайт, ни о начале партии. С 04.11 еще картинка итога, только по нажатию игрока
// (photo, server/photo.js). Отправка не должна мешать игре: say не бросает
// ошибок и ждет недолго. Пишет только основной сайт, превью и локальный сервер молчат.
// С 15.11 чат есть у турнира (Денис: «Чат турнира»): его подключают из «Статистики» кодом, бот
// получает команду через webhook (hookEvent). Чат компании из настроек сайта стал чатом сезона.
import { createHash, timingSafeEqual } from 'node:crypto';

const WAIT_MS = 5000; // первый запрос после простоя у Telegram занимал больше 2,5 с
const TOKEN = /\d{5,}:[\w-]{30,}/; // номер бота, двоеточие и длинный ключ

export const SITE = 'https://tigris-euphrates-online.vercel.app/';
export const HOOK_URL = `${SITE}api/tg/hook`;
export const SEASON_CHAT = 'ДВАК'; // так компания зовет свой чат: кнопка «Отправить в чат ДВАК»

// чат пока один и свой у этой компании, у других игроков будут свои: о них сюда не пишем
export const CHAT_PEOPLE = ['денис', 'андрей', 'влад'];
export const inChat = (name) => CHAT_PEOPLE.includes(String(name).trim().toLowerCase());

const tableUrl = (t) => `${SITE}#/t/${t.code}`;
const tableName = (t) => t.title || t.code;

/** Секрет адреса для Telegram: из токена бота, отдельной настройки не нужно. */
export const hookSecretOf = (token) => createHash('sha256').update(`tigris-hook:${token}`).digest('hex').slice(0, 40);

export function telegram(env, { fetchFn = fetch, waitMs = WAIT_MS } = {}) {
  // значения вставляют руками в панели Vercel, вместе с токеном часто попадает лишний текст;
  // без токена в значении чат не подключен, и /api/ping это покажет
  const token = TOKEN.exec(String(env.TELEGRAM_BOT_TOKEN))?.[0], chat = String(env.TELEGRAM_CHAT_ID || '').trim();
  // ready: бот работает (чаты турниров); on: еще и чат компании (сезона) задан в настройках
  const ready = Boolean(token && env.VERCEL_ENV === 'production');
  const on = Boolean(ready && chat);
  const secret = token ? hookSecretOf(token) : null;
  let botName = null;

  /** Вызов метода бота: ответ result или null. Текст ошибки не печатаем: в нем может быть адрес с токеном. */
  async function call(method, body, what = method) {
    if (!ready) return null;
    try {
      const r = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(waitMs),
      });
      if (r.ok) return (await r.json().catch(() => null))?.result ?? true;
      const why = await r.json().catch(() => null);
      console.error('telegram', what, r.status, why?.description || '');
    } catch (e) {
      console.error('telegram', what, e.name);
    }
    return null;
  }

  /**
   * Отправить сообщение, по умолчанию в чат сезона; to — номер чата турнира. Кнопка-ссылка по
   * желанию. Текст простой: имена не разбираются как разметка.
   */
  async function say({ text, button, url }, to = chat) {
    if (!ready || !to) return false;
    const body = { chat_id: to, text };
    if (button) body.reply_markup = { inline_keyboard: [[{ text: button, url }]] };
    return Boolean(await call('sendMessage', body, 'telegram'));
  }

  /** Имя бота для ссылок t.me: спрашиваем один раз на экземпляр функции. */
  async function me() {
    if (!botName) botName = (await call('getMe', {}))?.username || null;
    return botName;
  }

  /** Сообщить Telegram адрес сайта для команд боту (подключение чата турнира). */
  async function setHook(url = HOOK_URL) {
    return Boolean(await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'my_chat_member'] }));
  }

  /** Запрос на адрес команд пришел от Telegram: заголовок с секретом совпал. */
  function fromTelegram(given) {
    if (!secret || typeof given !== 'string') return false;
    // длину сверяем в байтах: 40 букв «é» это 80 байт, и сравнение бросило бы ошибку (ревью 15.11)
    const a = Buffer.from(given), b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Картинка с подписью и кнопкой-ссылкой (итог партии, этап 4 04.11). type — image/jpeg или
   * image/png, bytes — содержимое. Ждет дольше сообщения: картинка весит сотни килобайт.
   */
  async function photo({ bytes, type, caption, button, url }, to = chat) {
    if (!ready || !to) return false;
    try {
      const form = new FormData();
      form.append('chat_id', to);
      form.append('caption', caption);
      form.append('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: button, url }]] }));
      form.append('photo', new Blob([bytes], { type }), type === 'image/png' ? 'itog.png' : 'itog.jpg');
      const r = await fetchFn(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(waitMs * 3) });
      if (r.ok) return true;
      const why = await r.json().catch(() => null);
      console.error('telegram photo', r.status, why?.description || '');
    } catch (e) {
      console.error('telegram photo', e.name); // текст ошибки может содержать адрес с токеном
    }
    return false;
  }

  return { on, ready, say, photo, me, setHook, fromTelegram };
}

/** Кнопка к картинке итога: ссылка на стол. */
export const photoButton = (t) => ({ button: 'Открыть стол', url: tableUrl(t) });

// в чате турнира строка называет турнир; в чате сезона, как раньше, только стол
const where = (t, tour) => (tour ? `Турнир «${tour}», стол ${tableName(t)}` : `Стол ${tableName(t)}`);

export const invited = (name, t, free, tour = null) => ({
  text: `${name} зовёт на партию\n${where(t, tour)}, свободно мест: ${free}`,
  button: 'Сесть за стол',
  url: tableUrl(t),
});

/** Хозяин посадил выбранных людей за стол. */
export const called = (name, t, names, tour = null) => ({
  text: `${name} зовёт за стол: ${names.join(', ')}\n${where(t, tour)}`,
  button: 'Открыть стол',
  url: tableUrl(t),
});

// --- команды боту (15.11, чат турнира)

export const CHAT_CODE = /^[A-HJ-NP-Z2-9]{8}$/; // без похожих 0/O и 1/I
export const CHAT_CODE_MS = 30 * 60 * 1000;

/**
 * Что пришло от Telegram: connect (команда /start или /connect с кодом, по ссылке startgroup бот сам
 * получает /start код), help (/start без кода в личке), left (бота убрали из группы), migrate (группа
 * стала супергруппой, у нее новый номер). Остальное null.
 */
export function hookEvent(u) {
  const m = u?.message;
  if (m?.migrate_to_chat_id && m.chat?.id) return { kind: 'migrate', from: m.chat.id, to: m.migrate_to_chat_id };
  const cmd = /^\/(start|connect)(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(typeof m?.text === 'string' ? m.text.trim() : '');
  if (m?.chat?.id && cmd) {
    const chat = { id: m.chat.id, type: m.chat.type, title: String(m.chat.title || '').slice(0, 80) };
    const code = String(cmd[2] || '').toUpperCase();
    if (!code) return cmd[1].toLowerCase() === 'start' && chat.type === 'private' ? { kind: 'help', chat } : null;
    return { kind: 'connect', code, chat };
  }
  const cm = u?.my_chat_member;
  if (cm?.chat?.id && ['left', 'kicked'].includes(cm.new_chat_member?.status)) return { kind: 'left', chat: cm.chat.id };
  return null;
}

export const HOOK_TEXT = {
  help: 'Этот бот присылает приглашения сайта «Тигр и Евфрат» в групповой чат турнира. Подключить чат: сайт, раздел «Статистика», ваш турнир, «Подключить».',
  private: 'Подключить можно только групповой чат: добавьте бота в группу участников турнира и отправьте команду там.',
  bad: 'Код не подошел или устарел. Новый код: сайт, раздел «Статистика», ваш турнир, «Подключить».',
  retry: 'Не получилось подключить чат, отправьте команду еще раз.',
  done: (name) => `Чат подключен к турниру «${name}». Сюда будут приходить приглашения за столы турнира.`,
  off: (name) => `Чат отключен от турнира «${name}». Приглашения сюда больше не придут.`,
};
