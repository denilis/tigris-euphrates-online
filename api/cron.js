'use strict';
// Vercel Function — GET: daily purge of abandoned rooms (Vercel Cron)
const { getRuntime } = require('../lib/runtime');
const http = require('../lib/http');

module.exports = (req, res) => http.cron(getRuntime(), req, res);
