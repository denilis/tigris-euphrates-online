// Все маршруты API. Без привязки к Vercel и Node HTTP: call({ method, path, query, body, token })
// → { status, body }. Функция Vercel (api/index.js) и локальный сервер (dev/server.js) — тонкие
// переходники. Запись стола атомарна по версии: два хода в один стол не портят партию.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readSession, signSession, normalizeCode, codeHash, isPin, pinHash, newCode, newTableCode } from './auth.js';
import {
  createTable, sit, leave, seatPeople, unseat, setHero, setOptions, setSeatCount, setSeatKind, setBot, moveSeat,
  start, submit, rematch, close, historyEntry, botDue, seatOfUser, TableError, undo, confirmDue, autoConfirm, tableDay, pause, ready,
} from '../game/table.js';
import { viewFor } from '../game/view.js';
import { botStep } from '../game/bots.js';
import { companyKey } from '../game/order.js';
import { SEASON, tourGames, publicTour } from './stats.js';
import { keepFinishedOnce } from './keep.js';
import { cleanPrefs } from './prefs.js';
import { parseAvatar } from './avatar.js';
import { telegram, inChat, invited, called } from './telegram.js';
import { ENGINE } from '../game/vendor/version.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const http = (status, code, message) => {
  throw new HttpError(status, code, message);
};

const ADMIN_ID = 'u-admin';
const LOCK_MS = 30000;
const SESSION_MAX_MS = 90 * 24 * 3600 * 1000; // потом нужен код снова
const ACTIVATE_LIMIT = 20; // попыток входа с одного адреса
const ACTIVATE_WINDOW_MS = 10 * 60 * 1000; // за это время
const PIN_LIMIT = 30, PIN_WINDOW_MS = 24 * 3600 * 1000; // короткий код легко подобрать: попытки считаются со всех адресов вместе
const TITLE_DAY_MS = 3 * 24 * 3600 * 1000; // счетчик столов за день живет дольше самого дня
// кто на сайте. Пульс идет часто, а скрипт Upstash считает команду за каждый вызов внутри, поэтому
// чтение это один MGET, а отметка обновляется реже: 10 человек укладываются в бесплатный лимит
const ONLINE_MS = 90 * 1000; // без отметки дольше человек уже не на сайте
const MARK_EVERY_MS = 45 * 1000;
const MARK_TTL_MS = 15 * 60 * 1000; // сколько отметка живет в базе
const PEOPLE_CACHE_MS = 60 * 1000; // список людей для пульса, чтобы не читать его каждый раз
const INVITE_MS = 10 * 60 * 1000; // приглашение устаревает
const CHAT_CALL_MS = 3 * 60 * 1000; // повторно позвать в чат с того же стола
const CHAT_CALLS = 3; // и всего от одного игрока за это время: новые столы не обходят замок стола
const TOUR_NAME_MAX = 40, TOURS_MAX = 50;
// метка стола для опроса: решает бот или ждет окно подтверждения (c<срок>), которое
// завершит любой клиент через bot-tick, когда срок выйдет
const meta = (t) => (botDue(t) !== null ? 'bot' : t.status === 'playing' && t.game?.confirmBy ? `c${t.game.confirmBy}` : '');
const due = (m, at) => m === 'bot' || (m[0] === 'c' && at >= Number(m.slice(1)));
const publicUser = (u) => ({ id: u.id, name: u.name, admin: Boolean(u.admin), main: u.id === ADMIN_ID, avatar: u.avatar || null });
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : 0);
const letterId = () => randomBytes(6).toString('hex');

export function createApp({ store, env = {}, now = () => Date.now(), botOptions = {}, tg = telegram(env) }) {
  const secret = env.SESSION_SECRET, pepper = env.CODE_PEPPER;
  const adminCode = normalizeCode(env.ADMIN_CODE || '');
  const adminHash = adminCode && pepper ? Buffer.from(codeHash(adminCode, pepper)) : null;
  const adminPin = String(env.ADMIN_PIN || '').trim();
  const adminPinHash = isPin(adminPin) && pepper ? Buffer.from(pinHash(adminPin, pepper)) : null;
  const botBudget = Number(env.BOT_BUDGET_MS) || 20000;

  // --- вход

  async function auth(token, { light = false } = {}) {
    if (!secret || !pepper) http(500, 'not-configured', 'Сервер не настроен: нет SESSION_SECRET или CODE_PEPPER');
    const s = readSession(token, secret);
    if (!s) http(401, 'no-session', 'Нужен код активации');
    if (!(now() - s.iat <= SESSION_MAX_MS)) http(401, 'expired', 'Сессия закончилась, введите код снова');
    if (light) return { id: s.userId, epoch: s.epoch };
    const u = await store.getUser(s.userId);
    checkUser(u, s.epoch);
    return u;
  }
  function checkUser(u, epoch) {
    if (!u || u.revoked) http(401, 'revoked', 'Код отозван, попросите новый у администратора');
    // отзыв и новый код увеличивают sv: токены, выданные до этого, больше не действуют
    if ((u.sv || 0) !== epoch) http(401, 'replaced', 'Код заменён, введите новый код');
  }
  const needAdmin = (u) => u.admin || http(403, 'not-admin', 'Это может сделать только администратор');
  const needMain = (u) => u.id === ADMIN_ID || http(403, 'not-main', 'Это может сделать только главный администратор');

  async function mainAdmin() {
    let user = await store.getUser(ADMIN_ID);
    if (!user) {
      user = { id: ADMIN_ID, name: env.ADMIN_NAME || 'Денис', admin: true, revoked: false, createdAt: now() };
      await store.putUser(user);
    }
    return user;
  }

  /** Вход коротким кодом: лимит общий, длинный код при подборе продолжает работать. */
  async function pinEntry(raw) {
    const pin = typeof raw === 'string' ? raw.trim() : '';
    if (!adminPinHash || !isPin(pin) || pin.length !== adminPin.length) return null;
    if ((await store.hit('pin', PIN_WINDOW_MS)) > PIN_LIMIT) http(429, 'too-many', 'Слишком много попыток входа, попробуйте завтра');
    return timingSafeEqual(Buffer.from(pinHash(pin, pepper)), adminPinHash) ? mainAdmin() : null;
  }

  async function activate(body, ip) {
    if (!secret || !pepper) http(500, 'not-configured', 'Сервер не настроен');
    // каждая попытка считается, верная тоже: подбирать код под лимитом не получится
    if ((await store.hit(`act:${ip || 'unknown'}`, ACTIVATE_WINDOW_MS)) > ACTIVATE_LIMIT) {
      http(429, 'too-many', 'Слишком много попыток входа, подождите несколько минут');
    }
    let user = await pinEntry(body.code);
    if (!user) {
      const code = normalizeCode(body.code);
      if (!code) http(401, 'bad-code', 'Код не подошёл');
      const hash = Buffer.from(codeHash(code, pepper));
      if (adminHash && hash.length === adminHash.length && timingSafeEqual(hash, adminHash)) {
        user = await mainAdmin();
      } else {
        const id = await store.userIdByCode(hash.toString());
        user = id && (await store.getUser(id));
        if (!user || user.revoked) http(401, 'bad-code', 'Код не подошёл');
      }
    }
    return { token: signSession(user.id, secret, now(), user.sv || 0), user: publicUser(user) };
  }

  /** Занять код за человеком: свой из формы или случайный. Занятый отклоняем: вход молча перешел бы к другому. */
  async function claimCode(raw, id, u) {
    const text = String(raw ?? '').trim();
    // ответ «занят» подтверждает чужой код, поэтому подбор ограничен так же, как при входе
    if (text && (await store.hit(`claim:${u.id}`, ACTIVATE_WINDOW_MS)) > ACTIVATE_LIMIT) {
      http(429, 'too-many', 'Слишком много попыток, подождите несколько минут');
    }
    const code = text ? normalizeCode(text) : newCode();
    if (!code) http(400, 'bad-code-format', 'Код: от 8 до 20 латинских букв и цифр');
    const hash = codeHash(code, pepper);
    const isMainCode = adminHash && timingSafeEqual(Buffer.from(hash), adminHash);
    if (isMainCode || !(await store.claimCode(hash, id))) http(409, 'code-taken', 'Этот код уже занят');
    return { code, hash };
  }

  async function adminUsers(method, rest, body, u) {
    needAdmin(u);
    if (method === 'GET' && !rest.length) {
      return (await store.listUsers()).map((x) => ({ ...publicUser(x), revoked: Boolean(x.revoked), createdAt: x.createdAt }));
    }
    if (method === 'POST' && !rest.length) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 30) http(400, 'bad-name', 'Имя от 1 до 30 знаков');
      if (body.admin) needMain(u);
      // имя это лицо человека в приглашениях и в зачете, два Андрея там неотличимы
      const same = (await store.listUsers()).some((x) => x.name.trim().toLowerCase() === name.toLowerCase());
      if (same) http(409, 'name-taken', 'Такое имя уже есть');
      const id = 'u-' + randomBytes(6).toString('hex');
      const { code, hash } = await claimCode(body.code, id, u);
      const user = { id, name, admin: Boolean(body.admin), revoked: false, codeHash: hash, createdAt: now() };
      await store.putUser(user);
      forgetPeople();
      return { user: publicUser(user), code };
    }
    const [id, op] = rest;
    const user = await store.getUser(id);
    if (!user) http(404, 'no-user', 'Нет такого игрока');
    // главного не трогает никто, назначенных администраторов только главный
    if (user.id === ADMIN_ID) http(403, 'not-main', 'Главного администратора менять нельзя');
    if (user.admin) needMain(u);
    if (method === 'POST' && op === 'revoke') {
      if (user.codeHash) await store.delCode(user.codeHash);
      await store.putUser({ ...user, revoked: true, codeHash: null, sv: (user.sv || 0) + 1 });
      forgetPeople();
      return { ok: true };
    }
    if (method === 'POST' && op === 'code') {
      const { code, hash } = await claimCode(body.code, id, u);
      if (user.codeHash) await store.delCode(user.codeHash);
      await store.putUser({ ...user, revoked: false, codeHash: hash, sv: (user.sv || 0) + 1 });
      forgetPeople();
      return { code };
    }
    if (method === 'POST' && op === 'admin') {
      needMain(u);
      await store.putUser({ ...user, admin: Boolean(body.admin) });
      forgetPeople();
      return { ok: true };
    }
    http(404, 'no-route', 'Нет такого адреса');
  }

  // --- фото игрока

  /**
   * Новое фото или null, чтобы убрать. Номер случайный и новый: браузер хранит картинку вечно.
   * Запись игрока сверяется с базой: одновременный отзыв кода или смена прав не должны потеряться.
   * Старый файл стирается последним, чтобы при сбое запись не указывала на пустое место.
   */
  async function setAvatar(u, body) {
    if ((await store.hit(`ava:${u.id}`, ACTIVATE_WINDOW_MS)) > ACTIVATE_LIMIT) http(429, 'too-many', 'Слишком часто, подождите несколько минут');
    let avatar = null;
    if (body.image !== null) {
      const pic = parseAvatar(body.image);
      if (!pic) http(400, 'bad-image', 'Фото не подошло, попробуйте другое');
      avatar = randomBytes(16).toString('hex');
      await store.setAvatar(avatar, pic);
    }
    for (let k = 0; k < 4; k++) {
      const cur = await store.getUser(u.id);
      if (!cur || cur.revoked) break;
      const user = { ...cur, avatar };
      if (await store.casUser(cur, user)) {
        if (cur.avatar) await store.delAvatar(cur.avatar);
        forgetPeople();
        return { user: publicUser(user) };
      }
    }
    if (avatar) await store.delAvatar(avatar);
    http(409, 'stale', 'Не получилось сохранить фото, попробуйте еще раз');
  }

  async function avatarFile(token) {
    const file = /^[0-9a-f]{32}$/.test(token || '') ? await store.getAvatar(token) : null;
    if (!file) http(404, 'no-avatar', 'Нет такого фото');
    return { file };
  }

  // --- турниры

  /** Все турниры от старых к новым: порядок решает, в какой идет партия, подходящая к двум. */
  const allTours = async () => [SEASON, ...(await store.listTours()).sort((a, b) => a.createdAt - b.createdAt)];

  async function toursInfo() {
    const users = (await store.listUsers()).filter((x) => !x.revoked);
    return { tours: (await allTours()).map(publicTour), people: users.map((x) => ({ id: x.id, name: x.name })) };
  }

  async function newTour(u, body) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > TOUR_NAME_MAX) http(400, 'bad-name', `Название от 1 до ${TOUR_NAME_MAX} знаков`);
    const list = Array.isArray(body.players) ? body.players.map(String) : [];
    const ids = [...new Set(list)];
    if (ids.length !== list.length || ids.length < 2 || ids.length > 4) http(400, 'bad-players', 'В турнире от 2 до 4 разных участников');
    const tours = await allTours();
    if (tours.length >= TOURS_MAX) http(409, 'too-many', 'Турниров слишком много');
    if (tours.some((t) => t.name.toLowerCase() === name.toLowerCase())) http(409, 'name-taken', 'Такой турнир уже есть');
    const users = await Promise.all(ids.map((id) => store.getUser(id)));
    if (users.some((x) => !x || x.revoked)) http(400, 'bad-players', 'Участником может быть только игрок с действующим кодом');
    const t = { id: 't-' + randomBytes(5).toString('hex'), name, ownerId: u.id, players: users.map((x) => ({ id: x.id, name: x.name })), createdAt: now() };
    await store.putTour(t);
    return publicTour(t);
  }

  async function stats(query) {
    await keepFinishedOnce(store); // один раз после выкладки: старые законченные столы без срока и с кодом в истории
    const tours = await allTours();
    const tour = tours.find((t) => t.id === query.tour) || SEASON;
    const users = await store.listUsers();
    const face = (p) => users.find((x) => (p.id ? x.id === p.id : x.name.trim().toLowerCase() === p.name.toLowerCase()))?.avatar || null;
    return { tour: publicTour(tour), players: tour.players.map((p) => p.name), avatars: tour.players.map(face), games: tourGames(tour, tours, await store.listHistory()) };
  }

  // --- чат Telegram

  /** Стол для чата: и тот, кто действует, и все люди за столом из его компании. */
  const chatTable = (t, u) => inChat(u.name) && t.seats.every((s) => s.kind !== 'human' || !s.userId || inChat(s.name));

  /** Позвать чат за стол. Замок снимается при сбое, чтобы отправку можно было сразу повторить. */
  async function callChat(u, body) {
    if (!tg.on) http(503, 'no-chat', 'Чат Telegram не подключён');
    const { doc: t } = await load(String(body.code));
    if (t.status !== 'lobby') http(409, 'not-lobby', 'Партия уже началась');
    if (t.hostUserId !== u.id && !seatOfUser(t, u.id)) http(403, 'not-seated', 'Позвать может только тот, кто за столом');
    if (!chatTable(t, u)) http(403, 'not-chat', 'Чат только для Дениса, Андрея и Влада');
    const humans = t.seats.filter((s) => s.kind === 'human');
    const free = humans.filter((s) => !s.userId).length;
    const others = humans.filter((s) => s.userId && s.userId !== u.id).map((s) => s.name);
    if (!free && !others.length) http(409, 'no-seats', 'Свободных мест нет');
    if ((await store.hit(`tg:call:${u.id}`, CHAT_CALL_MS)) > CHAT_CALLS) http(429, 'too-many', 'Слишком часто, подождите пару минут');
    const key = `tg:${t.code}`, token = letterId();
    if (!(await store.lock(key, token, CHAT_CALL_MS))) http(429, 'too-many', 'Уже позвали, подождите пару минут');
    // стол полон: мест не предлагаем, а зовем тех, кого за него посадили
    if (!(await tg.say(free ? invited(u.name, t, free) : called(u.name, t, others)))) {
      await store.unlock(key, token);
      http(502, 'chat-failed', 'Не удалось отправить в чат, попробуйте позже');
    }
    return { ok: true };
  }

  /** Сообщение о посаженных за стол: null, если чат здесь ни при чем. Люди уже сидят, поэтому сбой только возвращает false. */
  async function chatPeople(u, t, names) {
    if (!chatTable(t, u)) return null;
    if (!tg.on) return false;
    try {
      if ((await store.hit(`tg:call:${u.id}`, CHAT_CALL_MS)) > CHAT_CALLS) return false;
      return await tg.say(called(u.name, t, names));
    } catch (e) {
      console.error('telegram', e.message);
      return false;
    }
  }

  // --- кто на сайте и приглашения

  let people = { at: -Infinity, byId: new Map() };
  const forgetPeople = () => { people = { at: -Infinity, byId: new Map() }; };

  async function knownPeople(fresh = false) {
    if (fresh || now() - people.at > PEOPLE_CACHE_MS) {
      people = { at: now(), byId: new Map((await store.listUsers()).map((x) => [x.id, x])) };
    }
    return people.byId;
  }

  /** Пульс: кто на сайте и письма мне. Обычный пульс это одна команда базы. */
  async function beat(s, body) {
    let u = (await knownPeople()).get(s.id);
    // код мог смениться на другом экземпляре функции: перед отказом смотрим свежий список,
    // иначе честного игрока выбросит с сайта. Отозванный код на чужом экземпляре живет до минуты
    if (!u || u.revoked || (u.sv || 0) !== s.epoch) u = (await knownPeople(true)).get(s.id);
    checkUser(u, s.epoch);
    const ids = [...(await knownPeople()).values()].filter((x) => !x.revoked).map((x) => x.id);
    const { marks, letters } = await store.readPresence(ids, u.id);
    const t = now(), busy = Boolean(body.busy);
    const mine = marks.find((m) => m?.id === u.id);
    const avatar = u.avatar || null;
    if (!mine || mine.busy !== busy || mine.avatar !== avatar || t - mine.at >= MARK_EVERY_MS) {
      await store.setPresence(u.id, { id: u.id, name: u.name, avatar, busy, at: t }, MARK_TTL_MS);
    }
    return {
      me: publicUser(u),
      online: marks.filter((m) => m && m.id !== u.id && t - m.at <= ONLINE_MS).map(({ id, name, avatar: a, busy: b }) => ({ id, name, avatar: a || null, busy: b })),
      inbox: letters.filter((m) => t - m.at <= INVITE_MS),
    };
  }

  /** Все, кого можно позвать: для окна выбора в лобби. */
  async function peopleList() {
    const known = await knownPeople(true);
    return [...known.values()].filter((x) => !x.revoked).map((x) => ({ id: x.id, name: x.name, avatar: x.avatar || null }));
  }

  /** Записи выбранных людей; чужой или отозванный номер отклоняет весь выбор. */
  async function inviteesOf(ids, u) {
    const list = [...new Set(Array.isArray(ids) ? ids : [])];
    if (!list.length || list.length > 4) http(400, 'bad-invite', 'Выберите, кого пригласить');
    const known = await knownPeople(true);
    return list.map((id) => {
      const p = known.get(id);
      if (!p || p.revoked || p.id === u.id) http(400, 'bad-invite', 'Этого игрока нельзя пригласить');
      return p;
    });
  }

  /** Отказ по письму letter освобождает только то место, на которое посадили этим письмом. */
  async function giveUpSeat(code, u, letter) {
    for (let k = 0; k < 3; k++) {
      const cur = await store.getTable(code);
      if (!cur || cur.doc.status !== 'lobby' || seatOfUser(cur.doc, u.id)?.invited !== letter) return;
      leave(cur.doc, u.id, now());
      if (await store.putTable(cur.doc, cur.version, meta(cur.doc))) return;
    }
  }

  async function invite(u, body) {
    if (!Array.isArray(body.to) || !body.to.length || body.to.length > 12) http(400, 'bad-invite', 'Выберите, кого пригласить');
    const { doc: t } = await load(String(body.code));
    // партия на паузе: зовем назад тех, кто уже за столом, по номерам мест (адреса игроков в вид не попадают)
    if (t.status === 'playing' && t.game?.paused) {
      if (!seatOfUser(t, u.id)) http(403, 'not-seated', 'Позвать может только тот, кто за столом');
      const back = t.seats.filter((s) => s.kind === 'human' && s.userId && s.userId !== u.id && body.to.includes(s.id));
      for (const s of back) {
        await store.pushInbox(s.userId, { id: letterId(), kind: 'invite', seated: true, from: u.name, fromId: u.id, code: t.code, title: t.title || t.code, at: now() }, INVITE_MS);
      }
      return { sent: back.length };
    }
    if (t.status !== 'lobby') http(409, 'not-lobby', 'Партия уже началась');
    if (t.hostUserId !== u.id && !seatOfUser(t, u.id)) http(403, 'not-seated', 'Пригласить может только тот, кто за столом');
    const known = await knownPeople(true);
    const ids = [...new Set(body.to)].filter((id) => id !== u.id && known.get(id) && !known.get(id).revoked);
    for (const id of ids) {
      await store.pushInbox(id, { id: letterId(), kind: 'invite', from: u.name, fromId: u.id, code: t.code, title: t.title || t.code, at: now() }, INVITE_MS);
    }
    return { sent: ids.length };
  }

  /** Ответ на письмо из своего ящика: чужое или уже отвеченное не считается. Отказ уходит пригласившему. */
  async function answer(u, body) {
    const { letters } = await store.readPresence([], u.id);
    const m = letters.find((x) => x.id === body.id);
    if (!m) return { ok: false };
    await store.dropLetter(u.id, m.id, INVITE_MS);
    if (m.kind === 'invite' && !body.accept) {
      await store.pushInbox(m.fromId, { id: letterId(), kind: 'declined', from: u.name, title: m.title, at: now() }, INVITE_MS);
      if (m.seated) await giveUpSeat(m.code, u, m.id);
    }
    return { ok: true };
  }

  // --- столы

  async function load(code) {
    const cur = await store.getTable(code);
    if (!cur || cur.doc.status === 'deleted') http(404, 'no-table', 'Нет такого стола');
    return cur;
  }

  /** Столы, где партия не начиналась. Общего списка столов нет, собираем по спискам игроков. */
  async function openTables() {
    const lists = await Promise.all((await store.listUsers()).map((x) => store.myTables(x.id)));
    const docs = await store.getTables([...new Set(lists.flat())]);
    return docs.filter((t) => t?.status === 'lobby').sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => ({ code: t.code, title: t.title || null, updatedAt: t.updatedAt, seats: t.seats.map((s) => ({ kind: s.kind, name: s.name })) }));
  }

  /**
   * Удалить стол, где партия не начиналась. Сначала запись по версии: если партию начали
   * в этот же момент, удаление не пройдет. Сбой после нее оставит стол скрытым до срока хранения.
   */
  async function deleteTable(code) {
    const { doc: t, version } = await load(code);
    // законченная партия хранится для статистики; досрочно завершенную итога нет, ее можно удалить
    if (t.status !== 'lobby' && t.status !== 'closed') http(409, 'not-lobby', 'Удалить можно стол, где партия не начиналась или завершена досрочно');
    t.status = 'deleted';
    t.version = version + 1;
    if (!(await store.putTable(t, version, ''))) http(409, 'stale', 'Стол уже изменился, обновите');
    await store.delTable(code);
    await Promise.all((await store.listUsers()).map((x) => store.dropMyTable(x.id, code)));
    return { ok: true };
  }

  async function adminTables(method, rest, u) {
    needAdmin(u);
    if (method === 'GET' && !rest.length) return openTables();
    if (method === 'POST' && rest.length === 2 && rest[1] === 'delete') return deleteTable(rest[0]);
    http(404, 'no-route', 'Нет такого адреса');
  }

  /** Итог законченной партии в историю: один раз, повтор безопасен. */
  async function ensureHistory(t, version) {
    if (t.status !== 'over' || t.game.historySaved) return;
    const e = historyEntry(t);
    await store.addHistory(e);
    await store.setCompanyLast(e);
    t.game.historySaved = true;
    t.version = version + 1;
    if (!(await store.putTable(t, version, meta(t)))) t.version = version; // не вышло: допишет следующий запрос
  }

  /** Название стола: дата по Москве и номер стола за этот день (30.10.2026.1). */
  async function tableTitle() {
    const day = tableDay(now());
    return `${day}.${await store.hit(`day:${day}`, TITLE_DAY_MS)}`;
  }

  async function newTable(u) {
    const title = await tableTitle();
    for (let k = 0; k < 5; k++) {
      const t = createTable({ code: newTableCode(), title, host: { userId: u.id, name: u.name, avatar: u.avatar }, now: now() });
      if (await store.putTable(t, null, meta(t))) {
        await store.addMyTable(u.id, t.code);
        return { code: t.code, view: viewFor(t, u.id, { now: now() }) };
      }
    }
    http(500, 'no-code', 'Не удалось подобрать код стола');
  }

  async function myTables(u) {
    const codes = await store.myTables(u.id);
    const docs = await store.getTables(codes);
    return docs.filter((t) => t && t.status !== 'deleted').map((t) => ({
      code: t.code, title: t.title || null, status: t.status, updatedAt: t.updatedAt, next: t.next || null,
      paused: Boolean(t.game?.paused),
      me: seatOfUser(t, u.id)?.id ?? null,
      toMove: t.game?.toMove ?? null,
      seats: t.seats.map((s) => ({ id: s.id, kind: s.kind, name: s.name, hero: s.hero })),
    }));
  }

  const ACTIONS = {
    pause: (t, u) => pause(t, u.id, now()),
    ready: (t, u) => ready(t, u.id, now()),
    sit: (t, u, b) => sit(t, { userId: u.id, name: u.name, avatar: u.avatar }, b.seat, now()),
    leave: (t, u) => leave(t, u.id, now()),
    unseat: (t, u, b) => unseat(t, u.id, b.seat, now()),
    async invitePeople(t, u, b) {
      const chosen = await inviteesOf(b.ids, u);
      const seated = chosen.map((p) => ({ userId: p.id, name: p.name, avatar: p.avatar, letter: letterId() }));
      seatPeople(t, u.id, seated, now(), b.seat);
      return {
        commit: async () => {
          for (const p of seated) {
            try {
              await store.addMyTable(p.userId, t.code);
              await store.pushInbox(p.userId, { id: p.letter, kind: 'invite', seated: true, from: u.name, fromId: u.id, code: t.code, title: t.title || t.code, at: now() }, INVITE_MS);
            } catch (e) {
              console.error('invite', e.message); // люди уже за столом: сбой письма не отменяет посадку
            }
          }
          return { chat: await chatPeople(u, t, seated.map((p) => p.name)) };
        },
      };
    },
    hero: (t, u, b) => setHero(t, u.id, b.seat, b.hero, now()),
    options: (t, u, b) => setOptions(t, u.id, b.options || {}, now()),
    seatCount: (t, u, b) => setSeatCount(t, u.id, b.n, now()),
    seatKind: (t, u, b) => setSeatKind(t, u.id, b.seat, b.kind, now()),
    bot: (t, u, b) => setBot(t, u.id, b.seat, b.settings || {}, now()),
    moveSeat: (t, u, b) => moveSeat(t, u.id, b.seat, b.to, now()),
    move: (t, u, b) => submit(t, u.id, { version: b.version, index: b.index }, { now: now() }),
    undo: (t, u, b) => undo(t, u.id, { version: b.version }, { now: now() }),
    close: (t, u) => close(t, u.id, now()),
    async start(t, u) {
      const humans = t.seats.filter((s) => s.kind === 'human').map((s) => s.userId);
      const last = t.options.order === 'loser' && humans.every(Boolean) ? await store.companyLast(companyKey(humans)) : null;
      start(t, u.id, { last, now: now() });
    },
    async rematch(t, u) {
      if (t.next) return;
      let code;
      for (let k = 0; k < 5 && !code; k++) {
        const c = newTableCode();
        if (!(await store.getTable(c))) code = c;
      }
      if (!code) http(500, 'no-code', 'Не удалось подобрать код стола');
      // отказ rematch не должен расходовать номер стола за день
      const title = t.status === 'over' && seatOfUser(t, u.id) ? await tableTitle() : null;
      const { created } = rematch(t, u.id, { code, title, now: now() });
      if (!(await store.putTable(created, null, meta(created)))) http(409, 'stale', 'Реванш уже создан, обновите');
      // в списки игроков новый стол попадает, только если старый записался по версии; кто проиграл
      // гонку (нажали несколько человек), убирает свой стол, и лишних партий в списках не остаётся
      return {
        commit: async () => {
          for (const s of created.seats) if (s.kind === 'human') await store.addMyTable(s.userId, created.code);
        },
        rollback: () => store.delTable(created.code),
      };
    },
  };

  async function act(code, u, body) {
    const { doc: t, version } = await load(code);
    // действие только из своего списка: constructor, toString и прочее из прототипа не в счет
    const fn = typeof body.action === 'string' && Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) http(400, 'bad-action', 'Неизвестное действие');
    const hooks = await fn(t, u, body); // действие может вернуть { commit, rollback } для побочных записей
    if (!(await store.putTable(t, version, meta(t)))) {
      await hooks?.rollback?.();
      http(409, 'stale', 'Стол уже изменился, обновите');
    }
    const extra = await hooks?.commit?.(); // поля для ответа, например ушло ли сообщение в чат
    if (body.action === 'sit') await store.addMyTable(u.id, code);
    if (t.status === 'over') await ensureHistory(t, t.version);
    return { ...viewFor(t, u.id, { now: now() }), ...extra };
  }

  /**
   * Ходы ботов, пока решает бот и есть время, и завершение хода, у которого вышло окно
   * подтверждения; замок не даёт двум вызовам думать за одного бота.
   */
  async function botTick(code) {
    await load(code);
    const token = randomBytes(12).toString('hex');
    if (!(await store.lock(code, token, LOCK_MS))) return { moved: 0, locked: true };
    let moved = 0;
    const t0 = now();
    try {
      while (now() - t0 < botBudget) {
        const cur = await store.getTable(code);
        if (!cur) break;
        if (confirmDue(cur.doc, now())) autoConfirm(cur.doc, { now: now() });
        else if (botDue(cur.doc) !== null) await botStep(cur.doc, { now: now(), ...botOptions });
        else break;
        if (!(await store.putTable(cur.doc, cur.version, meta(cur.doc)))) break;
        moved++;
        if (cur.doc.status === 'over') await ensureHistory(cur.doc, cur.doc.version);
      }
    } finally {
      await store.unlock(code, token);
    }
    const p = await store.poll(code);
    return { moved, locked: false, botDue: due(p?.meta || '', now()), version: p?.version ?? null };
  }

  // --- маршрутизация

  async function dispatch({ method, path, query, body, token, ip }) {
    const seg = String(path || '').split('/').filter(Boolean);
    const [head, ...rest] = seg;
    if (method === 'GET' && head === 'ping') {
      return { ok: true, env: env.VERCEL_ENV || 'local', region: env.VERCEL_REGION || null, engine: ENGINE.commit.slice(0, 7), store: store.kind, chat: tg.on };
    }
    if (method === 'POST' && head === 'activate') return activate(body, ip);
    if (method === 'GET' && head === 'avatar') return avatarFile(rest.join('/'));
    if (head === 'tables' && rest.length === 2 && rest[1] === 'poll' && method === 'GET') {
      await auth(token, { light: true });
      const p = await store.poll(rest[0]);
      if (!p) http(404, 'no-table', 'Нет такого стола');
      return { version: p.version, botDue: due(p.meta, now()), locked: p.locked };
    }
    if (method === 'POST' && head === 'beat') return beat(await auth(token, { light: true }), body);
    const u = await auth(token);
    if (method === 'GET' && head === 'me') return publicUser(u);
    if (method === 'POST' && head === 'me' && rest[0] === 'avatar') return setAvatar(u, body);
    if (method === 'POST' && head === 'invite' && rest[0] === 'chat') return callChat(u, body);
    if (method === 'POST' && head === 'invite') return invite(u, body);
    if (method === 'POST' && head === 'invites' && rest[0] === 'answer') return answer(u, body);
    if (method === 'GET' && head === 'people') return peopleList();
    if (method === 'GET' && head === 'stats') return stats(query);
    if (method === 'GET' && head === 'tournaments') return toursInfo();
    if (method === 'POST' && head === 'tournaments') return newTour(u, body);
    if (method === 'GET' && head === 'prefs') return (await store.getPrefs(u.id)) || {};
    if (method === 'POST' && head === 'prefs') {
      await store.setPrefs(u.id, cleanPrefs(body));
      return { ok: true };
    }
    if (head === 'admin' && rest[0] === 'users') return adminUsers(method, rest.slice(1), body, u);
    if (head === 'admin' && rest[0] === 'tables') return adminTables(method, rest.slice(1), u);
    if (head === 'tables') {
      if (!rest.length && method === 'POST') return newTable(u);
      if (!rest.length && method === 'GET') return myTables(u);
      const [code, op] = rest;
      if (!op && method === 'GET') {
        const { doc, version } = await load(code);
        if (doc.status === 'over') await ensureHistory(doc, version);
        return viewFor(doc, u.id, { logFrom: int(query.logFrom), now: now() });
      }
      if (!op && method === 'POST') return act(code, u, body);
      if (op === 'bot-tick' && method === 'POST') return botTick(code);
    }
    http(404, 'no-route', 'Нет такого адреса');
  }

  async function call({ method = 'GET', path = '', query = {}, body = {}, token = null, ip = '' } = {}) {
    try {
      return { status: 200, body: await dispatch({ method, path, query: query || {}, body: body || {}, token, ip }) };
    } catch (e) {
      if (e instanceof HttpError || e instanceof TableError) return { status: e.status, body: { error: e.code, message: e.message } };
      console.error(e);
      return { status: 500, body: { error: 'server', message: 'Ошибка сервера' } };
    }
  }

  return { call };
}
