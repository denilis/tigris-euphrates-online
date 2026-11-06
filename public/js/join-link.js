// Ссылка-приглашение (Денис 06.11): адрес и тексты. Без браузерных зависимостей, их проверяет
// test/join.test.js; страница новичка в join.js.

/** #/join/<токен>: токен после #, поэтому в адресе до сервера он не доходит. */
export const JOIN_ROUTE = /^join\/([A-Za-z0-9_-]{22})$/;

export const joinUrl = (token, loc = location) => `${loc.origin}${loc.pathname}#/join/${token}`;

const two = (n) => String(n).padStart(2, '0');
/** Дата дд.мм. */
export const dayMonth = (ms) => { const d = new Date(ms); return `${two(d.getDate())}.${two(d.getMonth() + 1)}`; };

/** Подпись под только что созданной ссылкой. */
export function linkNote({ until, table }) {
  return `${table ? `Новичок впишет имя, получит код и сядет на свободное место за столом ${table.title}. ` : 'Новичок впишет имя, получит код и сразу войдет. '}`
    + `Ссылка на одного человека, действует до ${dayMonth(until)}. Показывается один раз: сразу отправьте ее.`;
}

/** Строка списка действующих ссылок в «Кодах игроков». */
export const linkLine = ({ createdAt, until, table }) => `создана ${dayMonth(createdAt)}, действует до ${dayMonth(until)}${table ? `, за стол ${table.title}` : ''}`;

/** Сообщение об ошибке при регистрации по ссылке. */
export function joinError(e) {
  if (e.code === 'join-gone') return 'Ссылка уже не действует: ее использовали, отозвали или прошла неделя. Попросите у пригласившего новую.';
  if (e.code === 'name-taken') return 'Такое имя уже есть. Добавьте букву или возьмите ник.';
  return e.message || 'Не получилось, попробуйте еще раз.';
}
