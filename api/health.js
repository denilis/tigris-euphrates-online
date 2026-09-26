'use strict';
// Vercel Function — GET: deployment check — store type and database round trip
const { getRuntime } = require('../lib/runtime');
const http = require('../lib/http');

module.exports = (req, res) => http.health(getRuntime(), req, res);
