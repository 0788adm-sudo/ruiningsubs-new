#!/usr/bin/env node
/**
 * Static checks: Extend uses publisher amount + 6h re-extend;
 * Games hub keeps Triki + Armar la palabra + Ruleta + Dados only.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'extend.js'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes('function postExtendMinutes'), 'postExtendMinutes helper');
assert(/Each Extender adds whatever the publisher set/.test(html), 'publisher amount comment');
assert(html.includes('parseExtendMins(post&&post.tags'), 'reads ext_N tags');
assert(html.includes("toast('Extended · +'+amtLab"), 'toast uses publisher amount label');
assert(html.includes("'⚡ Extend +'+fmtMin(postExtendMinutes(post))"), 'cooldown refresh uses publisher amount');
assert(html.includes('EXTEND_COOLDOWN_MS=6*60*60*1000'), '6h same-post re-extend cooldown');
assert(html.includes('__openExtTap'), 'Safari one-tap debounce');
assert(html.includes('Safari-fast path') || html.includes('hit CF directly first'), 'CF-first extend');
assert(html.includes('extendViaSupabase'), 'Supabase extend fallback');

assert(api.includes('lookupPostExtendMinutes'), 'api looks up publisher minutes');
assert(api.includes('EXTEND_MINUTES_DEFAULT'), 'api default minutes constant');
assert(!/\bEXTEND_MINUTES\b/.test(api.replace(/EXTEND_MINUTES_DEFAULT/g, '').replace(/EXTEND_MINUTES_MIN/g, '').replace(/EXTEND_MINUTES_MAX/g, '')), 'no stale EXTEND_MINUTES bare name');
assert(api.includes('clampExtendMinutes'), 'api clamps minutes');
assert(api.includes('cooldown_board') || api.includes('cooldown_check_skip'), 'api soft-fails cooldown board');
assert(api.includes('You can extend again in '), 'api English cooldown');
assert(api.includes('minutes_added'), 'api returns minutes_added');

assert(html.includes("id:'tic_tac_toe'"), 'Triki in registry');
assert(html.includes("id:'word_challenge'"), 'Armar la palabra in registry');
assert(html.includes("id:'roulette'") && html.includes("id:'dice'"), 'Ruleta + Dados in registry');
assert(!html.includes("id:'memory'"), 'memory game removed');
assert(!html.includes("id:'reaction'"), 'reaction game removed');
assert(!html.includes("id:'typing'"), 'typing game removed');
assert(!html.includes("id:'sequence'"), 'sequence game removed');
assert(html.includes('ARMAR LA PALABRA'), 'Armar la palabra label');
assert(html.includes('TRIKI'), 'Triki label');
assert(html.includes('backFromDiceGame'), 'dice back returns to games');
assert(html.includes("__gamesToolReturn='challenges'"), 'roulette/dice remember games hub');
assert(html.includes('TRIKI · ARMAR LA PALABRA · RULETA · DADOS'), 'promo lists four games');

console.log('\nExtend + Games Triki checks passed');
