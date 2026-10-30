// Случайные секреты для переменных Vercel. Ничего не сохраняет: значения печатаются в консоль,
// их вставляют в Settings проекта (Environment Variables) и больше нигде не хранят.
//   node tools/gen-secrets.js
import { randomBytes } from 'node:crypto';
import { newCode } from '../server/auth.js';

const hex = (n) => randomBytes(n).toString('hex');

console.log(`SESSION_SECRET=${hex(32)}`);
console.log(`CODE_PEPPER=${hex(32)}`);
console.log(`ADMIN_CODE=${newCode()}`);
console.log('ADMIN_NAME=Денис');
console.log('\nCODE_PEPPER после выдачи кодов игрокам менять нельзя: все выданные коды перестанут подходить.');
