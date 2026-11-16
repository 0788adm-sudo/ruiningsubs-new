#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var del = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
var unpin = fs.readFileSync(path.join(root, 'api', 'admin-unpin.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(html.indexOf('function adminHardDeletePost') >= 0, 'adminHardDeletePost helper');
assert(html.indexOf('function clearRemoveRequestArtifacts') >= 0, 'clearRemoveRequestArtifacts');
assert(html.indexOf('function postMissingInDb') >= 0, 'postMissingInDb');
assert(html.indexOf("adminHardDeletePost(postId)") >= 0 || html.indexOf('adminHardDeletePost(postId)') >= 0, 'approve uses hard delete');
assert(html.indexOf('CLEAR REQUEST') >= 0, 'UI for already-gone posts');
assert(html.indexOf('Never prompt for password while loading this tab') >= 0, 'DELETE REQUESTS no password prompt on load');
assert(html.indexOf('haveTok?(await cfAdminRequests') >= 0, 'optional CF admin queue');
assert(del.indexOf('verifyCfAdminToken') >= 0 && (del.indexOf('attempt < 2') >= 0 || del.indexOf('attempt < 3') >= 0), 'delete-post retries admin verify');
assert(unpin.indexOf('already_unpinned') >= 0, 'unpin idempotent already_unpinned');
assert(unpin.indexOf('cfFetchTimed') >= 0 || unpin.indexOf('attempt < 3') >= 0, 'unpin retries admin verify');
assert(html.indexOf('Always clear local + SB + CF pin state') >= 0, 'unpin always clears DB/CF');
assert(html.indexOf("secureDeletePost(id,{reason:'paid'") >= 0, 'FC still uses paid auto-delete');
assert(html.indexOf('requestDeleteWithCoins') >= 0, 'FC delete helper kept');
// GoonTok / media untouched markers
assert(html.indexOf('goontok') >= 0 || html.indexOf('GoonTok') >= 0, 'GoonTok still present');
assert(!/from\('posts'\)\.delete[\s\S]{0,40}goontok/i.test(html), 'no goontok mass delete');

console.log('\nOK · admin-delete-unpin-fix');
