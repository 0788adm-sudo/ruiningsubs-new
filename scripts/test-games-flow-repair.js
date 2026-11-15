#!/usr/bin/env node
/**
 * Static checks for games flow repair: immediate spin/dice animation,
 * Accept → Wall publish, challenge completion on publish.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes('function startRouletteTeaser'), 'roulette teaser starts immediately');
assert(html.includes('function settleRouletteOnIndex'), 'roulette settles on server index');
assert(html.includes('startRouletteTeaser()'), 'spinRoulette calls teaser');
assert(html.includes('settleRouletteOnIndex(idx'), 'spinRoulette settles on idx');
assert(html.includes("el.classList.add('spin')"), 'dice adds spin class');
assert(html.includes('__diceTickIv'), 'dice teaser interval before API');
assert(html.includes('function applyPendingComposerPrefill'), 'composer prefill helper');
assert(html.includes('__pendingComposerPrefill'), 'pending composer prefill used');
assert(html.includes('if(window.__pendingComposerPrefill)'), 'composer does not wipe game prefill');
assert(html.includes('function openChallengeWallPublish'), 'challenge Wall publish opener');
assert(html.includes('function completeChallengeFromPublish'), 'challenge complete on publish');
assert(html.includes('completeChallengeFromPublish(row'), 'publish success marks challenge done');
assert(html.includes("id=\"ch-publish-wall\"") || html.includes("id='ch-publish-wall'") || html.includes('ch-publish-wall'), 'Accept & publish proof button in challenge detail');
assert(html.includes("ch.validate==='video'") || html.includes("v==='video'"), 'video challenge validation');
assert(html.includes("seenSpawn[openId]"), 'spawned hub skips composite keys');
assert(html.includes("window.__pendingChallengePublish"), 'pending challenge publish state');
assert(html.includes("openChallengeWallPublish"), 'TTT/defeat can open Wall publish');
assert(html.includes("btn.disabled=!!rouletteSpinning"), 'spin button disabled while spinning');
assert(html.includes("roll.disabled=!!window.__diceRolling"), 'dice button disabled while rolling');

console.log('\nGames flow repair checks passed');
