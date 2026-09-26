'use strict';
// Local and self-hosted server: the same API as the Vercel functions in api/, plus the static page.
// Without Supabase variables rooms live in this process's memory (fine for one server, lost on restart).
const path = require('path');
const express = require('express');
const http = require('./lib/http');
const { buildRuntime } = require('./lib/runtime');

function createServer(options) {
  const opts = options || {};
  const rt = opts.runtime || buildRuntime(process.env);
  const app = express();
  app.disable('x-powered-by');

  const wrap = handler => (req, res) => {
    Promise.resolve(handler(rt, req, res)).catch(e => {
      console.error(e);
      if (!res.headersSent) http.sendJson(res, 500, { ok: false, error: 'Ошибка сервера' });
    });
  };
  app.all('/api/game', wrap(http.game));
  app.get('/api/config', wrap(http.config));
  app.get('/api/health', wrap(http.health));
  app.get('/api/cron', wrap(http.cron));

  // On Vercel these two files are copied into public/ by `npm run build`.
  app.get('/engine.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'engine.js')));
  app.get('/vendor/supabase.js', (req, res) => res.sendFile(require.resolve('@supabase/supabase-js/dist/umd/supabase.js')));
  app.use(express.static(path.join(__dirname, 'public')));

  return { app, runtime: rt };
}

if (require.main === module) {
  const { app, runtime } = createServer();
  if (runtime.error) {
    console.error(runtime.error);
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Tigris & Euphrates: http://localhost:${port} (rooms: ${runtime.storeKind}, realtime: ${runtime.publicConfig.realtime ? 'on' : 'off'})`);
  });
}

module.exports = { createServer };
