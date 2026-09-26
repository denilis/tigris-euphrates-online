'use strict';
// Vercel Function — POST: every player request (create, join, sync, action…)
const { getRuntime } = require('../lib/runtime');
const http = require('../lib/http');

module.exports = (req, res) => http.game(getRuntime(), req, res);
