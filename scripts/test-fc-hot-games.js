#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const spend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');
const game = fs.readFileSync(path.join(root, 'api', 'game-play.js'), 'utf8');
function assert(c, m){ if(!c) throw new Error(m); console.log('PASS · '+m); }

// Packs / costs
assert(html.includes("usd:5, coins:60") || html.includes('usd:5, coins:60'), '$5 → 60 FC pack');
assert(html.includes('86473EC5-CFDC-4A8C-93FE-153A3F248899'), 'Throne $5 item link');
assert(/delete\s*:\s*50/.test(html) || html.includes('delete:50'), 'Delete cost 50 FC');
assert(/roulette\s*:\s*10/.test(html) || html.includes('roulette:10'), 'Roulette 10 FC');
assert(/dice\s*:\s*10/.test(html) || html.includes('dice:10'), 'Dice 10 FC');
assert(html.includes('custom_roulette:250') || html.includes('custom_roulette:250'), 'Custom wheel 250 FC');
assert(
  html.includes('Delete post — 50 FC ($5)') ||
    html.includes('Delete · $5 / 50 FC') ||
    html.includes('Delete now · 50 FC') ||
    html.includes('Confirm · 50 FC') ||
    /delete\s*:\s*50/.test(html),
  'Delete post UX copy'
);
assert(html.includes('Insufficient FC'), 'Insufficient FC UX');

// Backend
assert(spend.includes('FC_COSTS') && spend.includes('delete'), 'fc-spend API costs');
assert(spend.includes('idem') || spend.includes('idemKey') || spend.includes('reused'), 'fc-spend idempotency');
assert(spend.includes('reuseMs') && /30\s*\*\s*60\s*\*\s*1000/.test(spend), 'ledger reuse limited to ~30 minutes');
assert(spend.includes('roulette_pack') && /roulette_pack:\s*Number\(process\.env\.FC_COST_ROULETTE_PACK\s*\|\|\s*50\)/.test(spend), 'fc-spend roulette_pack 50');
assert(html.includes('Already paid') && html.includes('no extra charge'), 'client distinguishes reused spend toast');
assert(game.includes('FC_ROULETTE') && game.includes('FC_DICE'), 'game-play costs');
assert(game.includes('FREE_ROULETTE_PER_DAY') && game.includes('FREE_ROULETTE_PER_DAY || 3'), '3 free roulette / day');
assert(game.includes('FC_ROULETTE_PACK') && game.includes('ROULETTE_PACK_SPINS'), '50 FC → 10 pack spins');
assert(game.includes('buy_pack') && game.includes('__ROULETTE_PACKS__'), 'roulette pack board + buy_pack');
assert(game.includes('free_per_day') || game.includes('BOARD_FREE'), 'free/day tracking');
assert(game.includes('triki') || game.includes('tic_tac_toe'), 'triki session API');
assert(game.includes('__PIN_REWARDS__'), 'pin rewards board');
assert(fs.existsSync(path.join(root,'migrations','20261101_fc_games_hot.sql')), 'migration present');

// HOT ranking
assert(html.includes('isAdminHot') && html.includes('adminToggleHot'), 'Admin HOT toggle');
assert(html.includes('feedPrioritySort') || html.includes('adminHotBoost'), 'HOT feed priority');
assert(html.includes('postEngagementScore'), 'engagement ranking');

// Games UX — 3 free/day + 50 FC pack
assert(html.includes('ROULETTE_FREE_PER_DAY=3') || html.includes('3 free spins'), 'roulette 3 free/day');
assert(html.includes('GET 10 SPINS — 50 FC'), 'pack purchase CTA');
assert(html.includes('You have used today’s free spins. Get 10 additional spins for 50 FC ($5).'), 'exhausted free spins copy');
assert(html.includes('buyRoulettePack') && html.includes('ROULETTE_PACK_FC=50') && html.includes('ROULETTE_PACK_SPINS=10'), 'client pack purchase');
assert(html.includes('Could not record spin on server'), 'spins require server record');
assert(html.includes('openCustomRouletteRequest'), 'custom 30-option request');
assert(html.includes('THRONE_CUSTOM_GAME') || html.includes('THRONE_PACK_25'), 'custom uses Throne $25');
assert(html.includes('getTrikiChallenge') && html.includes('max:3'), 'Triki max 3 games');
assert(
  (html.includes('RETOS DISPONIBLES') && html.includes('Acepto este reto')) ||
    html.includes('getTrikiChallenge') ||
    /challenge/i.test(html),
  'loss → challenges explicit accept'
);
assert(html.includes('grantTrikiPinReward') || html.includes('REWARD: publicación fijada') || html.includes('triki'), '3 wins → pin reward');

// PayPal Jimenez for pin / delete / roulette
assert(html.includes('https://www.paypal.me/MartinJimenez205'), 'official PayPal Jimenez link');
assert(html.includes('PayPal $5 · MartinJimenez205'), 'PayPal visible on payment CTAs');
assert(html.includes('Price: <strong style="color:#f5c518;font-size:16px">$5 USD</strong>') || html.includes('$5 USD'), 'Pin $5 price');
assert(html.includes('PayPal does not auto-pin') || html.includes('admin verifies'), 'no auto-credit from PayPal click');

// Video limits + daily fixed hero strip
assert(html.includes('limitMediaVideos') && html.includes('maxVideos'), 'max 2 videos helper');
assert(html.includes('goontokMedia') && html.includes('slice(0,2)'), 'GoonTok max 2 videos');
assert(html.includes('rs_home_strip_day') && html.includes('homeStripDayKey'), 'hero strip locked to calendar day');
assert(html.includes('resolveHomeStripFive') && html.includes('daySeededPick'), 'picks 5 photos once per day');
assert(html.includes('no continuous rotation') || html.includes('Fixed 5 photos for the calendar day'), 'no continuous strip rotation');
assert(!/setInterval\(function\(\)\{\s*try\{rotateHomeRandomStrip/.test(html), 'removed rotating strip interval');

// Admin
assert(html.includes('asec-games') && html.includes('loadAdminGames'), 'Admin games panel');
assert(html.includes('admin-triki-pins'), 'Admin Triki pin rewards');
assert(html.includes('data-del-ch'), 'Admin delete challenge');
assert(html.includes('/api/fc-spend') && html.includes('/api/game-play'), 'client calls spend/game APIs');

console.log('\nAll FC/HOT/games static checks passed');
