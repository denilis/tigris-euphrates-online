// Стили игры бота: наборы весов оценки и цен ходов, подобранные по партиям
// BGA (sim/train.js -> bot/styles_data.js). Смесь стилей — взвешенное среднее
// их весов: 50% Дениса и 50% топ-мастеров дают веса ровно посередине.

import { DEFAULT_WEIGHTS } from './evaluate.js';
import { TRAINED as BUILT_IN } from './styles_data.js';

let TRAINED = BUILT_IN;

/** Подменить обученные стили (турниры сравнивают разные прогоны обучения). */
export function useTrained(styles) {
  TRAINED = styles || BUILT_IN;
}

export const STYLE_LABELS = {
  universal: 'Универсальный',
  base: 'Базовый',
  top: 'Топ-мастера',
  denis: 'Денис',
  andrey: 'Андрей',
  vlad: 'Влад',
  mix: 'Смесь',
};

// Стили, из которых собирается смесь, и ключи настроек панели для их долей.
export const MIX_KEYS = { top: 'mixTop', denis: 'mixDenis', andrey: 'mixAndrey', vlad: 'mixVlad' };

const BASE = { weights: DEFAULT_WEIGHTS, relocate: 0.6, discard: 0.3 };

/**
 * Характер ботов по описанию Дениса 11.11, поверх весов, обученных на партиях BGA. Обучение
 * дало похожих ботов: все садились у соседних храмов и играли одинаково. Здесь задано то,
 * что живые игроки делают по-разному. riskShift сдвигает риск настроек (порог шанса для атаки).
 *   Андрей (поправка Дениса 11.11 вечером): строитель, потом каток. Пока другие дерутся, растит
 *     большое царство, в конфликты не лезет и потому не теряет тайлы; лидеры у 3-4 храмов, строит
 *     в две линии; монументы реже других; потом внешними войнами с большим перевесом вышибает всех.
 *     Профиль BGA (astrelkov, 57 партий, data/analysis/partners_all.json): 3 атаки в раундах 1-6,
 *     первая на 11,4 раунде, 69% атак с 13-го, войн 4,35 за партию с 81% побед и перевесом +4,
 *     восстаний 1,11, монументов 1,46 (Влад 2,14), зданий 1,98, перестановок 0,6.
 *   Влад: напористый. Чаще подставляет лидеров в чужие царства, охотнее воюет и восстает.
 *   Денис: своих лидеров в чужие царства не ставит (кроме цвета к чужому монументу), а чужого
 *     лидера в своем царстве выжидает и выбивает.
 * peaceRounds, lateWar: см. bot.js conflictThreshold и lateWarBias; relocate: цена перестановки.
 */
export const CHARACTER = {
  andrey: {
    // bRevolt -0.5 и bWar около 0 уже в обученных весах; войну дают раунды, а не постоянный вкус.
    // Первый вариант (bWar -0.6, bRevolt -0.8, riskShift -30, «просто не воюет») на замере 11.11
    // выиграл 1 из 24, место 3,38: это был не его стиль.
    // Вкусы формы и тесноты (crowd 1,8, guest -1, host -0,3, fragile 0,6, thin 0,5, temple 0,45,
    // handRed 0,3, revoltHole 0,8, prodRate 0,18) сняты 12.11: с ними 1 победа из 24 в трех замерах
    // (место 3,38-3,59), без них при тех же раундах 9 из 24, место 2,42, своих атак выиграно 78%
    // (data/selfplay/andrey-2026-11-11/variants.txt, вариант B). Мешали и сами веса, и цена: форма
    // царства удлиняла оценку в 1,8 раза, и за 500 мс бот видел меньше ходов, чем соперники.
    // Остались обученные веса Андрея и поведение по раундам ниже.
    // Донастройка 12.11 (замер 96 партий за столом с Владом, Денисом и Универсальным, те же раздачи):
    // без тяги к монументам (bMonument 0 вместо 0,3) и осторожнее в атаке (riskShift -30 вместо -20)
    // место 2,54 против 2,83, побед 23 против 10, выиграно своих атак 75% против 66%, монументов
    // 0,17 за партию против 0,41 у Влада (было 0,36). Один на один против трех прежних Андреев
    // 20% побед, место 2,45: не слабее. Сильнее поздняя война (lateWar 1,2) дала то же место,
    // но монументов больше Влада.
    weights: { bMonument: 0 },
    riskShift: -30, // начинает конфликт только сильным: перевес +4 на BGA
    peaceRounds: 10,
    lateWar: 0.8,
    relocate: 1.0,
  },
  vlad: { weights: { crowd: 0.8, guest: 0.6, attack: 0.3, bWar: 0.6, bRevolt: 0.2 }, riskShift: 20 },
  denis: { weights: { crowd: 1.5, guest: -1.2, host: -0.7, bWar: 0.3 }, riskShift: 0 },
};

/** Обученный стиль с характером поверх. */
function withCharacter(name, st) {
  const ch = CHARACTER[name];
  if (!ch) return st;
  return {
    ...st, weights: { ...st.weights, ...ch.weights }, riskShift: ch.riskShift || 0,
    peaceRounds: ch.peaceRounds || 0, lateWar: ch.lateWar || 0, relocate: ch.relocate ?? st.relocate,
  };
}

/** Доли смеси из настроек: { top: 50, denis: 50 } или строка "top:50/denis:50". */
export function mixShares(settings) {
  let mix = settings.mix;
  if (typeof mix === 'string') {
    const o = {};
    for (const part of mix.split(/[/+;]/)) {
      const [k, v] = part.split(':');
      if (k) o[k.trim()] = Number(v);
    }
    mix = o;
  }
  if (!mix) {
    mix = {};
    for (const [style, key] of Object.entries(MIX_KEYS)) if (settings[key] !== undefined) mix[style] = Number(settings[key]);
  }
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(mix)) {
    if (!(v > 0) || !TRAINED[k]) continue;
    out[k] = v;
    total += v;
  }
  if (!total) return null;
  for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

function blend(parts) {
  const weights = {};
  for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) weights[k] = Array.isArray(v) ? v.map(() => 0) : 0;
  let relocate = 0, discard = 0, riskShift = 0, peaceRounds = 0, lateWar = 0;
  for (const { style, share } of parts) {
    const w = { ...DEFAULT_WEIGHTS, ...style.weights };
    for (const [k, v] of Object.entries(w)) {
      if (!(k in weights)) continue;
      if (Array.isArray(v)) v.forEach((x, i) => { weights[k][i] += share * x; });
      else weights[k] += share * v;
    }
    relocate += share * style.relocate;
    discard += share * style.discard;
    riskShift += share * (style.riskShift || 0);
    peaceRounds += share * (style.peaceRounds || 0);
    lateWar += share * (style.lateWar || 0);
  }
  // смесь: мирных раундов столько, сколько в среднем (50% Андрея дают 5)
  return { weights, relocate, discard, riskShift, peaceRounds: Math.round(peaceRounds), lateWar };
}

/** Веса оценки и цены ходов по настройкам бота: settings.style, settings.mix / mixTop... */
export function styleParams(settings = {}) {
  const name = settings.style || 'base';
  if (name === 'mix') {
    const shares = mixShares(settings);
    if (!shares) return BASE;
    return blend(Object.entries(shares).map(([k, share]) => ({ style: withCharacter(k, TRAINED[k]), share })));
  }
  const st = TRAINED[name];
  if (!st) return BASE;
  return blend([{ style: withCharacter(name, st), share: 1 }]);
}

/** Какие стили есть в сборке (обученные + базовый и смесь). */
export function availableStyles() {
  return Object.keys(STYLE_LABELS).filter((k) => k === 'base' || k === 'mix' || TRAINED[k]);
}
