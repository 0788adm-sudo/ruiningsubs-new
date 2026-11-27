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

assert(html.includes('function registerProgressivePlayTask'), 'registerProgressivePlayTask');
assert(html.includes('function renderProgressiveTasks'), 'renderProgressiveTasks');
assert(html.includes('function selectProgressiveTask'), 'selectProgressiveTask');
assert(html.includes('PROGRESSIVE_TASK_MAX=3') || html.includes('PROGRESSIVE_TASK_MAX = 3'), 'max 3 tasks');
assert(html.includes('rs_progressive_play_tasks'), 'persists progressive tasks');
assert(html.includes("registerProgressivePlayTask('dice'") || html.includes('registerProgressivePlayTask("dice"') || html.includes("registerProgressivePlayTask('dice', playId"), 'dice registers progressive task');
assert(html.includes("registerProgressivePlayTask('roulette'") || html.includes('registerProgressivePlayTask("roulette"'), 'roulette registers progressive task');
assert(html.includes('Each spin unlocks one challenge') || html.includes('max 3'), 'roulette progressive copy');
assert(html.includes('Each roll unlocks one challenge') || html.includes('dice-tasks-section'), 'dice progressive copy');
assert(html.includes("if(game==='roulette'||game==='dice')"), 'catalog hidden for roulette/dice render');
assert(html.includes('roulette-catalog-list') && html.includes('display:none'), 'catalog list hidden in roulette UI');
assert(html.includes('Selecting never consumes a play') || html.includes('does not use another spin') || html.includes('does not use a dice roll'), 'select does not consume play');
assert(!/registerProgressivePlayTask\('tic_tac_toe'/.test(html), 'ttt not forced into progressive roulette/dice system');

// Unit: progressive cap / dedupe logic mirror
var MAX = 3;
function append(list, playId) {
  if (list.some(function (e) { return e.playId === playId; })) return { list: list, added: false, reused: true };
  if (list.length >= MAX) {
    var allDone = list.every(function (e) { return e.status === 'completed'; });
    if (allDone) list = [];
    else return { list: list, added: false, reused: false };
  }
  list = list.concat([{ playId: playId, status: 'assigned' }]);
  return { list: list, added: true, reused: false };
}
var s = [];
s = append(s, 'p1').list;
s = append(s, 'p2').list;
s = append(s, 'p3').list;
assert(s.length === 3, 'three plays → three tasks');
var dup = append(s, 'p1');
assert(dup.reused && dup.list.length === 3, 'same playId does not duplicate');
var cap = append(s, 'p4');
assert(!cap.added && cap.list.length === 3, 'fourth play does not add while pending remain');
s = s.map(function (e) { return Object.assign({}, e, { status: 'completed' }); });
var next = append(s, 'p5');
assert(next.added && next.list.length === 1 && next.list[0].playId === 'p5', 'after all completed, new session starts');

console.log('\nProgressive game tasks checks passed');
