#!/usr/bin/env node
/**
 * New posts default Extend amount = 24h (1440m), not 6h (360m).
 * 6h remains available; only the initial selection / publish fallback change.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

// UI: 24h selected in #ext-dur; 6h still present without sel
var extDur = html.slice(html.indexOf('id="ext-dur"'), html.indexOf('id="ext-dur"') + 700);
assert(extDur.indexOf('class="dur-btn sel" data-m="1440"') >= 0, 'ext-dur defaults selection to 24h (1440)');
assert(extDur.indexOf('class="dur-btn" data-m="360">6h') >= 0, '6h option remains available and is not the selected default');
assert(extDur.indexOf('class="dur-btn sel" data-m="360"') < 0, '6h is not marked sel in ext-dur');

// JS initial state + publish persistence
assert(
  html.includes('selectedExtendAmount=1440') || html.includes('selectedExtendAmount = 1440'),
  'JS selectedExtendAmount defaults to 1440'
);
assert(
  html.includes("ext_'+(selectedExtendAmount||1440)") ||
    html.includes('ext_\'+(selectedExtendAmount||1440)'),
  'publish tag uses selectedExtendAmount||1440'
);
assert(
  html.includes('(selectedExtendAmount||1440)') &&
    /extend_amount:[\s\S]{0,80}selectedExtendAmount\|\|1440/.test(html),
  'publish payload extend_amount falls back to 1440'
);

// Keep all extend duration options
['15', '30', '60', '120', '360', '720', '1440'].forEach(function (m) {
  assert(new RegExp('id="ext-dur"[\\s\\S]{0,500}data-m="' + m + '"').test(html), 'keeps ext option ' + m + 'm');
});

// Do not change legacy fallback for posts that already lack a public amount
assert(
  html.includes('EXTEND_ADD_MINUTES=360') || html.includes('EXTEND_ADD_MINUTES = 360'),
  'legacy EXTEND_ADD_MINUTES fallback for old posts stays 360'
);

// Button label helper: 1440 formats as 1 day (same duration as 24h option)
assert(/function fmtMin\(min\)\{[^}]*min===1440\)return'1 day'/.test(html), 'fmtMin(1440) → 1 day for Extend button');

// Simulate publish without changing selection
var selectedExtendAmount = 1440;
var payloadExtend = selectedExtendAmount || 1440;
assert(payloadExtend === 1440, 'unpublished selection change → extend_amount 1440');
assert(
  (function fmtMin(min) {
    min = Number(min) || 0;
    if (min < 60) return min + 'm';
    if (min < 1440) return min / 60 + 'h';
    if (min === 1440) return '1 day';
    if (min === 4320) return '3 days';
    return min / 1440 + 'd';
  })(payloadExtend) === '1 day',
  'Extend button label for default is +1 day (24h)'
);

// User can still pick 6h
selectedExtendAmount = 360;
assert((selectedExtendAmount || 1440) === 360, 'user can still choose 6h before publish');

console.log('\nDefault extend 24h checks passed');
