#!/usr/bin/env node
/**
 * Post Detail Share button — neon green CTA styles + icon, scoped to dx-share only.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(html.indexOf('.dx-row.dx-share') >= 0, 'dx-share CSS exists');
assert(/\.dx-row\.dx-share\{[^}]*#00E676/i.test(html), 'uses #00E676');
assert(/\.dx-row\.dx-share\{[^}]*linear-gradient/i.test(html), 'has green gradient');
assert(/\.dx-row\.dx-share\{[^}]*box-shadow/i.test(html), 'has neon outer glow');
assert(html.indexOf('class="dx-row dx-share"') >= 0, 'Share button uses dx-share class');
assert(/dx-share[\s\S]{0,220}sharePost\(/.test(html), 'dx-share still calls sharePost');
assert(/dx-share[\s\S]{0,280}share-ico/.test(html), 'Share button includes share icon');

// Other dx-row actions must stay unstyled by dx-share.
assert(html.indexOf('class="dx-row" type="button" onclick="downloadPost') >= 0,
  'Download stays plain dx-row');
assert(html.indexOf('class="dx-row" type="button" onclick="toggleSave') >= 0,
  'Save stays plain dx-row');
assert((html.match(/class="dx-row dx-share"/g) || []).length === 1,
  'exactly one dx-share button in post detail');

console.log('OK · post-detail share neon');
