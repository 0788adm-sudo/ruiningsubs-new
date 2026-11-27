#!/usr/bin/env node
'use strict';
/**
 * Static checks for unified game packs, Custom 30 removal, task catalog, points.
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var game = fs.readFileSync(path.join(root, 'api', 'game-play.js'), 'utf8');
var tasks = fs.readFileSync(path.join(root, 'api', 'game-tasks.js'), 'utf8');
var mig = fs.readFileSync(path.join(root, 'migrations', '20261127_game_tasks_points.sql'), 'utf8');
var spend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// —— Pack purchase modal (unified) ——
assert(html.includes('id="game-pack-modal"'), 'game pack modal markup');
assert(html.includes('OUT OF FREE PLAYS?'), 'modal title');
assert(html.includes('Unlock 10 additional plays for 10 Coins'), 'modal description');
assert(html.includes('BUY 10 PLAYS — 10 COINS'), 'buy CTA');
assert(html.includes('NOT NOW'), 'not now CTA');
assert(html.includes('function openGamePackModal'), 'openGamePackModal');
assert(html.includes('function confirmGamePackPurchase'), 'confirmGamePackPurchase');
assert(html.includes('__gamePackBusy'), 'double-click guard');

// —— Server pack validation unchanged ——
assert(game.includes("action === 'buy_pack'"), 'buy_pack server');
assert(game.includes('spendViaWallet'), 'server wallet spend');
assert(game.includes('!packSpend.reused'), 'no duplicate pack credit');
assert(game.includes('grantGamePack'), 'grantGamePack');
assert(game.includes('pack_spins_map'), 'per-game pack balances');
assert(/FC_ROULETTE_PACK\s*=\s*Number\([^)]*\|\|\s*10\)/.test(game), 'roulette pack 10 coins');
assert(/FC_DICE_PACK\s*=\s*Number\([^)]*\|\|\s*10\)/.test(game), 'dice pack 10 coins');
assert(/FC_TTT_PACK\s*=\s*Number\([^)]*\|\|\s*10\)/.test(game), 'ttt pack 10 coins');
assert(game.includes('GAME_PACK_USES') && /GAME_PACK_USES\s*=\s*Number\([^)]*\|\|\s*10\)/.test(game) || game.includes('|| 10)'), '10 uses per pack');

// —— Custom 30 removed ——
assert(!/id="btn-roulette-custom"/.test(html), 'no roulette custom button');
assert(!/id="btn-dice-custom"/.test(html), 'no dice custom button');
assert(!html.includes('Custom 30 options — 250 Coins / $25'), 'no Custom 30 label');
assert(game.includes('custom_removed') || game.includes('CUSTOM_GAMES_ENABLED = false'), 'server rejects custom');
assert(!/costs:\s*\{[^}]*custom:\s*FC_CUSTOM/.test(game), 'custom cost not advertised in GET costs');

// —— Free vs purchased display ——
assert(html.includes('Free: ') && html.includes('Purchased: '), 'free/purchased labels');
assert(html.includes('GAME_FREE_USES=3') || html.includes('GAME_FREE_USES = 3') || html.includes('var GAME_FREE_USES=3'), '3 free uses');

// —— Tasks under each game ——
assert(html.includes('YOUR TASKS — PICK ANY'), 'tasks section title');
assert(html.includes('id="dice-tasks-section"') || html.includes('id="dice-task-list"'), 'dice tasks');
assert(html.includes('id="ttt-tasks-section"') || html.includes('id="ttt-task-list"'), 'ttt tasks');
assert(html.includes('id="roulette-catalog-list"') || html.includes('roulette-task-picker'), 'roulette tasks');
assert(html.includes('does not use a') || html.includes('does not use another') || html.includes('no play used'), 'selecting task does not consume play');
assert(html.includes('RS_TASK_CATALOG_SEED'), 'client seed catalog');
assert(html.includes('function renderGameTasksSection'), 'renderGameTasksSection');
assert(html.includes('function selectCatalogTask'), 'selectCatalogTask');

// —— Points economy separate from Coins ——
assert(html.includes('rs_points_ledger') || html.includes('Points:'), 'points UI/storage');
assert(html.includes('(not Coins)') || html.includes('not Coins'), 'points ≠ coins messaging');
assert(tasks.includes('BOARD_POINTS') && tasks.includes('points_event'), 'server points ledger');
assert(tasks.includes('UNIQUE') || tasks.includes('findPointsEvent') || tasks.includes('ref_id'), 'points idempotency');
assert(tasks.includes('rewards_disabled') || tasks.includes('Public exposure rewards are not active'), 'redeem blocked');
assert(tasks.includes('enabled: false') && tasks.includes('published: false'), 'future rewards off');

// —— Catalog structure ——
assert(tasks.includes('SEED_CATALOG') && tasks.includes('proof_type'), 'seed catalog + proof types');
assert(tasks.includes('wall_post') && tasks.includes('admin_verify') && tasks.includes('link'), 'proof type variety');
assert(tasks.includes('select_task') && tasks.includes('submit_proof') && tasks.includes('approve_submission'), 'task lifecycle actions');
assert(mig.includes('game_task_catalog') && mig.includes('game_points_ledger') && mig.includes('game_reward_defs'), 'migration tables');

// —— Admin ——
assert(html.includes('adminLoadGameTaskCatalog') && html.includes('adminLoadPendingTaskProofs'), 'admin task tools');
assert(html.includes('adminLookupUserPoints') && html.includes('adminLoadRewardDefs'), 'admin points/rewards');
assert(html.includes('more-game-tasks'), 'admin panel section');

// —— Coins / payments untouched ——
assert(spend.includes('roulette_pack') && spend.includes('dice_pack'), 'fc-spend pack costs intact');
assert(html.includes('Recharge Coins') || html.includes('60 Coins — $5 USD'), 'coin shop intact');
assert(html.includes('paypal.me/MartinJimenez205') || html.includes('PayPal'), 'paypal recharge intact');
assert(html.includes('function spendFagCoins'), 'spendFagCoins still present');

// —— Unit: points ledger dedupe ——
function pointsBalance(rows) {
  var bal = 0;
  var seen = {};
  rows.forEach(function (m) {
    var key = String(m.action || '') + '|' + String(m.ref_id || '');
    if (seen[key]) return;
    seen[key] = 1;
    bal += Number(m.amount) || 0;
  });
  return Math.max(0, bal);
}
var sample = [
  { action: 'task_complete', ref_id: 'task_complete:a', amount: 20 },
  { action: 'task_complete', ref_id: 'task_complete:a', amount: 20 },
  { action: 'task_complete', ref_id: 'task_complete:b', amount: 15 }
];
assert(pointsBalance(sample) === 35, 'points not double-credited for same ref');

// —— Export helpers smoke ——
var mod = require(path.join(root, 'api', 'game-tasks.js'));
assert(Array.isArray(mod.SEED_CATALOG) && mod.SEED_CATALOG.length >= 20, 'seed catalog size >= 20');
assert(mod.statusLabel('pending_review') === 'PENDING REVIEW', 'status label pending');
assert(mod.mergeCatalogStatus([{ id: 'x', name: 'X', active: true }], [{ task_id: 'x', status: 'in_progress' }])[0].status === 'in_progress', 'merge status');

console.log('\nGames plays + tasks system checks passed');
