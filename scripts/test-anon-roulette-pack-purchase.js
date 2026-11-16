#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var game = fs.readFileSync(path.join(root, 'api', 'game-play.js'), 'utf8');
var spend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');
var adminReq = fs.readFileSync(path.join(root, 'api', 'admin-request.js'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// —— Anonymous identity + publish ——
assert(html.includes('function ensureAnonIdentity'), 'ensureAnonIdentity');
assert(html.includes("action:'anon_identity'"), 'client anon_identity');
assert(game.includes('handleAnonIdentity'), 'server anon identity');
assert(game.includes('grantRoulettePack'), 'server grantRoulettePack helper');
assert(!/function buyRoulettePack\(\)\{[\s\S]{0,200}isRegistered\(\)/.test(html), 'buyRoulettePack no login gate');
assert(!/function requestRoulettePackPayPal\(\)\{[\s\S]{0,200}isRegistered\(\)/.test(html), 'PayPal pack no login gate');
assert(!/function checkRouletteUnlock[\s\S]{0,120}isRegistered\(\)/.test(html), 'checkRouletteUnlock no login gate');
assert(html.includes('claimRoulettePackPaid'), 'I PAID claim spins helper');
assert(html.includes('I PAID — CLAIM SPINS'), 'I PAID button visible');
assert(html.includes('BUY 10 EXTRA SPINS'), 'BUY 10 EXTRA SPINS button');
assert(html.includes('50 FC · $5 USD'), 'price line under buy button');
assert(html.includes('PAYMENT UNDER REVIEW'), 'under review banner');
assert(html.includes("openRouletteExternalPay('throne')") || html.includes('openRouletteExternalPay("throne")') || html.includes("openRouletteExternalPay('throne')"), 'Throne option');
assert(html.includes("openRouletteExternalPay('btc')") || html.includes('Bitcoin'), 'BTC option');
assert(html.includes('APPROVE PAYMENT'), 'admin approve label');
assert(html.includes('REJECT PAYMENT'), 'admin reject label');

// —— Backend pack for anonymous ——
assert(!/buy_pack[\s\S]{0,200}player\.anon\) return json\(res, 401/.test(game), 'buy_pack allows anon');
assert(game.includes("action === 'grant_pack'") || game.includes("action === 'approve_pack'"), 'admin grant_pack');
assert(game.includes("action === 'reject_pack'"), 'admin reject_pack');
assert(game.includes('verifyAdminToken'), 'grant_pack admin gated');
assert(/packBoard = \(game === 'roulette'\)/.test(game) || game.includes("packBoard = (game === 'roulette')"), 'pack spins for all users');
assert(game.includes("account_type: player.anon ? 'anonymous' : 'registered'") || game.includes("account_type: isAnonUser"), 'account type recorded');
assert(spend.includes('anonPart') || /anon_/.test(spend), 'fc-spend allows stable anon wallets');
assert(adminReq.includes('roulette_pack_request'), 'admin-request accepts roulette pack claims');

// —— No login prompts in spin exhausted path ——
assert(!/Free uses exhausted\. Wait 24h recovery or register to buy spins/.test(html), 'no register-to-buy message');
assert(html.includes('Get 10 additional spins for 50 FC ($5)'), 'exhausted message points to pack');

// —— Video / publish anon ——
assert(!/function openVideoComposer\(\)\{[\s\S]{0,160}Register to publish/.test(html), 'video composer no register gate');
assert(!/async function publishVideoPost\(\)\{[\s\S]{0,500}Register to publish/.test(html), 'publishVideoPost no register gate');
assert(html.includes('await ensureAnonIdentity(false)'), 'createPost/path awaits anon identity');

console.log('\nAnon + roulette pack purchase checks passed');
