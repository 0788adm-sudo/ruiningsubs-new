#!/usr/bin/env node
/**
 * Guards for games simplification: 3 games, lifetime free uses, anon play,
 * roulette-won pin badge, map XP, pin cleanup on delete, Daily Devotion.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var game = fs.readFileSync(path.join(root, 'api', 'game-play.js'), 'utf8');
var del = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// 1) Three live games only
assert(html.includes("allowedGames={roulette:1,dice:1,tic_tac_toe:1}"), 'hub allowlist = 3');
assert(html.includes("['roulette','dice','tic_tac_toe'].indexOf(id)<0"), 'openRegisteredGame allowlist = 3');
assert(/status:'disabled'[\s\S]{0,40}word_challenge|id:'word_challenge'[\s\S]{0,200}status:'disabled'/.test(html), 'word scramble disabled');
assert(html.includes('RUIN ROULETTE · EXPOSURE DICE · TIC-TAC-TOE'), 'promo three games');
assert(!html.includes('TIC-TAC-TOE · WORD SCRAMBLE · ROULETTE · DICE'), 'old four-game promo gone');

// 2) Lifetime free uses (not daily reset)
assert(game.includes('FREE_USES_PER_GAME'), 'server FREE_USES_PER_GAME');
assert(game.includes('__GAME_FREE_USES__'), 'lifetime free board');
assert(game.includes('countFreeUses'), 'lifetime free counter');
assert(!/function countFreeToday/.test(game), 'daily free counter removed');
assert(html.includes('GAME_FREE_USES=3') || html.includes('var GAME_FREE_USES=3'), 'client 3 free uses');
assert(html.includes('Free uses exhausted'), 'exhausted messaging');
assert(html.includes('rs_dice_lifetime_used'), 'dice lifetime local mirror');
assert(html.includes('Lifetime free uses — do not reset on date change') || html.includes('do not reset on date change'), 'roulette no daily reset');

// 3) Anonymous access
assert(html.includes('function getAnonSessionId'), 'anon session id');
assert(html.includes('Guest play · 3 free uses per game'), 'guest hub copy');
assert(game.includes('anon_no_rewards') || game.includes('player.anon'), 'server anon gates rewards');
assert(html.includes('openRegisteredGame') && !/function openRegisteredGame\(id\)\{\s*if\(!isRegistered\(\)\)/.test(html), 'games open not login-gated');

// 4) Roulette-won pin badge
assert(html.includes('🏆 Fijada ganada en la ruleta'), 'badge copy');
assert(html.includes('function isRouletteWonPin') && html.includes('function pinBadgeHtml'), 'badge helpers');
assert(html.includes('grantRoulettePinReward') && html.includes("action:'claim_pin'"), 'roulette pin claim');
assert(game.includes("source: 'roulette'") && game.includes('roulette_won'), 'server roulette pin provenance');
assert(html.includes('PINNED 48h') && html.includes('pin_prize'), 'roulette pin prize option');

// 5) Delete cleans pins
assert(del.includes('retirePinsForDeletedPost'), 'delete-post retires pins');
assert(del.includes('__PIN_BOARD__') && del.includes('__PIN_REWARDS__'), 'clears pin boards');
assert(del.includes('pin_invalidated'), 'invalidates reward records');
assert(html.includes('retirePinBoardNotifs(id)') && html.includes('rs_roulette_won_pins'), 'client purge clears won-pin map');

// 6) Map XP
assert(html.includes("map_pin:{xp:10,dailyCap:1,dedupe:'forever'}"), 'map_pin XP action forever');
assert(html.includes("grantXp('map_pin'") && html.includes('saveMapPin'), 'map grants XP on confirm only');
assert(html.includes('+10 XP'), 'map XP toast');

// 7) Daily Devotion preserved
assert(html.includes('claimDailyReward') && html.includes('Daily Devotion'), 'daily devotion kept');
assert(html.includes('dayN===3||dayN===5||dayN===7'), 'day 3/5/7 bonuses');
assert(html.includes('LOGIN TO CLAIM') || html.includes('Login first'), 'anon cannot claim devotion XP');

// 8) XP anti-dup
assert(html.includes('makeXpEventId') && html.includes('canGrantXp'), 'XP event ids + gate');
assert(html.includes("dedupe:'forever'"), 'forever dedupe for map/streak');

// 9) Payments untouched markers
assert(html.includes('paypal.me/MartinJimenez205') || html.includes('MartinJimenez205'), 'PayPal link intact');
assert(html.includes('throne.com/mastersan') || html.includes('THRONE_PACK'), 'Throne packs intact');

console.log('\nGames / XP / pins simplification checks passed');
