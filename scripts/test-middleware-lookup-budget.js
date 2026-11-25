#!/usr/bin/env node
/**
 * Edge post lookup must not wait on hanging CF for numeric Supabase ids,
 * and must bound total wait so Telegram/Safari never spin blank.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var mw = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(mw.indexOf('LOOKUP_TIMEOUT_MS') >= 0, 'per-request timeout');
assert(mw.indexOf('LOOKUP_BUDGET_MS') >= 0, 'overall budget');
assert(/LOOKUP_TIMEOUT_MS\s*=\s*2000/.test(mw), 'per-request timeout ≤ 2s');
assert(/LOOKUP_BUDGET_MS\s*=\s*2800/.test(mw), 'overall budget ≤ 2.8s');
assert(mw.indexOf('isNumericPostId') >= 0, 'numeric id helper');
assert(mw.indexOf('isUuidPostId') >= 0, 'uuid id helper');
assert(mw.indexOf('lookupSupabase') >= 0, 'SB lookup helper');
assert(mw.indexOf('lookupCloudflare') >= 0, 'CF lookup helper');
assert(mw.indexOf('Numeric SB ids live only in Supabase') >= 0, 'skip CF for numeric miss');
assert(mw.indexOf('Promise.race') >= 0, 'budget via Promise.race');
assert(mw.indexOf('AbortController') >= 0, 'abort support');

assert(html.indexOf('rs-boot-rescue') >= 0, 'dead-shell rescue overlay');
assert(html.indexOf('__rsBootPainted') >= 0, 'paint marks shell alive');
assert(html.indexOf('shellLooksAlive') >= 0, 'alive-shell detector');
assert(html.indexOf("fetchWithTimeout(u,{cache:'default'},4500)") >= 0 ||
  html.indexOf('fetchWithTimeout(u,{cache:\'default\'},4500)') >= 0 ||
  /fetchWithTimeout\(\s*u\s*,\s*\{[^}]*\}\s*,\s*4500\s*\)/.test(html),
  'CF feed fetch has timeout');
assert(html.indexOf('sbAuthTimeout(sb.auth.getSession(),8000)') >= 0, 'getSession timeouts on rename/tus');

console.log('OK · middleware-lookup-budget');
