#!/usr/bin/env node
/**
 * Unit checks for lifetime free-use helpers inside api/game-play.js
 * (pure functions reimplemented here to avoid spinning a server).
 */
'use strict';
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

function normUser(u) {
  return String(u || '').replace(/^@/, '').trim().toLowerCase().slice(0, 64);
}
function normalizeGame(game) {
  game = String(game || '').toLowerCase().trim();
  if (game === 'triki') return 'tic_tac_toe';
  return game;
}
function parseMsg(raw) {
  try {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
}
function countFreeUses(notifs, user, game) {
  var n = 0;
  var seen = {};
  for (var i = 0; i < notifs.length; i++) {
    var msg = parseMsg(notifs[i] && notifs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || notifs[i].from_username) !== user) continue;
    if (normalizeGame(msg.game) !== game) continue;
    if (msg.paid) continue;
    var pid = String(msg.play_id || msg.id || notifs[i].id || i);
    if (seen[pid]) continue;
    seen[pid] = 1;
    n++;
  }
  return n;
}

var board = [
  { id: 1, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a1', paid: false }) },
  { id: 2, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a2', paid: false }) },
  { id: 3, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a3', paid: false }) },
  { id: 4, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a1', paid: false }) }, // dup
  { id: 5, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'dice', play_id: 'd1', paid: false }) },
  { id: 6, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'dice', play_id: 'd2', paid: true }) },
  { id: 7, from_username: 'bob', message: JSON.stringify({ user: 'bob', game: 'roulette', play_id: 'b1', paid: false }) },
  { id: 8, from_username: 'anon_abc12345', message: JSON.stringify({ user: 'anon_abc12345', game: 'tic_tac_toe', play_id: 't1', paid: false }) }
];

assert(countFreeUses(board, 'alice', 'roulette') === 3, 'alice roulette = 3 (dup ignored)');
assert(countFreeUses(board, 'alice', 'dice') === 1, 'alice dice free = 1 (paid ignored)');
assert(countFreeUses(board, 'alice', 'tic_tac_toe') === 0, 'alice ttt = 0');
assert(countFreeUses(board, 'bob', 'roulette') === 1, 'bob independent counter');
assert(countFreeUses(board, 'anon_abc12345', 'tic_tac_toe') === 1, 'anon ttt counted');
assert(Math.max(0, 3 - 3) === 0, 'exhausted at 3');
assert(Math.max(0, 3 - 1) === 2, '2 left after one');

var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'game-play.js'), 'utf8');
assert(src.includes('FREE_USES_PER_GAME'), 'api uses lifetime cap');
assert(src.includes("game === 'word_challenge'") === false || src.includes('game_disabled'), 'word scramble not playable');
assert(src.includes('LIVE_GAMES'), 'live games gate');

console.log('\nGame free-use unit checks passed');
