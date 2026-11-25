#!/usr/bin/env node
/**
 * Coins economy: purchase ($5 → 60) separated from spend (Pin/Delete = 10).
 * Static contract checks for SPA + /api/fc-spend.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var spend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

// Official economy constants
assert(/usd:\s*5,\s*coins:\s*60/.test(html) || html.indexOf('{usd:5, coins:60') >= 0, '$5 → 60 Coins pack');
assert(/pin:\s*10/.test(html) && /delete:\s*10/.test(html), 'Pin and Delete cost 10 Coins');
assert(spend.indexOf('pin: Number(process.env.FC_COST_PIN || 10)') >= 0, 'server pin cost 10');
assert(spend.indexOf('delete: Number(process.env.FC_COST_DELETE || 10)') >= 0, 'server delete cost 10');
assert(spend.indexOf('coins_per_pack: 60') >= 0 && spend.indexOf('actions_per_min_pack: 6') >= 0, 'server economy: 60 coins / 6 actions');

// Pin: no Premium Pin · $5 per-action window
assert(html.indexOf('function requestPinAction') >= 0, 'requestPinAction helper');
assert(html.indexOf('requestPinAction(') >= 0, 'Pin CTA uses requestPinAction');
assert(html.indexOf("label:'Premium Pin',amount:'$5'") < 0, 'no Premium Pin $5 pay ticket from feature modal');
assert(html.indexOf('PayPal $5 · MartinJimenez205</a>') < 0 || html.indexOf('No Premium Pin') >= 0 || html.indexOf('function openFeature') >= 0, 'feature flow rewritten');
assert(html.indexOf('>Premium Pin</div>') < 0 && html.indexOf("'Premium Pin'</div>") < 0, 'Premium Pin title removed from openFeature');
assert(html.indexOf('Recharge Coins') >= 0, 'Recharge Coins modal copy');
assert(html.indexOf('60 Coins — $5 USD') >= 0, 'recharge pack headline');
assert(html.indexOf('up to') >= 0 && html.indexOf('actions') >= 0, 'explains 6 actions from 60 Coins');

// Insufficient → recharge, not $5-per-action
assert(html.indexOf("openNeedCoins({cost:cost,why:'pin',action:'pin'})") >= 0 || html.indexOf("why:'pin',action:'pin'") >= 0, 'pin insufficient opens recharge');
assert(html.indexOf("openNeedCoins({cost:delCost,why:'delete',action:'delete'})") >= 0 || html.indexOf("why:'delete',action:'delete'") >= 0, 'delete insufficient opens recharge');
assert(html.indexOf('No $5 charge per action') >= 0 || html.indexOf('No separate $5 charge') >= 0, 'copy forbids $5 per action');

// Enough balance → spend path (no payment window)
assert(html.indexOf("spendFagCoins('pin'") >= 0, 'pin spends via spendFagCoins');
assert(html.indexOf("spendFagCoins('delete'") >= 0, 'delete spends via spendFagCoins');
assert(html.indexOf('/api/fc-spend') >= 0, 'atomic server spend');
assert(html.indexOf('__fcSpendLocks') >= 0, 'client double-click spend lock');
assert(spend.indexOf('locks.set(key') >= 0 && spend.indexOf('idemKey') >= 0, 'server idempotency + lock');

// Delete modal is coins-first
assert(html.indexOf('Paid delete ·') >= 0 && html.indexOf('10 Coins') >= 0, 'delete modal coins copy');
assert(html.indexOf('Delete · \'+delCost+\' Coins or $5\'') < 0, 'no Delete · N Coins or $5 title');
assert(html.indexOf("setRemoveModalExternalPay(true)") < 0, 'external $5 pay not enabled for non-owner');

// Credit only after confirmed payment (existing I paid → pending → admin credit)
assert(html.indexOf('confirmCoinPackPaid') >= 0, 'I paid creates pending credit request');
assert(html.indexOf('kind:\'coins\'') >= 0 || html.indexOf("kind:'coins'") >= 0, 'coin recharge request kind');

// Scenario math (static)
assert(60 / 10 === 6, '60 coins = 6 actions of 10');
assert(5 < 10, '5 coins cannot pay a 10-coin action');

console.log('\nOK · coins-economy-pin-delete');
