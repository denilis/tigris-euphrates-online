// Характер ботов (Денис 11.11): теснота дебюта, лидеры в чужих царствах, хрупкость царства
// перед катастрофой, лидер на одном храме; стили Андрея, Влада и Дениса различаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionRecord, recordOpts, X_CROWD, X_GUEST, X_HOST, X_FRAGILE, X_THIN, evaluate } from '../bot/evaluate.js';
import { styleParams, CHARACTER } from '../bot/styles.js';
import { params, conflictThreshold, lateWarBias, flagCost, F_WAR, PEACE_THRESHOLD } from '../bot/bot.js';
import { RED, BLUE, GREEN, BLACK } from '../engine/constants.js';
import { bare, put, lead, at } from './helpers.js';

const rec = (s, shape = true) => positionRecord(s, { shape });

test('теснота в дебюте: чужой лидер рядом теснит, дальше 4 клеток нет; к 5-му кругу сходит на нет', () => {
  const s = bare(2);
  put(s, 'B2', RED); lead(s, 0, BLACK, 'B3');
  put(s, 'D2', RED); lead(s, 1, BLACK, 'D3');
  assert.ok(rec(s).players[0][X_CROWD] > 0.4, 'через клетку: тесно');
  const far = bare(2);
  put(far, 'B2', RED); lead(far, 0, BLACK, 'B3');
  put(far, 'M9', RED); lead(far, 1, BLACK, 'M10');
  assert.equal(rec(far).players[0][X_CROWD], 0);
  s.turn = 1 + 4 * 2;
  assert.equal(rec(s).players[0][X_CROWD], 0, 'после 4 кругов теснота не считается');
});

test('в гостях и у себя: лидер в чужом царстве, кроме прихода к монументу своего цвета', () => {
  const s = bare(2);
  put(s, 'B2', RED); put(s, 'C2', BLACK); put(s, 'D2', RED);
  lead(s, 0, BLACK, 'B3'); lead(s, 0, GREEN, 'D3'); // хозяин царства: два лидера
  lead(s, 1, BLUE, 'C3'); // гость
  let r = rec(s);
  assert.equal(r.players[1][X_GUEST], 1);
  assert.equal(r.players[0][X_HOST], 1);
  assert.equal(r.players[0][X_GUEST], 0);
  // монумент синего цвета в этом царстве: гость пришел к нему по делу
  s.monuments.find((m) => m.c1 === BLUE || m.c2 === BLUE).pos = at('B2');
  s.monument[at('B2')] = s.monuments.find((m) => m.c1 === BLUE || m.c2 === BLUE).id;
  r = rec(s);
  assert.equal(r.players[1][X_GUEST], 0);
});

test('хрупкость: царство в одну линию рвется катастрофой, в две линии нет', () => {
  const line = bare(1);
  put(line, 'B2', RED);
  for (const c of ['C2', 'D2', 'E2', 'F2', 'G2']) put(line, c, BLACK);
  lead(line, 0, BLACK, 'B3');
  const thin = rec(line).players[0][X_FRAGILE];
  assert.ok(thin >= 0.75, `линия: катастрофа на C2 отрезает 4 тайла, ${thin}`);
  const wide = bare(1);
  put(wide, 'B2', RED);
  for (const c of ['C2', 'D2', 'E2', 'F2', 'G2', 'C3', 'D3', 'E3', 'F3', 'G3']) put(wide, c, BLACK);
  lead(wide, 0, BLACK, 'B3');
  assert.equal(rec(wide).players[0][X_FRAGILE], 0, 'две линии: одна катастрофа ничего не отрезает');
});

test('лидер на одном открытом храме тонкий; на двух или на храме с сокровищем нет', () => {
  const s = bare(1);
  put(s, 'B2', RED); lead(s, 0, RED, 'B3');
  assert.equal(rec(s).players[0][X_THIN], 1);
  put(s, 'B4', RED);
  assert.equal(rec(s).players[0][X_THIN], 0);
  const t = bare(1);
  put(t, 'B2', RED, { treasure: true }); lead(t, 0, RED, 'B3');
  assert.equal(rec(t).players[0][X_THIN], 0, 'на храм с сокровищем катастрофу не положить');
});

test('вкус характера только свой: у соперника те же признаки в оценку не идут', () => {
  const s = bare(2);
  put(s, 'B2', RED); lead(s, 0, BLACK, 'B3');
  put(s, 'D2', RED); lead(s, 1, BLACK, 'D3');
  const w = styleParams({ style: 'andrey' }).weights;
  const calm = { ...w, crowd: 0 };
  // теснота одинакова у обоих; если бы она шла в силу соперника, разница бы взаимно гасилась
  assert.ok(evaluate(s, 0, { weights: w }) < evaluate(s, 0, { weights: calm }) - 0.5);
});

test('стили различаются характером: риск, вкус к войне и к чужим царствам', () => {
  const a = styleParams({ style: 'andrey' }), v = styleParams({ style: 'vlad' }), d = styleParams({ style: 'denis' });
  assert.ok(a.riskShift < 0 && v.riskShift > 0, 'Андрей осторожнее, Влад смелее');
  assert.ok(params({ style: 'andrey' }).attackThreshold > params({ style: 'vlad' }).attackThreshold);
  assert.ok(v.weights.guest > 0 && !(a.weights.guest > 0), 'в чужие царства охотно ставит только Влад');
  // Денис (12.11): своего лидера ставит к чужому монументу и туда, где много тайлов цвета
  assert.ok(d.weights.guest === 0 && d.weights.support > a.weights.support && d.weights.attack > 0, 'Денис ходит в чужие царства за тайлами и монументом');
  assert.ok(d.weights.cohesion > a.weights.cohesion && d.weights.temple > a.weights.temple, 'Денис держит лидеров вместе у храмов');
  assert.ok(d.weights.bRevolt > a.weights.bRevolt && !params({ style: 'denis' }).peaceRounds, 'Денис восстает охотнее Андрея и без мирных раундов');
  assert.ok(d.weights.bMonument > a.weights.bMonument && d.weights.traderTreasure > a.weights.traderTreasure, 'монументы и сокровища');
  assert.ok(d.weights.host < 0, 'Денис выбивает чужих из своего царства');
  assert.ok(d.weights.crowd > v.weights.crowd, 'Денис встает дальше Влада');
  // Андрей без вкусов формы (замер 12.11, вариант B): оценка без дорогого расчета формы царства
  assert.equal(recordOpts(a.weights).shape, false, 'у Андрея оценка без формы царства');
  assert.ok(v.weights.bWar > a.weights.bWar, 'в среднем за партию Влад любит войну больше Андрея');
  for (const k of Object.keys(CHARACTER)) assert.ok(styleParams({ style: k }).weights.crowd > 0, `${k}: в дебюте не садится вплотную`);
  assert.ok(styleParams({ style: 'universal' }).weights.crowd > 0, 'и остальные стили тоже');
});

// Андрей по поправке Дениса 11.11 и профилю BGA: строитель, потом каток
const rnd = (round, np = 4) => ({ turn: (round - 1) * np + 1, np });

test('Андрей: первые 10 раундов конфликт только при почти верной победе, потом обычный порог', () => {
  const P = params({ style: 'andrey' });
  assert.equal(P.peaceRounds, 10);
  assert.equal(conflictThreshold(rnd(1), P), PEACE_THRESHOLD);
  assert.equal(conflictThreshold(rnd(10), P), PEACE_THRESHOLD);
  assert.equal(conflictThreshold(rnd(11), P), P.attackThreshold);
  assert.ok(P.attackThreshold > params({ style: 'vlad' }).attackThreshold, 'и потом нападает только сильным');
  assert.equal(conflictThreshold(rnd(11, 3), P), P.attackThreshold, 'раунд считается по числу игроков');
});

test('Андрей: вкус к войне растет после мирных раундов, поздняя война дешевле ранней', () => {
  const P = params({ style: 'andrey' });
  assert.equal(lateWarBias(rnd(10), P), 0);
  const mid = lateWarBias(rnd(12), P);
  assert.ok(mid > 0 && mid < P.lateWar, `на 12-м раунде часть: ${mid}`);
  assert.equal(lateWarBias(rnd(15), P), P.lateWar);
  assert.equal(lateWarBias(rnd(19), P), P.lateWar, 'дальше не растет');
  assert.ok(flagCost(F_WAR, P, rnd(16)) < flagCost(F_WAR, P, rnd(5)));
  assert.equal(flagCost(F_WAR, P), flagCost(F_WAR, P, rnd(5)), 'без позиции как в мирные раунды');
});

test('другие стили по раундам не меняются; Андрей реже переставляет лидеров и строит монументы', () => {
  for (const style of ['vlad', 'denis', 'universal', 'top', 'base']) {
    const P = params({ style });
    assert.equal(conflictThreshold(rnd(3), P), P.attackThreshold, style);
    assert.equal(lateWarBias(rnd(16), P), 0, style);
  }
  assert.ok(params({ style: 'andrey' }).relocate > params({ style: 'vlad' }).relocate);
  assert.ok(styleParams({ style: 'andrey' }).weights.bMonument < styleParams({ style: 'vlad' }).weights.bMonument);
  assert.equal(styleParams({ style: 'mix', mixAndrey: 50, mixTop: 50 }).peaceRounds, 5, 'в смеси половина мирных раундов');
});
