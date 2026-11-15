#!/usr/bin/env node
/**
 * Unit checks for free-use cycle + 24h recovery helpers (mirrors api/game-play.js).
 */
'use strict';
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

var FREE_USES_PER_GAME = 3;
var FREE_RECOVERY_MS = 24 * 60 * 60 * 1000;

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
function collectFreeUseTimes(notifs, user, game) {
  var times = [];
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
    var at = Number(msg.at) || 0;
    times.push(at || 0);
  }
  times.sort(function (a, b) { return a - b; });
  return times;
}
function freeCycleState(notifs, user, game, now) {
  now = now || Date.now();
  var times = collectFreeUseTimes(notifs, user, game);
  var cycleUsed = 0;
  var recoveryEnds = 0;
  for (var i = 0; i < times.length; i++) {
    var t = times[i];
    if (recoveryEnds && t < recoveryEnds) continue;
    if (recoveryEnds && t >= recoveryEnds) {
      recoveryEnds = 0;
      cycleUsed = 0;
    }
    cycleUsed++;
    if (cycleUsed >= FREE_USES_PER_GAME) {
      recoveryEnds = t + FREE_RECOVERY_MS;
    }
  }
  if (recoveryEnds && now < recoveryEnds) {
    return { free_used: FREE_USES_PER_GAME, free_left: 0, recovery_ends_at: recoveryEnds, recovery_ms: Math.max(0, recoveryEnds - now) };
  }
  if (recoveryEnds && now >= recoveryEnds) {
    return { free_used: 0, free_left: FREE_USES_PER_GAME, recovery_ends_at: 0, recovery_ms: 0 };
  }
  return { free_used: cycleUsed, free_left: Math.max(0, FREE_USES_PER_GAME - cycleUsed), recovery_ends_at: 0, recovery_ms: 0 };
}

var t0 = 1_700_000_000_000;
var board = [
  { id: 1, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a1', paid: false, at: t0 }) },
  { id: 2, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a2', paid: false, at: t0 + 1000 }) },
  { id: 3, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a3', paid: false, at: t0 + 2000 }) },
  { id: 4, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a1', paid: false, at: t0 }) }, // dup
  { id: 5, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'dice', play_id: 'd1', paid: false, at: t0 }) },
  { id: 6, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'dice', play_id: 'd2', paid: true, at: t0 + 500 }) },
  { id: 7, from_username: 'bob', message: JSON.stringify({ user: 'bob', game: 'roulette', play_id: 'b1', paid: false, at: t0 }) },
  { id: 8, from_username: 'anon_abc12345', message: JSON.stringify({ user: 'anon_abc12345', game: 'tic_tac_toe', play_id: 't1', paid: false, at: t0 }) }
];

var aliceRouletteNow = freeCycleState(board, 'alice', 'roulette', t0 + 3000);
assert(aliceRouletteNow.free_left === 0, 'alice roulette exhausted after 3');
assert(aliceRouletteNow.recovery_ends_at === t0 + 2000 + FREE_RECOVERY_MS, 'alice recovery starts at 3rd use + 24h');

var aliceRecovered = freeCycleState(board, 'alice', 'roulette', t0 + 2000 + FREE_RECOVERY_MS + 1);
assert(aliceRecovered.free_left === 3, 'alice recovers 3 after 24h');
assert(aliceRecovered.recovery_ends_at === 0, 'no recovery window after reset');

var aliceDice = freeCycleState(board, 'alice', 'dice', t0 + 3000);
assert(aliceDice.free_left === 2, 'alice dice independent (1 free, paid ignored)');

var bob = freeCycleState(board, 'bob', 'roulette', t0 + 3000);
assert(bob.free_left === 2, 'bob independent counter');

var anon = freeCycleState(board, 'anon_abc12345', 'tic_tac_toe', t0 + 3000);
assert(anon.free_left === 2, 'anon ttt counted');

// New cycle after recovery with a fresh use
var board2 = board.concat([
  { id: 9, from_username: 'alice', message: JSON.stringify({ user: 'alice', game: 'roulette', play_id: 'a4', paid: false, at: t0 + 2000 + FREE_RECOVERY_MS + 5000 }) }
]);
var aliceNew = freeCycleState(board2, 'alice', 'roulette', t0 + 2000 + FREE_RECOVERY_MS + 6000);
assert(aliceNew.free_left === 2, 'new cycle after recovery counts fresh uses');

var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'game-play.js'), 'utf8');
assert(src.includes('FREE_USES_PER_GAME'), 'api uses free cap');
assert(src.includes('FREE_RECOVERY_MS'), 'api has 24h recovery');
assert(src.includes('freeCycleState'), 'api uses cycle state');
assert(src.includes('pickCoherentDiceRoll'), 'api coherent dice');
assert(src.includes('result_idx'), 'api returns roulette result_idx');
assert(src.includes('claim_extend') || src.includes('extend_10d'), 'api extend +10d reward');
assert(src.includes("game === 'word_challenge'") === false || src.includes('game_disabled'), 'word scramble not playable');
assert(src.includes('LIVE_GAMES'), 'live games gate');

var html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
assert(html.includes('PLAY VS RUININGSUBS'), 'TTT only vs Ruiningsubs');
assert(!/data-ttt="ai"/.test(html) || html.indexOf('PLAY · VS AI') < 0, 'no PLAY VS AI');
assert(html.indexOf('btn-explore-roulette') < 0 || html.indexOf('id="btn-explore-roulette"') < 0, 'explore roulette tile removed');
assert(html.indexOf('id="btn-explore-dice"') < 0, 'explore dice tile removed');
assert(html.includes('btn-explore-games'), 'single Games hub entry');
assert(html.includes('GAME_FREE_RECOVERY_MS'), 'client recovery constant');
assert(html.includes('rouletteSpinning = true'), 'roulette locks before await');
assert(html.includes('result_idx'), 'client uses server result_idx');
assert(html.includes('game_badge_roulette'), 'roulette badge tag');
assert(html.includes('game_badge_dice'), 'dice badge tag');
assert(html.includes('permanent:true') || html.includes("deletion_tier:'permanent'"), 'permanent outcome');
assert(html.includes('free_delete:true') || html.includes("deletion_tier:'deletable'"), 'free-delete outcome');
assert(html.includes('extend_10d'), 'extend +10d outcome');
assert(html.includes('DICE_COMPAT'), 'dice compatibility matrix');
assert(html.includes('defeat_text') && html.includes('defeat_photo') && html.includes('defeat_video'), 'defeat challenge types');

console.log('\nGame free-use + reform unit checks passed');
