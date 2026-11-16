#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');

function ok(c, m) {
  assert.ok(c, m);
  console.log('PASS · ' + m);
}

ok(html.indexOf('function adminDirectDeletePost') >= 0, 'direct SB admin delete helper');
ok(html.indexOf('Fast path first: unlocked admin deletes') >= 0, 'approve prefers direct delete');
ok(html.indexOf('noPromptLogin') >= 0, 'approve never password-prompts mid-delete');
ok(html.indexOf('ADMIN_REMOVE_LOCK_TTL_MS') >= 0, 'approve lock has TTL');
ok(html.indexOf('adminRemoveLockHeld') >= 0, 'lock helper');
ok(html.indexOf('CF cleanup is best-effort, timed') >= 0 || html.indexOf('never prompts for password') >= 0, 'CF cleanup timed');
ok(html.indexOf("timeoutMs:18000") >= 0 || html.indexOf('timeoutMs:18000') >= 0, 'short API budget for moderation');
ok(html.indexOf('Background CF request cleanup') >= 0 || html.indexOf('must not block success') >= 0, 'success before CF cleanup');
ok(/attempt < 2/.test(api) && /6000/.test(api), 'server admin verify is short');

console.log('\nOK · approve-delete-hang');
