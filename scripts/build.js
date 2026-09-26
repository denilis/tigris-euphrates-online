'use strict';
// Build for static hosting (Vercel): puts the rules engine and the Supabase browser client next to
// the page. Both files are generated — the sources are shared/engine.js and node_modules.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const copies = [
  [path.join(root, 'shared', 'engine.js'), path.join(root, 'public', 'engine.js')],
  [require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), path.join(root, 'public', 'vendor', 'supabase.js')]
];

for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`${path.relative(root, to)} ← ${path.relative(root, from)} (${fs.statSync(to).size} bytes)`);
}
