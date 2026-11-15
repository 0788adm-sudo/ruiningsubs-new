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

// --- Feed gender filters ---
assert(html.includes('function setFeedGenderFilter'), 'setFeedGenderFilter helper');
assert(html.includes('function matchesFeedGender'), 'matchesFeedGender helper');
assert(html.includes('function syncFeedGenderUi'), 'syncFeedGenderUi helper');
assert(/#feed-gender-row\{[\s\S]*display:flex!important/.test(html), 'gender row always visible');
assert(/#btn-gender-toggle\{display:none!important\}/.test(html), 'legacy toggle hidden');
assert(html.includes("filter==='other') return g==='other' || !g"), 'Other includes untagged posts');
assert(html.includes('matchesFeedGender(p, feedGenderFilter)'), 'renderPosts uses matchesFeedGender');
assert(html.includes('.gender-filter,#feed-gender-filter'), 'fast-tap ignores gender chips');
assert(!/row\.style\.display='none'/.test(html.match(/function setupGenderPickers[\s\S]*?function setupFeedSearch/)[0]), 'setupGenderPickers no longer hides the row');

// --- Removed daily challenges ---
assert(/id:'exp_presence'[\s\S]*?hidden:true/.test(html), 'PRESENCIA hidden');
assert(/id:'pro_check'[\s\S]*?hidden:true/.test(html), 'PRUEBA DE PERFIL hidden');
assert(/id:'pro_avatar'[\s\S]*?hidden:true/.test(html), 'AVATAR hidden');
assert(/id:'com_encourage'[\s\S]*?hidden:true/.test(html), 'ÁNIMO hidden');
assert(html.includes("RS_CHALLENGE_SET_VER='2026-11-06-drop4'"), 'challenge set remint version');
assert(html.includes('RS_REMOVED_DAILY_IDS'), 'removed daily id map');
assert(html.includes("bannedDaily={exp_presence:1,pro_check:1,pro_avatar:1,com_encourage:1"), 'computeDaily bans retired ids');

// --- Exactly three live games (word scramble kept disabled for history) ---
var reg = html.match(/var RS_GAME_REGISTRY=\[([\s\S]*?)\];/);
assert(!!reg, 'RS_GAME_REGISTRY present');
var liveIds = [];
reg[1].split(/\{id:'/).slice(1).forEach(function (chunk) {
  var id = chunk.slice(0, chunk.indexOf("'"));
  if (/status:'live'/.test(chunk.split(/\},?\s*\{id:|\}]$/)[0] || chunk)) liveIds.push(id);
  else if (chunk.indexOf("status:'live'") >= 0 && chunk.indexOf("status:'disabled'") < 0) liveIds.push(id);
});
// Simpler: parse each object
var objs = reg[1].match(/\{id:'[^']+'[\s\S]*?status:'[^']+'/g) || [];
var live = objs.filter(function (o) { return /status:'live'/.test(o); }).map(function (o) {
  return (o.match(/id:'([^']+)'/) || [])[1];
});
assert(live.length === 3, 'exactly 3 live games, got ' + live.join(','));
['roulette', 'dice', 'tic_tac_toe'].forEach(function (id) {
  assert(live.indexOf(id) >= 0, 'live registry includes ' + id);
});
assert(html.includes("allowedGames={roulette:1,dice:1,tic_tac_toe:1}"), 'hub filters to three games');
assert(html.includes("['roulette','dice','tic_tac_toe'].indexOf(id)<0"), 'openRegisteredGame blocks other ids');
assert(html.includes('RUIN ROULETTE · EXPOSURE DICE · TIC-TAC-TOE'), 'promo lists three games');
assert(!/id:'memory'/.test(html) && !/id:'reaction'/.test(html), 'legacy mini-game stay removed');
assert(html.includes("if(!isRegistered()){toast('Login first');showAuth('login');return}") === false || html.includes('Guest play'), 'games hub allows guests');
assert(html.includes('getAnonSessionId'), 'anonymous session helper');
assert(html.includes('GAME_FREE_USES=3') || html.includes('var GAME_FREE_USES=3'), '3 free uses constant');

console.log('\nFeed filters + challenges + games checks passed');
