#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes('function postHasActiveTimer'), 'active timer helper');
assert(html.includes('Pinned + active timer') || html.includes('Pinning alone does NOT'), 'pinned timed posts keep Extend');
assert(/postHasActiveTimer\(p\)/.test(html) && html.includes('postCardActionButtons'), 'cards use active-timer rule');
assert(html.includes('Hot is for posts without a timer'), 'hot blocked on timed posts');
assert(html.includes('restoreExtendButtons'), 'extend restores buttons on failure');
assert(html.includes('hardDeadline'), 'extend absolute deadline');
assert(/toast\('Extended \+'/.test(html) || html.includes("toast('Extended +"), 'success toast Extended +amount');
assert(html.includes('syncPostExpiresEverywhere'), 'sync expires across caches');
assert(html.includes("name:'TIC-TAC-TOE'"), 'Tic-Tac-Toe English');
assert(html.includes("name:'WORD SCRAMBLE'"), 'Word Scramble English');
assert(html.includes("name:'RUIN ROULETTE'"), 'Ruin Roulette');
assert(html.includes("name:'EXPOSURE DICE'"), 'Exposure Dice');
assert(!/id:'memory'/.test(html), 'memory removed');
assert(!/id:'reaction'/.test(html), 'reaction removed');
assert(!/id:'typing'/.test(html), 'typing removed');
assert(!/id:'sequence'/.test(html), 'sequence removed');
assert(html.includes('>PLAY</button>'), 'PLAY button English');
assert(html.includes('TIC-TAC-TOE · WORD SCRAMBLE · ROULETTE · DICE'), 'promo English four games');
assert(html.includes('function probeVideoPlayable'), 'GoonTok playable probe');
assert(html.includes('preflight_fail'), 'preflight skip broken before mount');
assert(html.includes('GT_LOAD_TIMEOUT_MS=9000'), 'shorter load timeout');
assert(html.includes("failVideo(v,'load_timeout')"), 'drop on load timeout');
assert(html.includes('Always keep thumbnail visible') || html.includes('showPoster(v)'), 'poster kept while loading');
assert(html.includes('silentlyDropGoonTokSlide'), 'auto-advance on broken');
console.log('\nGoonTok / Extend / Hot / Games checks passed');
