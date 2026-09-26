'use strict';
// Vercel Function — GET: Realtime settings for the page
const { getRuntime } = require('../lib/runtime');
const http = require('../lib/http');

module.exports = (req, res) => http.config(getRuntime(), req, res);
