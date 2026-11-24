/**
 * Guards for permanent @UkPakiUmayr29 purge + anti-resurrection blocklist.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var purge = fs.readFileSync(path.join(root, 'scripts/purge-user-ukpakiumayr29.js'), 'utf8');
var mediaDel = fs.readFileSync(path.join(root, 'workers/media-delete.js'), 'utf8');
var gamePlay = fs.readFileSync(path.join(root, 'api/game-play.js'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

ok(html.indexOf('PERMANENTLY_DELETED_USERNAMES') >= 0, 'permanent delete blocklist present');
ok(html.indexOf('ukpakiumayr29:true') >= 0 && html.indexOf('ukpaki29:true') >= 0, 'UkPaki handles blocked');
ok(html.indexOf('3941a783-0543-46df-96b8-6aa3d21bb6fa') >= 0, 'auth uuid blocked');
ok(html.indexOf('function isPermanentlyDeletedAccount') >= 0, 'isPermanentlyDeletedAccount helper');
ok(html.indexOf('This username is permanently closed') >= 0, 'register blocked for deleted usernames');
ok(html.indexOf('cannot publish') >= 0, 'createPost blocked for deleted accounts');
ok(html.indexOf("status.eq.deleted") >= 0, 'loadBannedUsers includes deleted status');
ok(/KNOWN_USERNAME_REPAIRS=\{\s*\}/.test(html) || html.indexOf('KNOWN_USERNAME_REPAIRS={}') >= 0, 'UkPaki alias seed removed');
ok(html.indexOf("st==='deleted'") >= 0, 'enforceCurrentAccount treats deleted');

ok(purge.indexOf('UkPakiUmayr29') >= 0 && purge.indexOf('UkPaki29') >= 0, 'purge script targets both handles');
ok(purge.indexOf('ExposingIqra') >= 0 || purge.indexOf('3892') >= 0, 'purge preserves unrelated post check');
ok(purge.indexOf('isTargetUsername') >= 0, 'ownership guard in purge');
ok(purge.indexOf('[account permanently deleted]') >= 0, 'scrub fallback for RLS-blocked rows');

ok(mediaDel.indexOf('handleMediaDelete') >= 0, 'worker media delete patch');
ok(mediaDel.indexOf('admin_required') >= 0, 'media delete requires admin');
ok(mediaDel.indexOf('bucket.delete') >= 0, 'media delete calls R2 delete');

ok(
  gamePlay.indexOf("toName = toName || 'UkPakiUmayr29'") < 0,
  'game-play no longer auto-repairs purged account'
);

console.log('\nAll purge-ukpakiumayr29 checks passed.');
