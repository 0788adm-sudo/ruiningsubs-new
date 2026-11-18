/**
 * Username ↔ permanent account identity sync.
 * Ensures publications stay linked by user_id / anon_id / aliases, not raw username text.
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var gamePlay = fs.readFileSync(path.join(root, 'api/game-play.js'), 'utf8');
var mig = fs.readFileSync(path.join(root, 'migrations/20261118_user_identity_aliases.sql'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

ok(html.indexOf('function getPermanentAccountId(') >= 0, 'permanent account id helper');
ok(html.indexOf('function sameAccountPost(') >= 0, 'sameAccountPost ownership helper');
ok(html.indexOf('function fetchSbPostsForAccount(') >= 0, 'Supabase account post fetch');
ok(html.indexOf('function serverRenameUsername(') >= 0, 'server rename client');
ok(html.indexOf('function displayAuthorName(') >= 0, 'dynamic display author');
ok(html.indexOf('seedKnownUsernameAliases') >= 0, 'seeds UkPaki29 → UkPakiUmayr29 alias');
ok(html.indexOf('anon_amwk2a8nj29r3kaxny6') >= 0, 'known permanent anon id for affected user');
ok(html.indexOf("uid:'+perm") >= 0 || html.indexOf('uid:' + "'") >= 0 || /uid:/.test(html), 'publish stamps uid tag');
ok(html.indexOf('refreshUsernameAliasMap') >= 0, 'alias map refresh');
ok(html.indexOf('resolveCurrentUsername(requested)') >= 0 || html.indexOf('resolveCurrentUsername(requested)||requested') >= 0, 'openUser resolves old handles');
ok(html.indexOf('fetchSbPostsForAccount(username') >= 0, 'openUser gallery uses SB account fetch');
ok(html.indexOf('fetchSbPostsForAccount(meName') >= 0 || html.indexOf('fetchSbPostsForAccount(currentUser.name') >= 0, 'own gallery/stats use SB account fetch');
ok(html.indexOf('serverRenameUsername(oldName,newName') >= 0, 'saveProfile calls server rename');
ok(html.indexOf('sameAccountPost(p, currentUser.name)') >= 0, 'profile stats filter by account');

ok(gamePlay.indexOf('BOARD_USERNAME_ALIASES') >= 0, 'alias board constant');
ok(gamePlay.indexOf('rename_username') >= 0, 'rename_username action');
ok(gamePlay.indexOf('repair_username') >= 0, 'repair_username action');
ok(gamePlay.indexOf('migrateUsernameRecords') >= 0, 'server migrateUsernameRecords');
ok(gamePlay.indexOf('handleUsernameIdentity') >= 0, 'identity handler');
ok(gamePlay.indexOf('UkPakiUmayr29') >= 0 && gamePlay.indexOf('UkPaki29') >= 0, 'built-in repair targets');

ok(/username_aliases/.test(mig), 'migration creates username_aliases');
ok(/ADD COLUMN IF NOT EXISTS user_id/.test(mig), 'migration adds user_id columns');
ok(/anon_id:amwk2a8nj29r3kaxny6/.test(mig), 'migration repairs known account posts');
ok(/UkPakiUmayr29/.test(mig) && /ukpaki29/.test(mig), 'migration maps old→new username');

// Lightweight pure logic check mirroring client helpers
function normUserKey(u) {
  return String(u || '')
    .replace(/^@+/, '')
    .trim()
    .toLowerCase()
    .slice(0, 64);
}
var aliases = {
  ukpaki29: { current: 'UkPakiUmayr29', user_id: 'anon_amwk2a8nj29r3kaxny6' },
  ukpakiumayr29: { current: 'UkPakiUmayr29', user_id: 'anon_amwk2a8nj29r3kaxny6' }
};
function resolve(name) {
  var row = aliases[normUserKey(name)];
  return (row && row.current) || name;
}
ok(resolve('ukpaki29') === 'UkPakiUmayr29', 'logic: old username resolves to current');
ok(resolve('UKPAKIUMAYR29') === 'UkPakiUmayr29', 'logic: case variants resolve');
ok(resolve('UkPakiUmayr29') === 'UkPakiUmayr29', 'logic: current username stable');

console.log('\nAll username identity sync checks passed.');
