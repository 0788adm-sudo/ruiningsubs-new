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
assert(html.includes('Delete post — 50 FC ($5)'), 'Delete post UX copy');
assert(html.includes('Insufficient FC'), 'Insufficient FC UX');

// Backend
assert(spend.includes('FC_COSTS') && spend.includes('delete'), 'fc-spend API costs');
assert(spend.includes('idem') || spend.includes('idemKey') || spend.includes('reused'), 'fc-spend idempotency');
assert(game.includes('FC_ROULETTE') && game.includes('FC_DICE'), 'game-play costs');
assert(game.includes('free_per_day') || game.includes('BOARD_FREE'), '1 free/day tracking');
assert(game.includes('triki') || game.includes('tic_tac_toe'), 'triki session API');
assert(game.includes('__PIN_REWARDS__'), 'pin rewards board');
assert(fs.existsSync(path.join(root,'migrations','20261101_fc_games_hot.sql')), 'migration present');

// HOT ranking
assert(html.includes('isAdminHot') && html.includes('adminToggleHot'), 'Admin HOT toggle');
assert(html.includes('feedPrioritySort') || html.includes('adminHotBoost'), 'HOT feed priority');
assert(html.includes('postEngagementScore'), 'engagement ranking');

// Games UX
assert(html.includes('1 free spin left today') || html.includes('free spin left today'), 'roulette 1 free/day UI');
assert(html.includes('openCustomRouletteRequest'), 'custom 30-option request');
assert(html.includes('THRONE_CUSTOM_GAME') || html.includes('THRONE_PACK_25'), 'custom uses Throne $25');
assert(html.includes('getTrikiChallenge') && html.includes('max:3'), 'Triki max 3 games');
assert(html.includes('RETOS DISPONIBLES') && html.includes('Acepto este reto'), 'loss → challenges explicit accept');
assert(html.includes('grantTrikiPinReward') || html.includes('REWARD: publicación fijada'), '3 wins → pin reward');

// Video limits + carousel
assert(html.includes('limitMediaVideos') && html.includes('maxVideos'), 'max 2 videos helper');
assert(html.includes('goontokMedia') && html.includes('slice(0,2)'), 'GoonTok max 2 videos');
assert(html.includes('rotateHomeRandomStrip') && html.includes('__homeStripTimer'), 'hero auto carousel');
assert(html.includes('home-strip-card.is-fading'), 'smooth carousel fade');

// Admin
assert(html.includes('asec-games') && html.includes('loadAdminGames'), 'Admin games panel');
assert(html.includes('admin-triki-pins'), 'Admin Triki pin rewards');
assert(html.includes('data-del-ch'), 'Admin delete challenge');
assert(html.includes('/api/fc-spend') && html.includes('/api/game-play'), 'client calls spend/game APIs');

console.log('\nAll FC/HOT/games static checks passed');
