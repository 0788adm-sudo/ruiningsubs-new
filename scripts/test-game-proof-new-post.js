#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes("title.textContent='New Post'"), 'game proof opens existing New Post panel title');
assert(html.includes("btn.textContent='Publish'") || html.includes("btn:'Publish'"), 'Publish button label for proofs');
assert(html.includes('validateGameProofBeforePublish'), 'createPost gates on challenge validation');
assert(html.includes('window.__pendingGamePublish && titleInput'), 'keeps generated challenge title on publish');
assert(html.includes('buildGameProofTags'), 'auto tags include game + challenge + match ids');
assert(html.includes('play:'), 'match/play id embedded in tags');
assert(html.includes('WHERE:'), 'dice WHERE included when present');
assert(html.includes("label:'🎡 Ruin Roulette'"), 'Wall badge Ruin Roulette');
assert(html.includes("label:'❌ Tic-Tac-Toe'"), 'Wall badge Tic-Tac-Toe');
assert(html.includes("label:'🏆 Challenge'"), 'Wall badge Challenge');
assert(html.includes('openGameTaskPublish'), 'all games route through openGameTaskPublish');
assert((html.match(/openGameTaskPublish\(/g) || []).length >= 4, 'openGameTaskPublish used across games');

console.log('\nGame proof → New Post checks passed');
