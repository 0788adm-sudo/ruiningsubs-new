#!/usr/bin/env node
/**
 * Post Detail contact notice — only in individual post view.
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

assert(html.indexOf('function postDetailContactNoticeHtml') >= 0, 'reusable helper exists');
assert(html.indexOf('class="dx-contact"') >= 0, 'dx-contact markup');
assert(html.indexOf('¿Problemas con esta publicación? Contáctanos:') >= 0, 'exact Spanish copy');
assert(html.indexOf('mailto:0788adm@gmail.com') >= 0, 'mailto link');
assert(html.indexOf('https://t.me/mastersan01') >= 0, 'Telegram profile link');
assert(html.indexOf('Telegram: @mastersan01') >= 0, 'Telegram label');
assert(/acts\s*\+\s*contactNotice|acts\+contactNotice/.test(html), 'notice injected after action bar');
assert(html.indexOf('var contactNotice=postDetailContactNoticeHtml()') >= 0, 'called from openDetail');

// Must NOT appear in feed/card builders that are not openDetail.
var feedBuilders = [
  'function postCardHtml',
  'function wallCardHtml',
  'normal-feed-post-actions',
  'home-strip-card'
];
feedBuilders.forEach(function (needle) {
  var idx = html.indexOf(needle);
  if (idx < 0) return;
  var slice = html.slice(idx, idx + 2500);
  assert(slice.indexOf('dx-contact') < 0 && slice.indexOf('postDetailContactNoticeHtml') < 0,
    'no contact notice near ' + needle);
});

// Only one openDetail injection (ignore any self-test / assignment noise).
var injectCalls = (html.match(/contactNotice\s*=\s*postDetailContactNoticeHtml\(\)/g) || []).length;
assert(injectCalls === 1, 'single openDetail injection (got ' + injectCalls + ')');

assert(html.indexOf('.dx-contact{') >= 0, 'discreet CSS present');
assert(html.indexOf('background:transparent') >= 0 || html.indexOf('.dx-contact{\n      margin:10px 0 0;padding:0;background:transparent') >= 0, 'transparent background');

console.log('\nPost detail contact notice checks passed');
