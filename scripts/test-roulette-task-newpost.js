#!/usr/bin/env node
'use strict';
/**
 * Static checks: Ruin Roulette task picker ↔ New Post integration.
 * Does not alter spin economy — only navigation / selection / prefill / back.
 */
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes('id="roulette-task-picker"'), 'roulette task picker container');
assert(html.includes('id="roulette-task-list"'), 'roulette task list');
assert(html.includes('function pendingRouletteTasks'), 'pendingRouletteTasks helper');
assert(html.includes('function selectRouletteTask'), 'selectRouletteTask opens selected task');
assert(html.includes('function renderRouletteTaskPicker'), 'renderRouletteTaskPicker UI');
assert(html.includes('function restoreRouletteChallengeUI'), 'restoreRouletteChallengeUI keeps result');
assert(html.includes('function backFromGameComposer'), 'backFromGameComposer returns to game');
assert(html.includes('function updatePostPanelBackBtn'), 'updatePostPanelBackBtn shows ←');
assert(html.includes('id="btn-post-back"'), 'New Post back button in panel header');
assert(html.includes("openRoulette({restore:true})"), 'back restores roulette context');
assert(html.includes("window.__composerReturn"), 'composer return context');
assert(html.includes('rs_composer_return'), 'persists composer return in localStorage');
assert(html.includes('data-roulette-task'), 'task buttons are interactive');
assert(html.includes('Choosing a task does not use another spin'), 'UX copy: select ≠ spin');
assert(html.includes('permanent:!!(task.permanent||delTier===\'permanent\')') || html.includes("permanent:!!(task.permanent||delTier==='permanent')"), 'pending publish keeps permanent flag');
assert(html.includes('free_delete:!!(task.free_delete||delTier===\'deletable\')') || html.includes("free_delete:!!(task.free_delete||delTier==='deletable')"), 'pending publish keeps free_delete flag');
assert(html.includes('deletion_tier:delTier||'), 'pending publish keeps deletion_tier');
assert(html.includes('permanent:!!opt.permanent'), 'last challenge persists permanent');
assert(html.includes('free_delete:!!opt.free_delete'), 'last challenge persists free_delete');
assert(html.includes('try{renderRouletteTaskPicker()}catch(e){}'), 'spin settle refreshes task picker');
assert(html.includes('if(rouletteSpinning)'), 'openRoulette only hides result while spinning');
assert(html.includes('restoreRouletteChallengeUI()'), 'openRoulette restores challenge UI');
assert(html.includes('GAME_FREE_USES=3'), 'keeps 3 free spins');
assert(html.includes('GAME_FREE_RECOVERY_MS=24*60*60*1000'), 'keeps 24h recovery');
assert(html.includes('function assignGameTask'), 'reuses central assignGameTask');
assert(html.includes('function openGameTaskPublish'), 'reuses openGameTaskPublish');
assert(html.includes('completeGameTask(tid'), 'publish still completes task');
assert(!/function spinRoulette[\s\S]{0,200}selectRouletteTask/.test(html), 'select path is separate from spinRoulette definition start');
assert(html.includes('Selecting a task never consumes a spin'), 'comment documents no spin on select');

console.log('\nRoulette task ↔ New Post integration checks passed');
