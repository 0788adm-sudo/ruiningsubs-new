#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var game = fs.readFileSync(path.join(root, 'api', 'game-play.js'), 'utf8');
var spend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

assert(/FREE_ROULETTE_PER_DAY\s*=\s*Number\([^)]*\|\|\s*3\)/.test(game), 'server free spins = 3');
assert(/ROULETTE_PACK_SPINS\s*=\s*Number\([^)]*\|\|\s*10\)/.test(game), 'server pack = 10 spins');
assert(/FC_ROULETTE_PACK\s*=\s*Number\([^)]*\|\|\s*50\)/.test(game), 'server pack cost = 50 FC');
assert(game.includes("action === 'buy_pack'") && game.includes('!packSpend.reused'), 'buy_pack skips duplicate pack credit');
assert(game.includes('kind: \'pack_spin\'') && game.includes('roulettePackBalance'), 'pack spins consumed server-side');
assert(spend.includes('roulette_pack: Number(process.env.FC_COST_ROULETTE_PACK || 50)'), 'fc-spend roulette_pack cost');

assert(html.includes('var ROULETTE_FREE_PER_DAY=3'), 'client free = 3');
assert(html.includes('var ROULETTE_PACK_SPINS=10') && html.includes('var ROULETTE_PACK_FC=50'), 'client pack constants');
assert(html.includes('lastRoulettePlayId') && html.includes('rs_roulette_last_challenge'), 'spin ↔ challenge association');
assert(html.includes('rs_roulette_published') && html.includes('__pendingRoulettePublish'), 'duplicate publish guard');
assert(html.includes("tagsEl.value = 'roulette, roulette_task"), 'publish tags roulette category');
assert(html.includes("setWallFilter('roulette')"), 'after publish jump to Roulette feed');
assert(html.includes('roulette-wall-badge') && html.includes('🎲 Roulette'), 'Roulette badge on cards');
assert(html.includes('wallSortMode') && html.includes('rs_wall_sort_'), 'independent per-category sort memory');
assert(html.includes('(Number(b.created)||0)-(Number(a.created)||0)'), 'Most Recent = created DESC');
assert(html.includes('PayPal $5 · MartinJimenez205'), 'visible PayPal Jimenez CTAs');
assert(html.includes("amount:'$5'") && html.includes('PREMIUM PIN'), 'Pin request is $5');
assert(html.includes('Paid delete ·') && html.includes('paypal.me/MartinJimenez205/5'), 'Delete PayPal $5');
assert(html.includes('requestRoulettePackPayPal') && html.includes('roulette_pack_request'), 'Roulette PayPal pending approval');
assert(html.includes('does <strong style="color:#fff">not</strong> auto-credit') || html.includes('does not auto-pin'), 'no auto-grant messaging');

console.log('\nRoulette / Wall / payments checks passed');
