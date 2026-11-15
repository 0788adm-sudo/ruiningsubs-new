#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes('function assignGameTask'), 'central assignGameTask');
assert(html.includes('function acceptGameTask'), 'central acceptGameTask');
assert(html.includes('function completeGameTask'), 'central completeGameTask');
assert(html.includes('function openGameTaskPublish'), 'central openGameTaskPublish');
assert(html.includes('function forceWallProofComposer'), 'force Wall proof composer');
assert(html.includes("rs_game_tasks"), 'persists tasks in localStorage');
assert(html.includes('PENDING GAME TASKS'), 'hub recovers pending tasks');
assert(html.includes('data-open-task'), 'hub open-task buttons');
assert(!/retosHtml=result==='loss'\?showTrikiRetosSection/.test(html), 'TTT loss no longer dumps challenge catalog');
assert(html.includes('ttt-publish-proof'), 'TTT loss has Publish proof button');
assert(html.includes("label:'🎡 Roulette'") || html.includes('🎡 Roulette'), 'roulette badge label');
assert(html.includes("label:'🎲 Exposure Dice'") || html.includes('🎲 Exposure Dice'), 'dice badge label');
assert(html.includes("label:'🎮 Tic-Tac-Toe'") || html.includes('🎮 Tic-Tac-Toe'), 'ttt badge label');
assert(html.includes("label:'👑 Challenges'") || html.includes('👑 Challenges'), 'challenges badge');
assert(html.includes('game_origin:'), 'stores game_origin in tags');
assert(html.includes('keepFields'), 'Wall mode keeps game prefill fields');
assert(html.includes('forceWallProofComposer()'), 'nav uses Wall for pending proofs');
assert(html.includes('completeGameTask(tid'), 'publish completes game task');
assert(!html.includes("setExposurePostMode()}catch(e2){}\n        showPanel('post');"), 'dice no longer falls back to Exposure');

console.log('\nGame tasks unify checks passed');
