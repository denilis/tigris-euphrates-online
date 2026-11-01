// Приглашения в чат компании через бота Telegram. Другого в чат не пишем (решение Дениса 01.11):
// ни кто зашел на сайт, ни о начале партии. Отправка не должна мешать игре: say не бросает
// ошибок и ждет недолго. Пишет только основной сайт, превью и локальный сервер молчат.
const WAIT_MS = 5000; // первый запрос после простоя у Telegram занимал больше 2,5 с
const TOKEN = /\d{5,}:[\w-]{30,}/; // номер бота, двоеточие и длинный ключ

export const SITE = 'https://tigris-euphrates-online.vercel.app/';

// чат пока один и свой у этой компании, у других игроков будут свои: о них сюда не пишем
export const CHAT_PEOPLE = ['денис', 'андрей', 'влад'];
export const inChat = (name) => CHAT_PEOPLE.includes(String(name).trim().toLowerCase());

const tableUrl = (t) => `${SITE}#/t/${t.code}`;
const tableName = (t) => t.title || t.code;

export function telegram(env, { fetchFn = fetch, waitMs = WAIT_MS } = {}) {
  // значения вставляют руками в панели Vercel, вместе с токеном часто попадает лишний текст;
  // без токена в значении чат не подключен, и /api/ping это покажет
  const token = TOKEN.exec(String(env.TELEGRAM_BOT_TOKEN))?.[0], chat = String(env.TELEGRAM_CHAT_ID || '').trim();
  const on = Boolean(token && chat && env.VERCEL_ENV === 'production');

  /** Отправить сообщение с кнопкой-ссылкой. Текст простой: имена не разбираются как разметка. */
  async function say({ text, button, url }) {
    if (!on) return false;
    try {
      const r = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, reply_markup: { inline_keyboard: [[{ text: button, url }]] } }),
        signal: AbortSignal.timeout(waitMs),
      });
      if (r.ok) return true;
      const why = await r.json().catch(() => null);
      console.error('telegram', r.status, why?.description || '');
    } catch (e) {
      console.error('telegram', e.name); // текст ошибки может содержать адрес с токеном
    }
    return false;
  }

  return { on, say };
}

export const invited = (name, t, free) => ({
  text: `${name} зовёт на партию\nСтол ${tableName(t)}, свободно мест: ${free}`,
  button: 'Сесть за стол',
  url: tableUrl(t),
});

/** Хозяин посадил выбранных людей за стол. */
export const called = (name, t, names) => ({
  text: `${name} зовёт за стол: ${names.join(', ')}\nСтол ${tableName(t)}`,
  button: 'Открыть стол',
  url: tableUrl(t),
});
