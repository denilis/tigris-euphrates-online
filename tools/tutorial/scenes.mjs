// Сцены обучения: расстановка на продвинутом поле и шаги. Ходы идут настоящим движком, поэтому
// неверная сцена падает на проверке допустимого хода, а не уезжает в видео.
import { BOARDS } from '../../game/vendor/engine/boards.js';

const RED = 0, BLUE = 1, GREEN = 2, BLACK = 3;
const cell = (n) => n.charCodeAt(0) - 65 + (Number(n.slice(1)) - 1) * 16;
const list = (s) => (s.trim() ? s.trim().split(/\s+/).map(cell) : []);
const tile = (color, pos) => ({ type: 'tile', color, pos: cell(pos) });
const leader = (color, pos) => ({ type: 'leader', color, pos: cell(pos) });
const support = (n) => ({ type: 'support', n });
const mark = (cells, color, fill) => ({ cells: list(cells), color, fill });
const FREE = '.ht2:not(.off):not(.on)'; // тайл руки в окне конфликта, ещё не отправленный в бой

/** Расставить поле. Тайлы берутся из мешка, поэтому проверка движка на число тайлов сходится. */
function lay(s, { red = '', blue = '', green = '', black = '', leaders = [], hand = [2, 1, 2, 1], others = [2, 1, 2, 1], scores, treasures, cats, turn = 12, action = 1 }) {
  for (const pl of s.players) pl.hand.forEach((n, c) => { s.bag[c] += n; pl.hand[c] = 0; });
  [red, blue, green, black].forEach((str, c) => {
    for (const i of list(str)) { s.tile[i] = c; s.bag[c]--; }
  });
  for (const [p, c, pos] of leaders) {
    s.leader[cell(pos)] = p * 4 + c;
    s.players[p].leaders[c] = cell(pos);
  }
  s.players.forEach((pl, p) => {
    const h = p === 0 ? hand : others;
    h.forEach((n, c) => { pl.hand[c] = n; s.bag[c] -= n; });
    if (scores?.[p]) pl.score = scores[p].slice();
    if (treasures?.[p] != null) pl.treasures = treasures[p];
    if (cats?.[p] != null) pl.cats = cats[p];
  });
  Object.assign(s, { turn, actionNo: action, cur: 0, toMove: 0, phase: 'action', ctx: null });
}

const TEMPLES = 'E1 J1 O2 B3 G4 L4 D6 P6 A8 H8 M8 E10 J11 O11';

export const SCENES = [
  {
    name: '01-pole',
    title: 'Поле и компоненты',
    setup: (s) => lay(s, { turn: 1, hand: [2, 1, 2, 1] }),
    steps: [
      { caption: 'Поле 16 на 11 клеток. На нем уже стоят храмы, на каждом сокровище', marks: [mark(TEMPLES, 'gold')] },
      { caption: 'Река. Синие тайлы кладутся только сюда, все остальные только на сушу', marks: [{ cells: BOARDS.advanced.river, color: 'blue', fill: 0.3 }] },
      { caption: 'В руке всегда 6 тайлов. Рядом ваши 4 лидера и 2 катастрофы', boxes: [{ sel: '#gHand' }], captionPos: 'board' },
      { caption: 'Счет закрытый: свои очки вы видите, чужие нет', boxes: [{ sel: '#gPlayers' }] },
    ],
  },
  {
    name: '02-korolevstvo',
    title: 'Регион и царство',
    setup: (s) => lay(s, { green: 'H5 K4', black: 'F5 G5 K5 L5', leaders: [[0, BLACK, 'H4']] }),
    steps: [
      { caption: 'Тайлы, которые касаются сторонами, образуют регион. Лидера здесь нет', marks: [mark('K4 L4 K5 L5', 'gold')] },
      { caption: 'Регион, где стоит хотя бы один лидер, называется царством', marks: [mark('G4 H4 F5 G5 H5', 'green')] },
      { caption: 'Лидер всегда стоит рядом с храмом. Здесь это ваш черный лидер, царь', marks: [mark('H4', 'gold'), mark('G4', 'white')] },
    ],
  },
  {
    name: '03-tayl-ochko',
    title: 'Ход, тайл и очко',
    setup: (s) => lay(s, { black: 'F5 G5', leaders: [[0, BLACK, 'H4'], [0, RED, 'F4']], hand: [2, 1, 2, 1] }),
    steps: [
      { caption: 'За ход два действия. В этом царстве ваши царь и красный жрец', marks: [mark('F4 G4 H4 F5 G5', 'green')] },
      { caption: 'Берем красный тайл: подсвечены все клетки, куда его можно положить', click: ['[data-c="0"]'], captionPos: 'board' },
      { caption: 'Красный тайл в царстве с вашим жрецом: +1 красное очко', moves: [tile(RED, 'G3')], marks: [mark('G3', 'gold')], boxes: [{ sel: '.pc' }] },
      { caption: 'Зеленого лидера здесь нет, поэтому очко получает царь: +1 зеленое', moves: [tile(GREEN, 'H5')], marks: [mark('H5', 'gold')], boxes: [{ sel: '.pc' }], ms: 3400 },
    ],
  },
  {
    name: '04-lider',
    title: 'Как поставить лидера',
    setup: (s) => lay(s, { black: 'G5', action: 1 }),
    steps: [
      { caption: 'Лидер ставится на пустую клетку суши, только рядом с красным тайлом', click: ['[data-leader="2"]'], captionPos: 'board' },
      { caption: 'Лидер встал рядом с храмом: теперь это царство, и зеленые тайлы здесь приносят очки вам', moves: [leader(GREEN, 'F4')], marks: [mark('F4 G4 G5', 'green')], ms: 3200 },
    ],
  },
  {
    name: '05-vosstanie',
    title: 'Восстание',
    setup: (s) => lay(s, { red: 'G6', leaders: [[1, RED, 'H4']], hand: [2, 1, 2, 1], others: [1, 2, 2, 1] }),
    steps: [
      { caption: 'В царстве стоит красный жрец соперника. Поставим рядом своего', marks: [mark('H4', 'red'), mark('G5', 'gold')] },
      { caption: 'Два лидера одного цвета в царстве: восстание. Сила считается по храмам рядом с лидером', moves: [leader(RED, 'G5')], marks: [mark('G4 G6', 'gold'), mark('H4', 'red')], ms: 3400 },
      { caption: 'Добавляем красный тайл из руки: 3 против 1. При ничьей побеждает защитник', click: [FREE], ms: 3200 },
      { caption: 'Жрец соперника вернулся в руку, у вас +1 красное очко. Тайлы с поля не уходят', moves: [support(1), support(0)], click: ['[data-battle]'], burst: 9, ms: 3800 },
    ],
  },
  {
    name: '06-voyna',
    title: 'Война',
    setup: (s) => lay(s, { green: 'H4 H5 I4 K4 K5', leaders: [[0, GREEN, 'G5'], [1, GREEN, 'L5']], hand: [1, 1, 2, 2], others: [2, 1, 1, 2] }),
    steps: [
      { caption: 'Два царства, в каждом зеленый лидер. Между ними одна пустая клетка', marks: [mark('G4 G5 H4 H5 I4', 'green'), mark('K4 K5 L4 L5', 'red'), mark('J4', 'gold')], ms: 3200 },
      { caption: 'Тайл на J4 объединил их, а двух зеленых лидеров быть не может: война. Сила по зеленым тайлам, 3 против 2', moves: [tile(BLACK, 'J4')], marks: [mark('J4', 'gold')], ms: 3800 },
      { caption: 'Защитник может только сравнять счет, и при ничьей выиграет он. Поэтому атакующий добавляет два тайла', click: [FREE, FREE], ms: 3800 },
      { caption: 'Победа 5:2. Лидер и зеленые тайлы проигравшего ушли, у вас +3 зеленых: 1 за лидера и 2 за тайлы', moves: [support(2), support(0)], click: ['[data-battle]'], burst: 12, ms: 4000 },
      { caption: 'Зеленые тайлы соперника сняты, храм L4 остался на месте. Сам тайл на J4 очка не принес: он только объединил', marks: [mark('J4', 'gold'), mark('K4 K5', 'red', 0.16)], ms: 3000 },
    ],
  },
  {
    name: '07-monument',
    title: 'Монумент',
    setup: (s) => lay(s, { black: 'H5 I5 H6', leaders: [[0, BLACK, 'H4'], [0, RED, 'G5']], hand: [2, 1, 1, 2], action: 2 }),
    steps: [
      { caption: 'Три черных тайла уже лежат углом. Четвертый замкнет квадрат 2 на 2', marks: [mark('H5 I5 H6', 'gold'), mark('I6', 'white')] },
      { caption: 'Квадрат одного цвета можно превратить в монумент. У него два цвета, один из них цвет квадрата', moves: [tile(BLACK, 'I6')], click: ['[data-mon="2"]'], ms: 3400 },
      { caption: 'Тайл дал +1 черное, а в конце хода монумент дает царю и жрецу еще по очку. И так каждый ваш ход', moves: [{ type: 'monument', id: 2, tl: cell('H5') }], boxes: [{ sel: '.pc' }], ms: 4000 },
    ],
  },
  {
    name: '08-sokrovishche',
    title: 'Сокровища',
    setup: (s) => lay(s, { black: 'G5 G8', green: 'G6', leaders: [[0, GREEN, 'F4']], hand: [2, 1, 1, 2] }),
    steps: [
      { caption: 'Царство с зеленым лидером и один храм с сокровищем. Второй храм H8 рядом', marks: [mark('G4', 'gold'), mark('H8', 'gold'), mark('G7', 'white')] },
      { caption: 'Тайл на G7 соединил их. В царстве два сокровища: зеленый лидер сразу забирает одно', moves: [tile(BLACK, 'G7')], ms: 3400 },
      { caption: 'Сокровище ваше. В конце партии оно заменит очко любого цвета', moves: [{ type: 'treasure', pos: cell('H8') }], boxes: [{ sel: '.pc' }], ms: 3200 },
    ],
  },
  {
    name: '09-katastrofa',
    title: 'Катастрофа',
    setup: (s) => lay(s, { red: 'I5', black: 'H5 J5 K5', leaders: [[0, GREEN, 'G5'], [1, BLACK, 'I4']] }),
    steps: [
      { caption: 'Царь соперника держится за единственный храм рядом с собой, I5', marks: [mark('I4', 'red'), mark('I5', 'gold')] },
      { caption: 'Катастрофу можно положить на пустую клетку или на тайл без сокровища. Их всего две за партию', click: ['[data-cat="0"]'], captionPos: 'board', ms: 3200 },
      { caption: 'Клетка закрыта до конца партии. Царство разрезано, царь без храма вернулся в руку', moves: [{ type: 'catastrophe', pos: cell('I5') }], marks: [mark('I5', 'red', 0.1), mark('G4 G5 H5', 'green'), mark('J5 K5', 'gold')], ms: 3800 },
    ],
  },
  {
    name: '10-konec',
    title: 'Конец партии и счет',
    setup: (s) => {
      lay(s, { black: 'G5 G8', green: 'G6', leaders: [[0, GREEN, 'F4']], hand: [2, 1, 1, 2], action: 2, turn: 41, scores: [[12, 7, 9, 8], [15, 5, 11, 9], [8, 8, 10, 10]], treasures: [3, 2, 1], cats: [0, 1, 0] });
      for (const n of list(TEMPLES)) if (![cell('G4'), cell('H8'), cell('O2')].includes(n)) s.treasure[n] = 0;
    },
    steps: [
      { caption: 'На поле три сокровища. Как только их станет два, партия закончится', marks: [mark('G4 H8 O2', 'gold')] },
      { caption: 'У Игрока 2 больше всего очков, но он последний: считается самый слабый цвет. Сокровища идут в слабые цвета', moves: [tile(BLACK, 'G7'), { type: 'treasure', pos: cell('H8') }], ms: 4200 },
    ],
  },
  {
    name: '11-zdanie',
    title: 'Вариант: здания',
    setup: (s) => lay(s, { black: 'H5 I5', leaders: [[0, BLACK, 'H4']], hand: [2, 1, 1, 2] }),
    steps: [
      { caption: 'Три тайла одного цвета в ряд дают право поставить здание на один из них', moves: [tile(BLACK, 'J5')], ms: 3000 },
      { caption: 'Теперь черный тайл в этом царстве дает 2 очка, а тайл под зданием не снимается в войне', moves: [{ type: 'build', pos: cell('I5') }], marks: [mark('I5', 'gold')], ms: 3600 },
    ],
  },
  {
    name: '12-chudo',
    title: 'Вариант: чудо',
    setup: (s) => lay(s, { green: 'H6 J6 I5 I7', leaders: [[0, BLACK, 'H4']], black: 'H5', hand: [2, 1, 2, 1] }),
    steps: [
      { caption: 'Крест из пяти тайлов одного цвета можно превратить в чудо. На партию оно одно', moves: [tile(GREEN, 'I6'), { type: 'pass' }], marks: [mark('H6 J6 I5 I7 I6', 'gold')], click: ['[data-mon="wonder"]'], ms: 3200 },
      { caption: 'Если ваш царь в одном царстве с чудом, в конце вашего хода очко любого цвета на выбор', moves: [{ type: 'wonder', center: cell('I6') }, { type: 'pass' }], ms: 3600 },
    ],
  },
  {
    name: '13-interfeys',
    title: 'Как ходить на сайте',
    options: { confirmSeconds: 10 },
    setup: (s) => lay(s, { black: 'G5', leaders: [[0, BLACK, 'H4']], hand: [2, 1, 2, 1], action: 2 }),
    steps: [
      { caption: 'Сделали второе действие: есть 10 секунд, чтобы отменить его или завершить ход', moves: [tile(GREEN, 'H5')], boxes: [{ sel: '#gNow' }], ms: 3400 },
      { caption: 'Ползунок «Тайлы» показывает, к чьему лидеру идет каждый тайл', boxes: [{ sel: '[data-layer="owners"]' }], ms: 3000 },
    ],
  },
];
