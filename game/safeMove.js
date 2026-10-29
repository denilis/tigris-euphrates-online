// Безопасный ход, когда решение бота не годится (упал, не уложился, вернул чужой ход).
// Та же логика, что safeMove в tigris-bot/adapter/actions.js: адаптер BGA в сайт не копируем.
export function safeMove(s) {
  switch (s.phase) {
    case 'revoltSupport':
    case 'warSupport':
      return { type: 'support', n: 0 };
    case 'warChoose':
      return { type: 'warColor', color: s.ctx.warColors[0] };
    case 'treasure':
      return { type: 'treasure', pos: s.ctx.treasure.options[0] };
    case 'wonderPoint':
      return { type: 'wonderPoint', color: 0 };
    case 'confirm':
      return { type: 'confirm' };
    default:
      return { type: 'pass' };
  }
}
