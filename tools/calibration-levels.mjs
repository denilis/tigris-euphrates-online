// Ступени силы для калибровочного турнира (Денис 05.11): самая слабая настройка ползунков и четыре
// ступени из карточек ботов (public/js/bot-steps.js). Порядок от слабой к сильной.
import { STRENGTH_GUIDE } from '../public/js/bot-steps.js';

export const LEVELS = [
  { id: 'min', title: 'Самый слабый', set: { strength: 0, errors: 30, counting: 'none' } },
  ...STRENGTH_GUIDE.map((g, i) => ({ id: ['learn', 'casual', 'sure', 'max'][i], title: g.title, set: g.set })),
];
