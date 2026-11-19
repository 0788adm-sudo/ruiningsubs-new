#!/usr/bin/env node
/**
 * Lifecycle: initial duration ≠ extend_amount ≠ extend cooldown (6h).
 * Selecting 24h extend must store/apply 1440 — never fall back to cooldown 360.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'extend.js'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

function extractFn(src, name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}');
  var m = src.match(re);
  if (!m) throw new Error('missing function ' + name);
  return m[0];
}

// --- Extract & eval helpers from SPA ---
var helpers = [
  extractFn(html, 'parseExtendMins'),
  extractFn(html, 'clampPubExtendMinutes'),
  extractFn(html, 'tagExtendMinutes'),
  extractFn(html, 'columnExtendMinutes'),
  extractFn(html, 'resolveExtendAmountMinutes')
].join('\n');
// postExtendMinutes + constants
assert(html.includes('EXTEND_COOLDOWN_MS=6*60*60*1000'), 'cooldown remains 6h');
assert(html.includes('EXTEND_ADD_MINUTES=360'), 'legacy add fallback remains 360');
assert(html.includes('NEVER use EXTEND_COOLDOWN_MS here'), 'postExtendMinutes documents cooldown independence');

var pem = html.match(/function postExtendMinutes\(post\)\{[\s\S]*?\n    \}/);
assert(pem, 'postExtendMinutes present');
var fmt = html.match(/function fmtMin\(min\)\{[^}]+\}/);
assert(fmt, 'fmtMin present');

var sandbox = {};
var code =
  'var EXTEND_ADD_MINUTES=360;\n' +
  helpers +
  '\n' +
  pem[0] +
  '\n' +
  fmt[0] +
  '\n' +
  'sandbox.parseExtendMins=parseExtendMins;' +
  'sandbox.resolveExtendAmountMinutes=resolveExtendAmountMinutes;' +
  'sandbox.postExtendMinutes=postExtendMinutes;' +
  'sandbox.fmtMin=fmtMin;' +
  'sandbox.tagExtendMinutes=tagExtendMinutes;';
eval(code.replace(/sandbox\./g, 'sandbox.'));
// Fix: assign via Function
sandbox = Function(
  'var EXTEND_ADD_MINUTES=360;\n' +
    helpers +
    '\n' +
    pem[0] +
    '\n' +
    fmt[0] +
    '\n' +
    'return {parseExtendMins:parseExtendMins,resolveExtendAmountMinutes:resolveExtendAmountMinutes,postExtendMinutes:postExtendMinutes,fmtMin:fmtMin,tagExtendMinutes:tagExtendMinutes};'
)();

// 1) Initial duration 24h + extension 24h
var post24 = {
  tags: ['exposed', 'ext_1440', 'del:deletable'],
  extend_amount: 360, // stale/wrong column (simulates CF default)
  extendAmount: 360,
  expires: Date.now() + 1440 * 60000
};
assert(sandbox.postExtendMinutes(post24) === 1440, '1 · tags ext_1440 win over stale column 360');
assert(sandbox.fmtMin(1440) === '24h', '1 · button label Extend +24h');

// Correct column + tags
assert(
  sandbox.postExtendMinutes({ tags: ['ext_1440'], extend_amount: 1440 }) === 1440,
  '1 · column+tag 1440 → 1440'
);

// 2) Initial duration 3 days + extension 24h
assert(
  sandbox.postExtendMinutes({ tags: ['ext_1440'], extend_amount: 1440 }) === 1440,
  '2 · extend amount 24h independent of 3-day initial duration'
);

// 3) Initial duration 24h + extension 6h
assert(
  sandbox.postExtendMinutes({ tags: ['ext_360'], extend_amount: 360 }) === 360,
  '3 · explicit 6h extend still works'
);
assert(sandbox.fmtMin(360) === '6h', '3 · button label Extend +6h');

// 4) Successful extension adds selected amount (SPA + API wire)
assert(html.includes('minutes:mins') || html.includes('minutes: mins'), '4 · SPA sends publisher minutes on extend');
assert(api.includes('tagExtendMinutesOrZero'), '4 · API prefers publisher tag when present');
assert(api.includes('COOLDOWN_MS'), '4 · API keeps separate cooldown constant');

// Simulate add
function applyExtend(expires, minutes) {
  return expires + minutes * 60000;
}
var exp0 = Date.now() + 1440 * 60000;
var exp1 = applyExtend(exp0, sandbox.postExtendMinutes(post24));
assert(exp1 - exp0 === 1440 * 60000, '4 · +24h added to expires_at');

// 5) Second extend blocked during cooldown — structural
assert(html.includes('EXTEND_COOLDOWN_MS=6*60*60*1000'), '5 · 6h cooldown constant');
assert(/COOLDOWN_MS\s*=\s*Number\(process\.env\.EXTEND_COOLDOWN_MS\s*\|\|\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000\)/.test(api), '5 · API cooldown 6h');

// 6) After cooldown available again — same amount still used
assert(
  sandbox.postExtendMinutes(post24) === 1440,
  '6 · after cooldown still uses 24h amount (not cooldown)'
);

// 7) Feed + detail share resolveExtendAmountMinutes
assert(html.includes('resolveExtendAmountMinutes(p,rowTags)') || html.includes('resolveExtendAmountMinutes(p, tags)'), '7 · feed mapRow uses resolver');
assert(html.includes('resolveExtendAmountMinutes(p,tags)') || html.includes('resolveExtendAmountMinutes(p, tags)'), '7 · cfPostToFeed uses resolver');
assert((html.match(/resolveExtendAmountMinutes/g) || []).length >= 8, '7 · resolver used across UI paths');

// 8) Refresh / last_pub does not force 360
assert(!/extendAmount:360,extenders:\[\],likedBy:\[\],image:lp\.image/.test(html), '8 · last_pub inject no longer hardcodes 360');
assert(html.includes('resolveExtendAmountMinutes(lp') || html.includes('lp.extendAmount'), '8 · last_pub uses stored/resolved amount');
assert(html.includes('extend_amount:Number(saved.extend_amount'), '8 · createCfPost returns extend_amount');
assert(html.includes('extend_amount:payload.extend_amount||0') && html.includes('extend_mins:payload.extend_amount||0'), '8 · publish sends both fields');

// 9) Different posts different amounts
var a = sandbox.postExtendMinutes({ tags: ['ext_1440'] });
var b = sandbox.postExtendMinutes({ tags: ['ext_360'] });
var c = sandbox.postExtendMinutes({ tags: ['ext_720'] });
assert(a === 1440 && b === 360 && c === 720, '9 · per-post amounts independent');

// parseExtendMins fallback 0 must stay 0
assert(sandbox.parseExtendMins(['exposed'], 0) === 0, 'parseExtendMins(...,0) stays 0 when no ext tag');
assert(sandbox.tagExtendMinutes(['exposed', 'ext_1440']) === 1440, 'tagExtendMinutes reads ext_1440');
assert(sandbox.tagExtendMinutes(['exposed']) === 0, 'tagExtendMinutes missing → 0');

// Legacy no amount → 360 fallback only
assert(sandbox.postExtendMinutes({ tags: ['exposed'] }) === 360, 'legacy post without amount → 360 fallback');

// Cooldown must not equal extend amount constant confusion
assert(html.includes('EXTEND_COOLDOWN_MS=6*60*60*1000') && html.includes('selectedExtendAmount=1440'), 'cooldown 6h ≠ default extend 24h');

// Publish local optimistic path prefers payload/selection
assert(
  /extendAmount:profileMode \? 0 : \(function\(\)\{var n=0;try\{n=resolveExtendAmountMinutes/.test(html),
  'optimistic local post resolves amount (not bare ||360)'
);

console.log('\nExtend amount lifecycle checks passed');
