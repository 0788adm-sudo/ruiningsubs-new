#!/usr/bin/env node
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var root = path.join(__dirname, '..');
var PORT = Number(process.env.PORT || 4173);

function send(res, code, body, headers) {
  headers = headers || {};
  headers['Cache-Control'] = headers['Cache-Control'] || 'no-store';
  res.writeHead(code, headers);
  res.end(body);
}

function asVercelRes(res) {
  var headers = {};
  return {
    statusCode: 200,
    setHeader: function (k, v) { headers[k] = v; },
    end: function (body) {
      var out = {};
      Object.keys(headers).forEach(function (k) { out[k] = headers[k]; });
      send(res, this.statusCode || 200, body, out);
    }
  };
}

function asVercelReq(req, bodyObj, query) {
  return {
    method: req.method,
    headers: req.headers,
    body: bodyObj,
    query: query || {},
    on: req.on.bind(req),
    url: req.url
  };
}

function readJson(req) {
  return new Promise(function (resolve) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

var apiMap = {
  '/api/game-play': '../api/game-play.js',
  '/api/fc-spend': '../api/fc-spend.js',
  '/api/admin-request': '../api/admin-request.js',
  '/api/videos': '../api/videos.js'
};

var server = http.createServer(async function (req, res) {
  var parsed = url.parse(req.url, true);
  var p = parsed.pathname || '/';
  if (p === '/') p = '/index.html';

  if (apiMap[p]) {
    try {
      var handler = require(path.join(__dirname, apiMap[p]));
      var body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};
      var vReq = asVercelReq(req, body, parsed.query);
      var vRes = asVercelRes(res);
      await handler(vReq, vRes);
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }), {
        'Content-Type': 'application/json'
      });
    }
    return;
  }

  var file = path.join(root, p.replace(/^\//, ''));
  // SPA fallback: client routes (/wall, /goontok, /post/:id, …) serve index.html
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    var looksStatic = /\.[a-z0-9]{1,8}$/i.test(p);
    if (!looksStatic && fs.existsSync(path.join(root, 'index.html'))) {
      send(res, 200, fs.readFileSync(path.join(root, 'index.html')), {
        'Content-Type': 'text/html; charset=utf-8'
      });
      return;
    }
    send(res, 404, 'Not found');
    return;
  }
  var ext = path.extname(file).toLowerCase();
  var type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.json' ? 'application/json' : 'application/octet-stream';
  send(res, 200, fs.readFileSync(file), { 'Content-Type': type });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('local-dev http://127.0.0.1:' + PORT);
});
