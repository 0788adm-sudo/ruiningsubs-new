/**
 * Anonymous public display names: anon_* → SubN (stable), normal usernames untouched.
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert(html.indexOf('function shortDisplayUser') >= 0, 'shortDisplayUser exists');
assert(html.indexOf("return 'Sub'+num") >= 0, 'maps anon hash to SubN');
assert(/Registered \/ normal usernames are returned unchanged/.test(html), 'documents normal usernames preserved');
assert(html.indexOf('ensure_anon_subs') >= 0, 'client can ensure consecutive Sub numbers');
assert(html.indexOf('list_anon_subs') >= 0, 'client loads Sub registry');
assert(html.indexOf('rs_anon_sub_map') >= 0, 'local permanent Sub cache');

var game = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'game-play.js'), 'utf8');
assert(game.indexOf('BOARD_ANON_SUBS') >= 0, 'server Sub board');
assert(game.indexOf('getOrAssignSubNumber') >= 0, 'server assigns Sub numbers');
assert(game.indexOf("display_name: 'Sub'") >= 0 || game.indexOf("display_name: 'Sub' +") >= 0, 'server returns Sub display_name');

var start = html.indexOf('function isAnonymousAccountName');
var end = html.indexOf('window.shortDisplayUser=shortDisplayUser;');
assert(start > 0 && end > start, 'extract bounds for anon display helpers');
var chunk = html.slice(start, end + 'window.shortDisplayUser=shortDisplayUser;'.length);

var sandbox = {
  console: console,
  Math: Math,
  String: String,
  Number: Number,
  RegExp: RegExp,
  window: {}
};
sandbox.window = sandbox;
var fn = new Function(
  'window',
  'Math',
  'String',
  'console',
  chunk + '\n; return { shortDisplayUser: shortDisplayUser, isAnonymousAccountName: isAnonymousAccountName };'
);
var api = fn(sandbox, Math, String, console);
var shortDisplayUser = api.shortDisplayUser;
var isAnonymousAccountName = api.isAnonymousAccountName;

assert.strictEqual(isAnonymousAccountName('anon_amwk2a8nj29r3kaxny6'), true, 'anon_id is anonymous');
assert.strictEqual(isAnonymousAccountName('UkPakiUmayr29'), false, 'normal username not anonymous');
assert.strictEqual(isAnonymousAccountName('Anon_1234'), true, 'legacy Anon_ is anonymous');

assert.strictEqual(shortDisplayUser('UkPakiUmayr29'), 'UkPakiUmayr29', 'normal username unchanged');
assert.strictEqual(shortDisplayUser('@CoolUser'), 'CoolUser', 'strips @ but keeps normal name');
assert.strictEqual(shortDisplayUser('Anon_1234'), 'Sub1234', 'legacy Anon_#### → Sub####');
assert.strictEqual(shortDisplayUser('anon_1234'), 'Sub1234', 'anon_digits → Sub####');
assert.strictEqual(shortDisplayUser('guest'), 'Sub0', 'guest → Sub0');
assert.strictEqual(shortDisplayUser(''), 'Sub0', 'empty → Sub0');

var a = shortDisplayUser('anon_amwk2a8nj29r3kaxny6');
var b = shortDisplayUser('anon_amwk2a8nj29r3kaxny6');
assert(/^Sub\d+$/.test(a), 'long anon_id maps to SubN: ' + a);
assert.strictEqual(a, b, 'Sub assignment permanent for same anon id');

var other = shortDisplayUser('anon_zzzzzzzzzzzzzzzz');
assert(/^Sub\d+$/.test(other), 'other anon maps to SubN');
assert.notStrictEqual(a, other, 'different anon ids get different Sub numbers (usually)');

assert.strictEqual(shortDisplayUser('MasterSan'), 'MasterSan', 'registered-looking name unchanged');
assert.strictEqual(shortDisplayUser('some_normal_user'), 'some_normal_user', 'underscore normal name unchanged');

console.log('\nAnon Sub display checks passed');
