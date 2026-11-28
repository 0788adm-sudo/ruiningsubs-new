#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// Wall Tasks unifies game proofs without a new post system
assert(html.includes('function isGameTaskWallPost'), 'isGameTaskWallPost detector');
assert(html.includes("origin==='roulette'||origin==='dice'||origin==='tic_tac_toe'"), 'Tasks covers 3 games');
assert(html.includes("filter==='tasks'"), 'Tasks filter branch');
assert(html.includes("if(typeof isGameTaskWallPost==='function'&&isGameTaskWallPost(p)) return false"), 'Tasks exclusive — no duplicates');
assert(html.includes("if(f==='roulette') f='tasks'"), 'legacy roulette filter migrates to tasks');
assert(html.includes('game_origin:') && html.includes('buildGameProofTags'), 'reuses existing game publish tags');

// Pin dual pay aligned with Delete
assert(html.includes('id="pin-modal"') && html.includes('id="remove-modal"'), 'both pin and delete modals');
assert(html.includes('function openPinModal') && html.includes('function openRemove'), 'open helpers');
assert(html.includes('pinWithCoinsFromModal') && html.includes('paintPinCoinsPayButton'), 'pin coins CTA helpers');
assert(html.includes("amount:'$5'") && html.includes("kind:'pin_payment_request'"), 'pin external $5 request');
assert(!html.includes('btn-pin-btc'), 'PIN does not add Bitcoin as a new method');
assert(html.includes('btn-remove-btc'), 'DELETE keeps existing Bitcoin option');
assert(html.includes("'pin-modal'") && html.includes('closeModals'), 'closeModals closes pin modal');

// Recharge panel redesign still keeps economy + methods
assert(html.includes('Recharge Coins'), 'recharge title');
assert(html.includes('id="coin-need"'), 'need-coins banner in panel');
assert(html.includes('{usd:5, coins:60') || /usd:\s*5,\s*coins:\s*60/.test(html), '$5 → 60 intact');
assert(html.includes('{usd:10, coins:110') || /usd:\s*10,\s*coins:\s*110/.test(html), '$10 → 110 intact');
assert(html.includes('{usd:25, coins:300') || /usd:\s*25,\s*coins:\s*300/.test(html), '$25 → 300 intact');
assert(html.includes('{usd:50, coins:600') || /usd:\s*50,\s*coins:\s*600/.test(html), '$50 → 600 intact');
assert(html.includes('coins-lux-pay.throne') && html.includes('coins-lux-pay.paypal'), 'Throne + PayPal pack buttons');
assert(html.includes('confirmCoinPackPaid'), 'I paid pack confirmation');
assert(html.includes('Pending until Master confirms') || html.includes('Pending credit'), 'pending credit copy');

console.log('\nWall Tasks + Pin dual-pay + Recharge checks passed');
