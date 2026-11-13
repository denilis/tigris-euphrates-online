// Все маршруты API. Без привязки к Vercel и Node HTTP: call({ method, path, query, body, token })
// → { status, body }. Функция Vercel (api/index.js) и локальный сервер (dev/server.js) — тонкие
// переходники. Запись стола атомарна по версии: два хода в один стол не портят партию.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readSession, signSession, normalizeCode, codeHash, isPin, pinHash, newCode, newTableCode, newJoinToken, isJoinToken, joinHash } from './auth.js';
import {
  createTable, sit, leave, seatPeople, unseat, setHero, setOptions, setSeatCount, setSeatKind, setBot, moveSeat,
  start, submit, rematch, close, historyEntry, botDue, seatOfUser, TableError, undo, confirmDue, autoConfirm, tableDay, pause, ready, ownPerson, OWN_PEOPLE, HEROES,
} from '../game/table.js';
import { viewFor } from '../game/view.js';
import { replayFrames } from '../game/frames.js';
import { botStep } from '../game/bots.js';
import { companyKey } from '../game/order.js';
import { SEASON, SEASON_PLAYERS, tourGames, publicTour, playerGames, tourOf, tourNames } from './stats.js';
import { whoIs, namesOf, nameKey, normName } from './people.js';
import { ratings, ratedGames, ratingOf } from './rating.js';
import { profileSummary } from './profile.js';
import { STEPS, locked, publicPath, surveyPath, stepPath, pathView } from './novice.js';
import { keepFinishedOnce, detailsOnce } from './keep.js';
import { cleanPrefs } from './prefs.js';
import { parseAvatar } from './avatar.js';
import { telegram, inChat, invited, called, photoButton, CHAT_PEOPLE } from './telegram.js';
import { parsePhoto, photoCaption } from './photo.js';
import { cleanAnalysis, humanSeats } from './analysis.js';
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
// «на месте за столом» в лобби (просьба Дениса 04.11): страница лобби отмечается при опросе не чаще
// раза в 8 с, отметка свежая 20 с и живет в базе 25 с
const HERE_EVERY_MS = 8 * 1000;
const HERE_FRESH_MS = 20 * 1000;
const HERE_TTL_MS = 25 * 1000;
const MARK_TTL_MS = 15 * 60 * 1000; // сколько отметка живет в базе
const PEOPLE_CACHE_MS = 60 * 1000; // список людей для пульса, чтобы не читать его каждый раз
const INVITE_MS = 10 * 60 * 1000; // приглашение устаревает
const CHAT_CALL_MS = 3 * 60 * 1000; // повторно позвать в чат с того же стола
const CHAT_CALLS = 3; // и всего от одного игрока за это время: новые столы не обходят замок стола
const PHOTO_MS = 60 * 1000; // картинку итога одной партии в чат не чаще раза в минуту
const TOUR_NAME_MAX = 40, TOURS_MAX = 50;
const JOIN_MS = 7 * 24 * 3600 * 1000; // ссылка-приглашение действует неделю (Денис 06.11)
const JOIN_ACTIVE_MAX = 10; // действующих ссылок у одного игрока
const NEW_PLAYERS_DAY = 10; // новых игроков в сутки от игрока без прав администратора
const NAME_MIN = 2, NAME_MAX = 30; // свое имя в профиле (13.11)
const NAME_CHANGES_DAY = 5; // смен имени в сутки
// Прежних имен у игрока не больше стольких. Старые имена из списка не вытесняются: по ним за человеком
// держатся сезон BGA, герой и чат, и вытесненное имя мог бы забрать другой (ревью 13.11). Когда список
// полон, новое имя взять нельзя, можно только вернуться к одному из прежних.
const WAS_MAX = 10;
// Имена компании: к ним привязаны сезон BGA, постоянные герои и чат. Занять такое имя может только тот,
// кто его уже носил, или администратор, заводя игрока.
const COMPANY = new Set([...SEASON_PLAYERS, ...OWN_PEOPLE, ...CHAT_PEOPLE].map(nameKey));
// знаки разметки в имени не нужны, а попав на страницу без экранирования, они стали бы кодом
const NAME_BAD = /[<>"&`]/;
const mixedScripts = (name) => name.split(' ').some((w) => /\p{Script=Cyrillic}/u.test(w) && /\p{Script=Latin}/u.test(w));
// метка стола для опроса: решает бот или ждет окно подтверждения (c<срок>), которое
// завершит любой клиент через bot-tick, когда срок выйдет
// b<срок>: бот уже решил и «думает» до срока (пауза 06.11), ход покажет первый bot-tick после
const meta = (t) => (botDue(t) !== null ? (t.game.botPlan ? `b${t.game.botPlan.at}` : 'bot') : t.status === 'playing' && t.game?.confirmBy ? `c${t.game.confirmBy}` : '');
const due = (m, at) => m === 'bot' || ((m[0] === 'c' || m[0] === 'b') && at >= Number(m.slice(1)));
/** Через сколько мс бот «додумает» (браузер спросит ровно тогда), если он уже решил; иначе нет поля. */
const botIn = (m, at) => (m[0] === 'b' && Number(m.slice(1)) > at ? { botIn: Number(m.slice(1)) - at } : {});
const DELETED = 'deleted'; // отметка удаленного стола для опроса: он отвечает «нет такого стола»
const TABLE_LOG_MAX = 300; // журнал удалений хранит последние записи
// path есть, только пока путь новичка не пройден (13.11): по нему страницы показывают опрос и путь
const publicUser = (u) => ({
  id: u.id, name: u.name, admin: Boolean(u.admin), main: u.id === ADMIN_ID, avatar: u.avatar || null,
  ...(publicPath(u) ? { path: publicPath(u) } : {}),
});
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : 0);
const letterId = () => randomBytes(6).toString('hex');

/**
 * botPace — пауза «бот думает» в мс { min, max } (Денис 06.11: первое действие бота до 5 с,
 * второе до 10 с, за ходом можно проследить); null — бот ходит сразу (тесты с остановленными
 * часами). На сайте и локальном сервере пауза включена в api/index.js.
 */
export function createApp({ store, env = {}, now = () => Date.now(), botOptions = {}, botPace = null, tg = telegram(env) }) {
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
  // путь новичка (13.11): пока он не пройден, новых игроков не приглашают и турниров не заводят
  const needOpen = (u) => !locked(u) || http(403, 'novice', 'Это откроется после трех партий пути новичка: он на главной странице');

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

  /**
   * Имя в принятом виде или отказ: длина, без знаков разметки, без смеси русских и латинских букв в
   * одном слове (так «Дeнис» с латинской e не выдать за «Денис»). Имена, заведенные раньше, не трогаем.
   */
  const cleanName = (raw, min = 1) => {
    if (typeof raw !== 'string') http(400, 'bad-name', `Имя от ${min} до ${NAME_MAX} знаков`);
    const name = normName(raw);
    if (name.length < min || name.length > NAME_MAX) http(400, 'bad-name', `Имя от ${min} до ${NAME_MAX} знаков`);
    if (NAME_BAD.test(name)) http(400, 'bad-name', 'В имени нельзя использовать знаки < > " & `');
    if (mixedScripts(name)) http(400, 'bad-name', 'В одном слове не смешивайте русские и латинские буквы');
    return name;
  };
  // имя это лицо человека в приглашениях и в зачете, два Андрея там неотличимы (и с невидимым знаком тоже).
  // Прежние имена тоже заняты: по ним за человеком остаются сезон BGA, герой и старые партии (13.11).
  const nameTaken = (users, name, exceptId = null) => users.some((x) => x.id !== exceptId && namesOf(x).includes(nameKey(name)));
  /** company: имя компании разрешено (его заводит администратор). */
  async function nameFree(name, { company = false } = {}) {
    if (nameTaken(await store.listUsers(), name) || (!company && COMPANY.has(nameKey(name)))) http(409, 'name-taken', 'Такое имя уже есть');
  }
  /** Человек для места за столом: с ключом компании, по которому за ним остается герой (game/table.js ownPerson). */
  const seatUser = (x) => ({ userId: x.id, name: x.name, avatar: x.avatar, person: ownPerson(namesOf(x)) });
  // игрок без прав администратора заводит не больше 10 человек в сутки: кодом или ссылкой
  async function countNewPlayer(u) {
    if (!u.admin && (await store.hit(`newplayer:${u.id}`, 24 * 3600 * 1000)) > NEW_PLAYERS_DAY) http(429, 'too-many', 'Сегодня вы уже завели много игроков, попробуйте завтра');
  }

  /**
   * Коды игроков. Роли (просьба Дениса 04.11): администратор как раньше; подтвержденный игрок
   * (любой с действующим кодом) заводит новых игроков, видит себя и тех, кого пригласил сам (05.11),
   * и может выдать им новый код. Отзыв кода и права администратора только у администраторов.
   * У каждого число партий сайта и время последней (для сортировки, Денис 05.11).
   */
  async function adminUsers(method, rest, body, u) {
    if (method === 'GET' && !rest.length) {
      const all = await store.listUsers();
      const names = new Map(all.map((x) => [x.id, x.name]));
      const list = u.admin ? all : all.filter((x) => x.invitedBy === u.id || x.id === u.id);
      const played = gamesOf(all, await store.listHistory());
      return list.map((x) => ({
        ...publicUser(x), self: x.id === u.id, revoked: Boolean(x.revoked), createdAt: x.createdAt ?? null,
        invitedBy: x.invitedBy ? names.get(x.invitedBy) || null : null,
        games: played.get(x.id)?.n || 0, lastGameAt: played.get(x.id)?.last ?? null,
        // прежние имена видит администратор: иначе не понять, кто такой «Vlad» (13.11)
        ...(u.admin && x.was?.length ? { was: x.was } : {}),
      }));
    }
    if (method === 'POST' && !rest.length) {
      needOpen(u);
      const name = cleanName(body.name);
      if (body.admin) needMain(u);
      await countNewPlayer(u);
      await nameFree(name, { company: Boolean(u.admin) });
      const id = 'u-' + randomBytes(6).toString('hex');
      const { code, hash } = await claimCode(body.code, id, u);
      const user = { id, name, admin: Boolean(body.admin), revoked: false, codeHash: hash, createdAt: now(), invitedBy: u.id };
      await store.putUser(user);
      forgetPeople();
      return { user: publicUser(user), code };
    }
    const [id, op] = rest;
    const user = await store.getUser(id);
    if (!user) http(404, 'no-user', 'Нет такого игрока');
    // не администратор: только новый код тому, кого пригласил сам
    if (!u.admin && !(method === 'POST' && op === 'code' && user.invitedBy === u.id && !user.admin)) needAdmin(u);
    // главного не трогает никто, назначенных администраторов только главный
    if (user.id === ADMIN_ID) http(403, 'not-main', 'Главного администратора менять нельзя');
    if (user.admin) needMain(u);
    if (method === 'POST' && op === 'revoke') {
      if (user.codeHash) await store.delCode(user.codeHash);
      await dropJoinsOf(user.id); // его ссылки гаснут насовсем, новый код их не вернет
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
    // фото игроку от администратора (13.11): у кого фото нет, тому его ставят из «Кодов игроков».
    // Права проверены выше, как у отзыва кода: игрокам администратор, администраторам главный,
    // главному никто. Игрок потом заменит или уберет фото сам, в профиле
    if (method === 'POST' && op === 'avatar') {
      // отозванному фото не ставим и говорим об этом прямо, а не «попробуйте еще раз» (ревью 13.11)
      if (user.revoked) http(409, 'revoked', 'Код этого игрока отозван: сначала выдайте ему новый код');
      return setAvatar(u, body, user.id);
    }
    // открыть новичку доступ без трех партий (13.11): только администратор, строкой выше это уже проверено
    if (method === 'POST' && op === 'path') {
      if (body.open !== true) http(400, 'bad-path', 'Открыть доступ: open = true');
      await setPath(id, (cur) => (locked(cur) ? { state: 'done', how: 'admin', at: now(), by: u.id } : null));
      return { ok: true };
    }
    http(404, 'no-route', 'Нет такого адреса');
  }

  // --- путь новичка (13.11, server/novice.js)

  /**
   * Сменить путь игрока: next(запись) дает новый путь или null, если менять нечего. Запись сверяется
   * с базой, как у фото и имени: одновременная смена имени или отзыв кода не должны потеряться.
   * Возвращает запись игрока после смены или null.
   */
  async function setPath(userId, next, { revoked = false } = {}) {
    for (let k = 0; k < 4; k++) {
      const cur = await store.getUser(userId);
      // revoked: менять и у игрока с отозванным кодом (зачет сыгранной партии от кода не зависит)
      if (!cur || (cur.revoked && !revoked)) return null;
      const path = next(cur);
      if (!path) return null;
      const user = { ...cur, path };
      if (await store.casUser(cur, user)) {
        forgetPeople();
        return user;
      }
    }
    http(409, 'stale', 'Не получилось сохранить, попробуйте еще раз');
  }

  /** Идущая партия очередного шага пути: стол, помеченный этим шагом и этим игроком. */
  async function stepTable(u) {
    const n = (u.path?.steps || 0) + 1;
    const docs = await store.getTables(await store.myTables(u.id));
    return docs.find((t) => t && t.status === 'playing' && t.step?.userId === u.id && t.step.n === n) || null;
  }

  const myPath = async (u) => pathView(u, u.path?.state === 'novice' ? (await stepTable(u))?.code || null : null);

  /** Ответ на опрос ({ played }) или отметка обучения ({ learn: 'skip' | null }). */
  async function answerPath(u, body) {
    let user;
    if (Object.hasOwn(body, 'learn')) {
      if (body.learn !== 'skip' && body.learn !== null) http(400, 'bad-path', 'Обучение: skip или null');
      if (u.path?.state !== 'novice') http(409, 'no-path', 'Путь новичка уже пройден или еще не начат');
      user = await setPath(u.id, (cur) => {
        if (cur.path?.state !== 'novice') return null;
        const { learn, ...rest } = cur.path;
        return body.learn ? { ...rest, learn: 'skip' } : rest;
      });
    } else {
      if (typeof body.played !== 'boolean') http(400, 'bad-path', 'Ответ на опрос: played = true или false');
      if (u.path?.state !== 'ask') http(409, 'answered', 'На этот вопрос вы уже ответили');
      user = await setPath(u.id, (cur) => (cur.path?.state === 'ask' ? surveyPath(body.played, now()) : null));
    }
    user = user || (await store.getUser(u.id)) || u; // пока писали, путь мог смениться: отдаем как есть
    return { user: publicUser(user), path: await myPath(user) };
  }

  /**
   * Партия очередного шага: сервер сам собирает стол (новичок и боты шага, вне турниров) и сразу
   * начинает партию, новичок ходит первым. Состав поменять нельзя, шаг не облегчить. Пока партия
   * шага идет, кнопка «Играть» ведет на нее же.
   */
  async function playStep(u) {
    if (u.path?.state !== 'novice') http(409, 'no-path', 'Путь новичка уже пройден или еще не начат');
    const n = (u.path.steps || 0) + 1, step = STEPS[n - 1];
    const cur = await stepTable(u);
    if (cur) return { code: cur.code, n };
    const title = await tableTitle();
    for (let k = 0; k < 5; k++) {
      const at = now();
      const t = createTable({ code: newTableCode(), title, host: seatUser(u), now: at });
      setSeatCount(t, u.id, step.bots + 1, at);
      for (const s of t.seats.slice(1)) setSeatKind(t, u.id, s.id, 'bot', at);
      for (const s of t.seats.slice(1)) setBot(t, u.id, s.id, step.set, at);
      if (!t.seats[0].hero) setHero(t, u.id, t.seats[0].id, HEROES.find((h) => !t.seats.some((s) => s.hero === h)), at);
      setOptions(t, u.id, { tournament: 'none', order: 'custom' }, at);
      t.step = { n, userId: u.id };
      start(t, u.id, { now: at });
      if (await store.putTable(t, null, meta(t))) {
        await store.addMyTable(u.id, t.code);
        return { code: t.code, n };
      }
    }
    http(500, 'no-code', 'Не удалось подобрать код стола');
  }

  /**
   * Сыгранная до конца партия шага засчитывает шаг. Повтор безопасен: считается только очередной шаг.
   * false, если запись игрока не далась (ее меняли одновременно): тогда зачет повторит следующий запрос.
   */
  async function creditStep(t) {
    try {
      // код могли отозвать, пока шла партия: шаг все равно засчитан, с новым кодом путь продолжится (ревью 13.11)
      await setPath(t.step.userId, (cur) => stepPath(cur.path, t.step.n, now()), { revoked: true });
      return true;
    } catch (e) {
      if (e instanceof HttpError) return false;
      throw e;
    }
  }

  // --- ссылки-приглашения (Денис 06.11): новичок сам вписывает имя, получает код и сразу входит.
  // Ссылка на одного человека, 7 дней; в базе отпечаток, ссылку целиком отдаем один раз при создании.

  const joinGone = () => http(410, 'join-gone', 'Ссылка уже не действует: попросите у пригласившего новую');
  const tableBrief = async (code) => {
    const r = code ? await store.getTable(code) : null;
    return r ? { code, title: r.doc.title || code } : null;
  };

  /** Действующее приглашение: запись есть, срок не вышел, пригласивший играет. Иначе 410. */
  async function joinOf(body, ip) {
    if (!secret || !pepper) http(500, 'not-configured', 'Сервер не настроен');
    // подбирать ссылки под тем же лимитом, что и коды
    if ((await store.hit(`act:${ip || 'unknown'}`, ACTIVATE_WINDOW_MS)) > ACTIVATE_LIMIT) http(429, 'too-many', 'Слишком много попыток, подождите несколько минут');
    if (!isJoinToken(body.token)) joinGone();
    const hash = joinHash(body.token, pepper);
    const inv = await store.getJoin(hash);
    if (!inv || !(inv.until > now())) joinGone();
    const by = await store.getUser(inv.by);
    if (!by || by.revoked) joinGone();
    return { hash, inv, by };
  }

  async function joinInfo(body, ip) {
    const { inv, by } = await joinOf(body, ip);
    return { by: by.name, table: await tableBrief(inv.table) };
  }

  async function joinRegister(body, ip) {
    const { hash, inv } = await joinOf(body, ip);
    const name = cleanName(body.name);
    await nameFree(name); // занятое имя не сжигает ссылку
    if (!(await store.takeJoin(hash))) joinGone(); // забор атомарный: по одной ссылке проходит один
    const id = 'u-' + randomBytes(6).toString('hex');
    const { code, hash: codeHash } = await claimCode('', id, null);
    // зарегистрировался сам: сначала опрос «играли раньше?», от ответа зависит путь (13.11)
    const user = { id, name, admin: false, revoked: false, codeHash, createdAt: now(), invitedBy: inv.by, path: { state: 'ask' } };
    await store.putUser(user);
    forgetPeople();
    await store.delJoinItems(inv.by, [inv.id]);
    return { token: signSession(id, secret, now(), 0), user: publicUser(user), code, table: await tableBrief(inv.table) };
  }

  /** Ссылки игрока, по которым еще никто не зарегистрировался; просроченные выпадают из списка. */
  async function liveJoins(userId) {
    const all = await store.joinItems(userId);
    const old = all.filter((x) => !(x.until > now()));
    if (old.length) await store.delJoinItems(userId, old.map((x) => x.id));
    return all.filter((x) => x.until > now()).sort((a, b) => a.createdAt - b.createdAt);
  }

  async function dropJoinsOf(userId) {
    const all = await store.joinItems(userId);
    for (const x of all) await store.dropJoin(x.hash);
    await store.delJoinItems(userId, all.map((x) => x.id));
  }

  async function joinLinks(method, rest, body, u) {
    if (method === 'GET' && !rest.length) {
      return (await liveJoins(u.id)).map(({ id, createdAt, until, table }) => ({ id, createdAt, until, table }));
    }
    if (method === 'POST' && !rest.length) {
      needOpen(u);
      let table = null;
      if (body.table != null) {
        const code = String(body.table).toUpperCase();
        const r = /^[A-Z0-9]{6}$/.test(code) ? await store.getTable(code) : null;
        if (!r || r.doc.status === 'deleted') http(404, 'no-table', 'Нет такого стола');
        if (r.doc.status !== 'lobby') http(409, 'not-lobby', 'Партия уже началась');
        table = { code, title: r.doc.title || code };
      }
      const live = await liveJoins(u.id);
      if (live.length >= JOIN_ACTIVE_MAX) http(429, 'too-many', `Действующих ссылок уже ${JOIN_ACTIVE_MAX}: отзовите ненужные`);
      await countNewPlayer(u);
      const token = newJoinToken(), hash = joinHash(token, pepper);
      const inv = { id: hash.slice(0, 12), by: u.id, table: table?.code || null, createdAt: now(), until: now() + JOIN_MS };
      await store.putJoin(hash, inv, JOIN_MS);
      await store.addJoinItem(u.id, { id: inv.id, hash, table, createdAt: inv.createdAt, until: inv.until });
      return { token, until: inv.until, table };
    }
    const [id, op] = rest;
    if (method === 'POST' && op === 'revoke' && rest.length === 2) {
      const x = (await store.joinItems(u.id)).find((j) => j.id === id);
      if (!x) http(404, 'no-link', 'Нет такой ссылки');
      await store.dropJoin(x.hash);
      await store.delJoinItems(u.id, [x.id]);
      return { ok: true };
    }
    http(404, 'no-route', 'Нет такого адреса');
  }

  /**
   * Партии сайта по игрокам: id -> { n, last }. Место человека узнается по userId, у старых записей
   * без него по имени, как в личной статистике.
   */
  function gamesOf(users, history) {
    const who = whoIs(users); // имя нынешнее или прежнее (13.11)
    const out = new Map();
    for (const e of history) {
      const ids = new Set(e.seats.filter((s) => s.kind === 'human').map((s) => who.owner(s)));
      for (const id of ids) {
        if (!id) continue;
        const r = out.get(id) || { n: 0, last: null };
        r.n++;
        if (e.finishedAt && (r.last === null || e.finishedAt > r.last)) r.last = e.finishedAt;
        out.set(id, r);
      }
    }
    return out;
  }

  // --- фото игрока

  /**
   * Новое фото или null, чтобы убрать. Номер случайный и новый: браузер хранит картинку вечно.
   * Запись игрока сверяется с базой: одновременный отзыв кода или смена прав не должны потеряться.
   * Старый файл стирается последним, чтобы при сбое запись не указывала на пустое место.
   */
  // forId: кому ставим. По умолчанию себе; администратор ставит игроку из «Кодов игроков» (13.11),
  // права на это проверяет adminUsers. Счетчик частоты у того, кто загружает.
  async function setAvatar(u, body, forId = u.id) {
    if ((await store.hit(`ava:${u.id}`, ACTIVATE_WINDOW_MS)) > ACTIVATE_LIMIT) http(429, 'too-many', 'Слишком часто, подождите несколько минут');
    let avatar = null;
    if (body.image !== null) {
      const pic = parseAvatar(body.image);
      if (!pic) http(400, 'bad-image', 'Фото не подошло, попробуйте другое');
      avatar = randomBytes(16).toString('hex');
      await store.setAvatar(avatar, pic);
    }
    try {
      for (let k = 0; k < 4; k++) {
        const cur = await store.getUser(forId);
        if (!cur || cur.revoked) break;
        const user = { ...cur, avatar };
        if (await store.casUser(cur, user)) {
          // запись уже указывает на новое фото: сбой при стирании старого файла не повод для отказа
          if (cur.avatar) await store.delAvatar(cur.avatar).catch((e) => console.error('avatar', e.message));
          forgetPeople();
          return { user: publicUser(user) };
        }
      }
    } catch (e) {
      // база отказала посреди записи: новый файл никому не достался, не оставляем его лежать (ревью 13.11)
      if (avatar) await store.delAvatar(avatar).catch(() => {});
      throw e;
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

  // кто что видит в статистике (Денис 04.11): игрок только свою личную статистику и турниры, где
  // он участник; администратор все
  // участник встроенного сезона записан именем: его находим по справочнику людей (нынешнее или прежнее имя)
  const inTour = (t, u, who) => t.players.some((p) => (p.id || who.idOf(p.name)) === u.id);
  const myTours = async (u, who) => (await allTours()).filter((t) => u.admin || inTour(t, u, who));

  async function toursInfo(u) {
    const users = (await store.listUsers()).filter((x) => !x.revoked);
    const who = whoIs(users);
    return { tours: (await myTours(u, who)).map((t) => publicTour(t, who)), people: users.map((x) => ({ id: x.id, name: x.name })) };
  }

  async function newTour(u, body) {
    needOpen(u);
    const name = String(body.name ?? '').trim();
    if (!name || name.length > TOUR_NAME_MAX) http(400, 'bad-name', `Название от 1 до ${TOUR_NAME_MAX} знаков`);
    const list = Array.isArray(body.players) ? body.players.map(String) : [];
    const ids = [...new Set(list)];
    if (ids.length !== list.length || ids.length < 2 || ids.length > 4) http(400, 'bad-players', 'В турнире от 2 до 4 разных участников');
    // игрок видит только свои турниры: заведенный без себя он бы и сам не увидел
    if (!u.admin && !ids.includes(u.id)) http(400, 'not-member', 'Включите в турнир себя');
    const tours = await allTours();
    if (tours.length >= TOURS_MAX) http(409, 'too-many', 'Турниров слишком много');
    if (tours.some((t) => t.name.toLowerCase() === name.toLowerCase())) http(409, 'name-taken', 'Такой турнир уже есть');
    const users = await Promise.all(ids.map((id) => store.getUser(id)));
    if (users.some((x) => !x || x.revoked)) http(400, 'bad-players', 'Участником может быть только игрок с действующим кодом');
    const fresh = users.filter(locked).map((x) => x.name);
    if (fresh.length) http(400, 'bad-players', `В турниры берут после трех партий пути новичка. Пока его не прошли: ${fresh.join(', ')}`);
    const t = { id: 't-' + randomBytes(5).toString('hex'), name, ownerId: u.id, players: users.map((x) => ({ id: x.id, name: x.name })), createdAt: now() };
    await store.putTour(t);
    return publicTour(t);
  }

  /**
   * Личная статистика (просьба Дениса 04.11): все партии игрока query.id (по умолчанию свои) и
   * список игроков для выбора. Считает страница; партии BGA сезона входят по имени.
   */
  async function playerStats(u, query) {
    await keepFinishedOnce(store);
    await detailsOnce(store);
    const users = await store.listUsers();
    // игрок видит только себя, администратор любого (Денис 04.11)
    const player = (u.admin && users.find((x) => x.id === query.id)) || users.find((x) => x.id === u.id) || u;
    const seen = u.admin ? users : [player];
    return {
      player: { id: player.id, name: player.name, avatar: player.avatar || null },
      players: seen.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      games: playerGames(player, await store.listHistory(), await allTours(), whoIs(users)),
    };
  }

  // --- профиль (13.11)

  /**
   * «Мой профиль»: сводка по тем же партиям, что личная статистика, и рейтинг (server/rating.js).
   * Считается на лету: история небольшая.
   */
  /**
   * id: чей профиль. Свой видит каждый; чужой только администратор (правило то же, что у личной
   * статистики, Денис 04.11), ему заодно прежние имена и отозван ли код (13.11).
   */
  async function profile(u, id = u.id) {
    const other = id !== u.id;
    if (other) needAdmin(u); // сначала права: игроку не говорим, есть ли такой номер
    await keepFinishedOnce(store);
    await detailsOnce(store);
    const users = await store.listUsers();
    const who = whoIs(users);
    const me = users.find((x) => x.id === id) || (other ? http(404, 'no-user', 'Нет такого игрока') : u);
    const history = await store.listHistory();
    const games = playerGames(me, history, await allTours(), who);
    return {
      user: publicUser(me),
      joinedAt: me.createdAt ?? null,
      ...profileSummary(games, now()),
      // в таблице мест только действующие игроки: отозванные места не занимают
      rating: ratingOf(me.id, ratings(ratedGames(history, who)), (x) => who.byId.has(x) && !who.byId.get(x).revoked),
      ...(other ? { was: me.was || [], revoked: Boolean(me.revoked) } : {}),
    };
  }

  /**
   * Свое имя. Прежнее имя остается за игроком (was): по нему находятся партии сезона BGA, герой и
   * старые партии, а другой игрок взять его не может. К своему прежнему имени вернуться можно.
   * Запись сверяется с базой, как у фото: одновременный отзыв кода или смена прав не должны потеряться.
   */
  async function setName(u, body) {
    const name = cleanName(body.name, NAME_MIN);
    const key = nameKey(name);
    // отказы «имя занято» тоже считаются: занятые и прежние имена нельзя перебирать без счета
    if ((await store.hit(`nametry:${u.id}`, ACTIVATE_WINDOW_MS)) > ACTIVATE_LIMIT) http(429, 'too-many', 'Слишком много попыток, подождите несколько минут');
    for (let k = 0; k < 4; k++) {
      const cur = await store.getUser(u.id);
      if (!cur || cur.revoked) break;
      if (cur.name === name) return { user: publicUser(cur) };
      const own = namesOf(cur);
      const taken = (users) => nameTaken(users, name, cur.id) || (COMPANY.has(key) && !own.includes(key));
      if (taken(await store.listUsers())) http(409, 'name-taken', 'Такое имя уже есть у другого игрока');
      const was = [...new Set(own)].filter((x) => x !== key);
      if (was.length > WAS_MAX) http(409, 'too-many-names', `У вас уже ${WAS_MAX} прежних имен: новое взять нельзя, можно вернуться к одному из прежних`);
      if (k === 0 && (await store.hit(`name:${u.id}`, 24 * 3600 * 1000)) > NAME_CHANGES_DAY) http(429, 'too-many', 'Имя сегодня уже меняли несколько раз, попробуйте завтра');
      const user = { ...cur, name, was };
      if (await store.casUser(cur, user)) {
        // пока писали, то же имя мог взять другой игрок: тогда свое возвращаем и отказываем обоим
        if (nameTaken(await store.listUsers(), name, cur.id)) {
          await store.casUser(user, cur);
          http(409, 'name-taken', 'Такое имя уже есть у другого игрока');
        }
        forgetPeople();
        return { user: publicUser(user) };
      }
    }
    http(409, 'stale', 'Не получилось сохранить имя, попробуйте еще раз');
  }

  async function stats(u, query) {
    await keepFinishedOnce(store); // один раз после выкладки: старые законченные столы без срока и с кодом в истории
    await detailsOnce(store); // один раз после выкладки: подробности старых партий для статистики турнира
    const tours = await allTours();
    const tour = tours.find((t) => t.id === query.tour) || SEASON;
    const users = await store.listUsers();
    const who = whoIs(users);
    if (!u.admin && !inTour(tour, u, who)) http(403, 'not-member', 'Статистику турнира видят его участники и администраторы');
    const face = (p) => who.byId.get(p.id || who.idOf(p.name))?.avatar || null;
    return { tour: publicTour(tour, who), players: tourNames(tour, who), avatars: tour.players.map(face), games: tourGames(tour, tours, await store.listHistory(), who) };
  }

  // --- чат Telegram

  /** Стол для чата: и тот, кто действует, и все люди за столом из его компании. */
  // человек из компании узнается по любому своему имени, нынешнему или прежнему (13.11); место за столом
  // по ключу компании (seat.person), у столов до смены имен по имени
  const chatTable = (t, u) => namesOf(u).some(inChat) && t.seats.every((s) => s.kind !== 'human' || !s.userId || inChat(s.person || s.name));

  /**
   * Вид стола для игрока. chat: стол компании и смотрит свой. Браузер раньше решал это сам по именам
   * за столом и после смены имени прятал кнопки чата, хотя сервер их разрешал (ревью 13.11).
   */
  // step: номер шага пути новичка, только хозяину такой партии (окно итога зовет дальше по пути).
  // novice: в лобби сидит игрок, не прошедший путь: партия пойдет вне турниров (13.11).
  async function viewOf(t, u, opts) {
    const v = { ...viewFor(t, u.id, opts), chat: chatTable(t, u) };
    if (t.step?.userId === u.id) v.step = t.step.n;
    if (t.status === 'lobby' && (await novicesAt(t))) v.novice = true;
    return v;
  }

  /** За столом сидит человек, у которого путь новичка не пройден. fresh: список людей прямо из базы. */
  async function novicesAt(t, fresh = false) {
    const ids = t.seats.filter((s) => s.kind === 'human' && s.userId).map((s) => s.userId);
    if (!ids.length) return false;
    let known = await knownPeople(fresh);
    // только что зарегистрированного на другом экземпляре в списке еще нет: перечитываем (ревью 13.11)
    if (!fresh && ids.some((id) => !known.has(id))) known = await knownPeople(true);
    return ids.some((id) => locked(known.get(id)));
  }

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
    // путь новичка меняется на другом экземпляре (ответ на опрос, зачет шага, доступ от администратора).
    // Запись новичка берем прямо из базы: иначе страница до минуты показывала бы прежнее состояние и
    // прятала открытое (ревью 13.11). Лишнее чтение только у тех, кто путь еще не прошел
    if (u && locked(u)) u = (await store.getUser(s.id)) || u;
    checkUser(u, s.epoch);
    const ids = [...(await knownPeople()).values()].filter((x) => !x.revoked).map((x) => x.id);
    const { marks, letters } = await store.readPresence(ids, u.id);
    const t = now(), busy = Boolean(body.busy);
    const mine = marks.find((m) => m?.id === u.id);
    const avatar = u.avatar || null;
    if (!mine || mine.busy !== busy || mine.avatar !== avatar || mine.name !== u.name || t - mine.at >= MARK_EVERY_MS) {
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
   * Кто может удалить стол (просьба Дениса 04.11). Стол, где из людей только он сам (остальные
   * места боты или свободны), игрок удаляет в любой момент, даже после сыгранной партии: в
   * статистику турниров такие партии не входят, там от двух участников. Стол с другими людьми
   * удаляет только администратор и только если партия не начиналась или завершена досрочно:
   * законченная хранится для статистики. Возвращает null или [статус, код, сообщение] отказа.
   */
  function deleteRight(t, u) {
    const mine = t.hostUserId === u.id || Boolean(seatOfUser(t, u.id));
    if (mine && t.seats.every((s) => s.kind !== 'human' || !s.userId || s.userId === u.id)) return null;
    if (!u.admin) return [403, 'not-admin', 'Стол с другими игроками может удалить только администратор'];
    // сыгранную партию с людьми администратор тоже удаляет (Денис 04.11): в статистике она остается
    if (t.status === 'playing') return [409, 'not-lobby', 'Идущую партию с другими игроками удалить нельзя: сначала завершите ее досрочно'];
    return null;
  }

  /** Запись журнала удалений: кто, когда, какой стол и в каком состоянии он был. */
  const logEntry = (kind, t, u, from) => ({
    kind, code: t.code, title: t.title || null, from, at: now(), by: u.id, byName: u.name,
    seats: t.seats.map((s) => s.name || (s.kind === 'bot' ? 'Бот' : null)).filter(Boolean),
  });

  /**
   * Удалить стол (с 04.11 мягко: стол прячется, но остается в базе, и его можно вернуть).
   * Сначала запись по версии: если партию начали в этот же момент, а за столом люди, удаление
   * не пройдет. Сбой после нее оставит стол скрытым, вернуть его можно и тогда. Удаленный стол
   * хранится 90 дней после удаления, как любой незаконченный. У сыгранной партии итог остается
   * в истории и статистике, только строка статистики больше не ведет на стол.
   */
  async function deleteTable(code, u) {
    const { doc: t, version } = await load(code);
    const no = deleteRight(t, u);
    if (no) http(...no);
    const from = t.status;
    if (from === 'over' && !t.game.historySaved) {
      const e = historyEntry(t); // итог не должен пропасть вместе со столом
      await store.addHistory(e);
      await store.setCompanyLast(e);
      t.game.historySaved = true;
    }
    // и шаг пути новичка тоже: партия сыграна до конца
    if (from === 'over' && t.step && !t.step.done && (await creditStep(t))) t.step.done = true;
    t.deleted = { from, at: now(), by: u.id, byName: u.name };
    t.status = 'deleted';
    t.version = version + 1;
    if (!(await store.putTable(t, version, DELETED))) http(409, 'stale', 'Стол уже изменился, обновите');
    if (from === 'over' && t.game?.id) await store.patchHistory(t.game.id, { code: null });
    await Promise.all((await store.listUsers()).map((x) => store.dropMyTable(x.id, code)));
    await store.logTable(logEntry('delete', t, u, from), TABLE_LOG_MAX);
    return { ok: true };
  }

  /** Вернуть удаленный стол: администратор любой, игрок тот, что удалил сам. */
  async function restoreTable(code, u) {
    const cur = await store.getTable(code);
    if (!cur) http(404, 'no-table', 'Стола больше нет: удаленное хранится 90 дней');
    const { doc: t, version } = cur;
    if (t.status !== 'deleted' || !t.deleted) http(409, 'not-deleted', 'Стол не удален');
    if (!u.admin && t.deleted.by !== u.id) http(403, 'not-admin', 'Вернуть стол может администратор или тот, кто его удалил');
    const from = t.deleted.from;
    t.status = from;
    delete t.deleted;
    t.version = version + 1;
    if (!(await store.putTable(t, version, meta(t)))) http(409, 'stale', 'Стол уже изменился, обновите');
    if (from === 'over' && t.game?.id) await store.patchHistory(t.game.id, { code });
    const back = new Set([t.hostUserId, ...t.seats.filter((s) => s.kind === 'human' && s.userId).map((s) => s.userId)]);
    for (const id of back) if (id) await store.addMyTable(id, code);
    await store.logTable(logEntry('restore', t, u, from), TABLE_LOG_MAX);
    return { ok: true, status: from };
  }

  /**
   * Журнал удалений, новые сверху: администратору все записи, игроку его собственные. У записи
   * удаления canRestore, если стол еще лежит удаленным и его можно вернуть.
   */
  async function deletions(u) {
    const all = (await store.tableLog(TABLE_LOG_MAX)).filter((e) => u.admin || e.by === u.id);
    const codes = [...new Set(all.filter((e) => e.kind === 'delete').map((e) => e.code))];
    const docs = await store.getTables(codes);
    const hidden = new Set(docs.filter((d) => d?.status === 'deleted').map((d) => d.code));
    const seen = new Set();
    return all.map((e) => {
      const last = !seen.has(e.code); // только последнее удаление стола можно отменить
      seen.add(e.code);
      return { ...e, canRestore: e.kind === 'delete' && last && hidden.has(e.code) && (u.admin || e.by === u.id) };
    });
  }

  async function adminTables(method, rest, u) {
    needAdmin(u);
    if (method === 'GET' && !rest.length) return openTables();
    if (method === 'POST' && rest.length === 2 && rest[1] === 'delete') return deleteTable(rest[0], u);
    http(404, 'no-route', 'Нет такого адреса');
  }

  /** Итог законченной партии в историю: один раз, повтор безопасен. */
  async function ensureHistory(t, version) {
    if (t.status !== 'over') return;
    const credit = Boolean(t.step) && !t.step.done; // шаг пути новичка (13.11) засчитывается тут же
    if (t.game.historySaved && !credit) return;
    if (!t.game.historySaved) {
      const e = historyEntry(t);
      await store.addHistory(e);
      await store.setCompanyLast(e);
      t.game.historySaved = true;
    }
    if (credit && (await creditStep(t))) t.step.done = true;
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
      const t = createTable({ code: newTableCode(), title, host: seatUser(u), now: now() });
      if (await store.putTable(t, null, meta(t))) {
        await store.addMyTable(u.id, t.code);
        return { code: t.code, view: await viewOf(t, u, { now: now() }) };
      }
    }
    http(500, 'no-code', 'Не удалось подобрать код стола');
  }

  /**
   * Картинка итога в чат ДВАК (этап 4, 04.11): только законченная партия, только свои люди
   * за столом, не чаще раза в минуту на стол. Картинку рисует браузер, здесь проверка и отправка.
   */
  async function sendPhoto(code, u, body) {
    if (!tg.on) http(503, 'no-chat', 'Чат Telegram подключен только на основном сайте');
    const { doc: t } = await load(code);
    if (t.status !== 'over' || !t.game?.result) http(409, 'not-over', 'Картинка итога есть только у законченной партии');
    if (!chatTable(t, u)) http(403, 'not-chat', 'Чат только для Дениса, Андрея и Влада');
    const pic = parsePhoto(body.image);
    if (!pic) http(400, 'bad-image', 'Картинка не подошла: нужен jpeg или png до 2,5 МБ');
    if ((await store.hit(`tg:call:${u.id}`, CHAT_CALL_MS)) > CHAT_CALLS) http(429, 'too-many', 'Слишком часто, подождите пару минут');
    const key = `tg:photo:${t.code}`, token = letterId();
    if (!(await store.lock(key, token, PHOTO_MS))) http(429, 'too-many', 'Картинку этой партии только что отправили, подождите минуту');
    if (!(await tg.photo({ ...pic, caption: photoCaption(t, u.name), ...photoButton(t) }))) {
      await store.unlock(key, token);
      http(502, 'chat-failed', 'Не удалось отправить в чат, попробуйте позже');
    }
    return { ok: true };
  }

  /**
   * Разбор партии ботом (этап 5, 04.11): запись законченной партии для разбора в браузере
   * (руки и мешок уже не тайна) и готовый разбор, который сохраняется один раз.
   */
  async function recordOf(code) {
    const { doc } = await load(code);
    if (doc.status !== 'over' || !doc.game?.result) http(409, 'not-over', 'Разбор открывается после конца партии');
    if (!doc.game.rec) http(404, 'no-record', 'Партия начата до записи ходов: разобрать ее нельзя');
    return { rec: doc.game.rec, order: doc.game.order, humans: humanSeats(doc) };
  }

  async function analysisOf(code) {
    const { doc } = await load(code);
    return { analysis: doc.game?.analysis || null, can: doc.status === 'over' && Boolean(doc.game?.rec) };
  }

  async function saveAnalysis(code, u, body) {
    const { doc, version } = await load(code);
    if (doc.status !== 'over' || !doc.game?.rec) http(409, 'not-over', 'Разбор есть только у законченной записанной партии');
    if (!seatOfUser(doc, u.id) && doc.hostUserId !== u.id) http(403, 'not-seated', 'Сохранить разбор может только игрок этой партии');
    if (doc.game.analysis) return { analysis: doc.game.analysis, saved: false }; // уже посчитан: первый остается
    const a = cleanAnalysis(body.analysis, humanSeats(doc));
    if (!a) http(400, 'bad-analysis', 'Разбор не подошел');
    doc.game.analysis = a;
    doc.version = version + 1;
    if (!(await store.putTable(doc, version, meta(doc)))) http(409, 'stale', 'Стол изменился, попробуйте еще раз');
    return { analysis: a, saved: true };
  }

  /**
   * Просмотр партии по ходам (этап 3, 04.11): кадры из записи партии, только для законченной партии,
   * только открытое (поле, очки, журнал). Партии, начатые до записи ходов, просмотра не имеют.
   */
  async function replayOf(code) {
    const { doc } = await load(code);
    if (doc.status !== 'over' || !doc.game?.result) http(409, 'not-over', 'Просмотр открывается после конца партии');
    const data = replayFrames(doc);
    if (!data) http(404, 'no-record', 'Партия начата до записи ходов: просмотра у нее нет');
    const s = doc.game.state;
    const cells = (arr) => Array.from(arr).flatMap((x, i) => (x ? [i] : []));
    return {
      code: doc.code, title: doc.title || null, options: { ...doc.options }, order: doc.game.order,
      seats: doc.seats.map((x) => ({ id: x.id, kind: x.kind, name: x.name, hero: x.hero, avatar: x.avatar || null })),
      river: cells(s.river), special: cells(s.special), monDefs: s.monuments.map(({ id, c1, c2 }) => ({ id, c1, c2 })), result: doc.game.result,
      analysis: doc.game.analysis || null, ...data,
    };
  }

  /**
   * Места людей, которые сейчас на месте за столом: открыли его страницу за последние 20 с.
   * me — отметить смотрящего (его страница стола открыта). Боты в список не входят: они всегда тут.
   */
  async function hereAt(t, me) {
    const humans = t.seats.filter((s) => s.kind === 'human' && s.userId);
    const ids = [...new Set([...(me ? [me] : []), ...humans.map((s) => s.userId)])];
    const at = await store.readHere(t.code, ids);
    const t0 = now();
    if (me && !(t0 - (at[me] ?? -Infinity) < HERE_EVERY_MS)) {
      await store.touchHere(t.code, me, t0, HERE_TTL_MS);
      at[me] = t0;
    }
    return humans.filter((s) => t0 - (at[s.userId] ?? -Infinity) <= HERE_FRESH_MS).map((s) => s.id);
  }

  async function myTables(u) {
    const codes = await store.myTables(u.id);
    const docs = await store.getTables(codes);
    const tours = await allTours();
    const who = whoIs([...(await knownPeople()).values()]);
    return docs.filter((t) => t && t.status !== 'deleted').map((t) => {
      // турнир партии так же, как его считает статистика (фильтр «Моих столов», Денис 06.11)
      const tour = tourOf({ tour: t.options?.tournament ?? 'auto', finishedAt: t.game?.result?.finishedAt ?? t.updatedAt, seats: t.seats }, tours, who);
      return {
        code: t.code, title: t.title || null, status: t.status, updatedAt: t.updatedAt, next: t.next || null,
        paused: Boolean(t.game?.paused),
        replay: t.status === 'over' && Boolean(t.game?.rec), // просмотр по ходам (этап 3, 04.11)
        me: seatOfUser(t, u.id)?.id ?? null,
        toMove: t.game?.toMove ?? null,
        tour: tour ? tour.name : null,
        // у бота стиль: портрет бота в списке вместо имени (Денис 06.11)
        seats: t.seats.map((s) => ({ id: s.id, kind: s.kind, name: s.name, hero: s.hero, ...(s.kind === 'bot' ? { bot: { style: s.bot?.style ?? null } } : {}) })),
        del: !deleteRight(t, u), // кнопка «Удалить» в «Моих столах»
      };
    });
  }

  const ACTIONS = {
    pause: (t, u) => pause(t, u.id, now()),
    ready: (t, u) => ready(t, u.id, now()),
    sit: (t, u, b) => sit(t, seatUser(u), b.seat, now()),
    leave: (t, u) => leave(t, u.id, now()),
    unseat: (t, u, b) => unseat(t, u.id, b.seat, now()),
    async invitePeople(t, u, b) {
      const chosen = await inviteesOf(b.ids, u);
      const seated = chosen.map((p) => ({ ...seatUser(p), letter: letterId() }));
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
      // начинает только хозяин стола и только когда все приглашенные люди на месте (просьба Дениса 04.11)
      if (u.id !== t.hostUserId) http(403, 'not-host', 'Начать партию может только хозяин стола');
      const here = await hereAt(t, u.id);
      const wait = t.seats.filter((s) => s.kind === 'human' && s.userId && s.userId !== u.id && !here.includes(s.id));
      if (wait.length) http(409, 'not-here', `Ждем за столом: ${wait.map((s) => s.name).join(', ')}`);
      const humans = t.seats.filter((s) => s.kind === 'human').map((s) => s.userId);
      const last = t.options.order === 'loser' && humans.every(Boolean) ? await store.companyLast(companyKey(humans)) : null;
      // за столом новичок, не прошедший путь: партия идет вне турниров (13.11). Прежняя настройка
      // запоминается: в реванше она вернется, к тому времени путь может быть пройден
      // у столов, заведенных до настройки турнира (до 31.10), поля нет: это то же, что «по составу» (ревью 13.11)
      const was = t.options.tournament ?? 'auto';
      const tourWas = was !== 'none' && (await novicesAt(t, true)) ? was : null;
      if (tourWas) t.options.tournament = 'none';
      start(t, u.id, { last, now: now() });
      if (tourWas) t.game.tourWas = tourWas;
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
      if (t.game?.tourWas) created.options.tournament = t.game.tourWas; // партия шла вне турниров из-за новичка
      // места реванша скопированы со старого стола: имя, фото и ключ компании берем нынешние (13.11)
      const known = await knownPeople(true);
      for (const s of created.seats) {
        const x = s.kind === 'human' && s.userId ? known.get(s.userId) : null;
        if (!x) continue;
        const fresh = seatUser(x);
        s.name = fresh.name;
        s.avatar = fresh.avatar || null;
        if (fresh.person) s.person = fresh.person;
        else delete s.person;
      }
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
    return { ...(await viewOf(t, u, { now: now() })), ...extra };
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
        let waiting = false;
        if (confirmDue(cur.doc, now())) autoConfirm(cur.doc, { now: now() });
        else if (botDue(cur.doc) !== null) {
          const r = await botStep(cur.doc, { now: now(), pace: botPace, clock: now, ...botOptions });
          // бот «думает»: новый план сохраняем, ход покажем, когда выйдет время раздумий
          if (r?.waiting && !r.planned) break;
          waiting = Boolean(r?.waiting);
        } else break;
        if (!(await store.putTable(cur.doc, cur.version, meta(cur.doc)))) break;
        if (waiting) break;
        moved++;
        if (cur.doc.status === 'over') await ensureHistory(cur.doc, cur.doc.version);
      }
    } finally {
      await store.unlock(code, token);
    }
    const p = await store.poll(code);
    const at = now();
    return { moved, locked: false, botDue: due(p?.meta || '', at), ...botIn(p?.meta || '', at), version: p?.version ?? null };
  }

  // --- маршрутизация

  async function dispatch({ method, path, query, body, token, ip }) {
    const seg = String(path || '').split('/').filter(Boolean);
    const [head, ...rest] = seg;
    if (method === 'GET' && head === 'ping') {
      return { ok: true, env: env.VERCEL_ENV || 'local', region: env.VERCEL_REGION || null, engine: ENGINE.hash.slice(0, 7), store: store.kind, chat: tg.on };
    }
    if (method === 'POST' && head === 'activate') return activate(body, ip);
    if (method === 'GET' && head === 'avatar') return avatarFile(rest.join('/'));
    if (head === 'tables' && rest.length === 2 && rest[1] === 'poll' && method === 'GET') {
      const who = await auth(token, { light: true });
      const p = await store.poll(rest[0]);
      if (!p || p.meta === DELETED) http(404, 'no-table', 'Нет такого стола');
      const at = now();
      const out = { version: p.version, botDue: due(p.meta, at), ...botIn(p.meta, at), locked: p.locked };
      // в лобби: кто на месте за столом, и отметка смотрящего
      if (query.here) {
        const r = await store.getTable(rest[0]);
        if (r?.doc.status === 'lobby') out.here = await hereAt(r.doc, who.id);
      }
      return out;
    }
    if (method === 'POST' && head === 'beat') return beat(await auth(token, { light: true }), body);
    // ссылка-приглашение: без входа, токен ссылки телом запроса, не в адресе (журналы его не видят)
    if (method === 'POST' && head === 'join' && rest.length === 1 && rest[0] === 'info') return joinInfo(body, ip);
    if (method === 'POST' && head === 'join' && !rest.length) return joinRegister(body, ip);
    const u = await auth(token);
    if (method === 'GET' && head === 'me' && !rest.length) return publicUser(u);
    if (method === 'POST' && head === 'me' && rest[0] === 'avatar') return setAvatar(u, body);
    if (method === 'GET' && head === 'me' && rest[0] === 'profile' && rest.length === 1) return profile(u);
    if (method === 'POST' && head === 'me' && rest[0] === 'name' && rest.length === 1) return setName(u, body);
    if (method === 'GET' && head === 'players' && rest.length === 2 && rest[1] === 'profile') return profile(u, rest[0]);
    if (method === 'GET' && head === 'me' && rest[0] === 'path' && rest.length === 1) return myPath(u);
    if (method === 'POST' && head === 'me' && rest[0] === 'path' && rest.length === 1) return answerPath(u, body);
    if (method === 'POST' && head === 'me' && rest[0] === 'path' && rest[1] === 'play' && rest.length === 2) return playStep(u);
    if (method === 'POST' && head === 'invite' && rest[0] === 'chat') return callChat(u, body);
    if (method === 'POST' && head === 'invite') return invite(u, body);
    if (method === 'POST' && head === 'invites' && rest[0] === 'answer') return answer(u, body);
    if (method === 'GET' && head === 'people') return peopleList();
    if (method === 'GET' && head === 'stats' && rest[0] === 'player' && rest.length === 1) return playerStats(u, query);
    if (method === 'GET' && head === 'stats') return stats(u, query);
    if (method === 'GET' && head === 'tournaments') return toursInfo(u);
    if (method === 'POST' && head === 'tournaments') return newTour(u, body);
    if (method === 'GET' && head === 'prefs') return (await store.getPrefs(u.id)) || {};
    if (method === 'POST' && head === 'prefs') {
      await store.setPrefs(u.id, cleanPrefs(body));
      return { ok: true };
    }
    if (head === 'admin' && rest[0] === 'users') return adminUsers(method, rest.slice(1), body, u);
    if (head === 'joinlinks') return joinLinks(method, rest, body, u);
    if (head === 'admin' && rest[0] === 'tables') return adminTables(method, rest.slice(1), u);
    if (method === 'GET' && head === 'deletions' && !rest.length) return deletions(u);
    if (head === 'tables') {
      if (!rest.length && method === 'POST') return newTable(u);
      if (!rest.length && method === 'GET') return myTables(u);
      const [code, op] = rest;
      if (!op && method === 'GET') {
        const { doc, version } = await load(code);
        if (doc.status === 'over') await ensureHistory(doc, version);
        return viewOf(doc, u, { logFrom: int(query.logFrom), now: now() });
      }
      if (!op && method === 'POST') return act(code, u, body);
      if (op === 'bot-tick' && method === 'POST') return botTick(code);
      if (op === 'replay' && method === 'GET') return replayOf(code);
      if (op === 'delete' && method === 'POST' && rest.length === 2) return deleteTable(code, u);
      if (op === 'restore' && method === 'POST' && rest.length === 2) return restoreTable(code, u);
      if (op === 'photo' && method === 'POST') return sendPhoto(code, u, body);
      if (op === 'record' && method === 'GET') return recordOf(code);
      if (op === 'analysis' && method === 'GET') return analysisOf(code);
      if (op === 'analysis' && method === 'POST') return saveAnalysis(code, u, body);
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
