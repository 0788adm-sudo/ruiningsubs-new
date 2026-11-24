#!/usr/bin/env node
/**
 * Feed/wall cards hide Delete (detail-only); Comment stays;
 * detail keeps Delete + $5 / 50 Coins flow (PayPal · Throne · Coins · admin verify).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

function fnBody(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    function ');
  var m = html.match(re);
  return m ? m[0] : '';
}

var cardBtns = fnBody('postCardActionButtons');
var normalFeed = fnBody('normalFeedPostHtml');

assert(cardBtns.indexOf('universalDeleteButtonHtml') < 0, 'postCardActionButtons has no Delete');
assert(cardBtns.indexOf('openRemove') < 0, 'postCardActionButtons does not openRemove');
assert(normalFeed.indexOf('universalDeleteButtonHtml') < 0, 'normalFeedPostHtml has no Delete');
assert(normalFeed.indexOf('openRemove') < 0, 'normalFeedPostHtml does not openRemove');
assert(/function postCardActionButtons[\s\S]*?feed-cmt-span/.test(html), 'Comment centering helper in postCardActionButtons');
assert(/nf-feed-comment/.test(html), 'normal feed Comment marked for balanced layout');
assert(/id="btn-remove-led-label"/.test(html), 'detail Delete button id present');
assert(/universalDeleteButtonHtml\(post,\s*\{\s*style:\s*'dx'\s*\}/.test(html), 'Delete remains inside post detail');
assert(html.indexOf('btn-remove-paypal') >= 0 && html.indexOf('btn-remove-throne') >= 0, 'PayPal + Throne kept');
assert(html.indexOf('I paid $5 — pending admin verify') >= 0, 'I paid kept');
assert(html.indexOf('id="btn-remove-rights"') < 0, 'rights button element removed');
assert(html.indexOf('onclick="confirmRemoveRights()"') < 0, 'no rights onclick in UI');
assert(html.indexOf('Problems with this post? Contact us:') >= 0, 'contact notice copy');
assert(html.indexOf('mailto:0788adm@gmail.com') >= 0, 'contact email');
assert(html.indexOf('Telegram: @mastersan01') >= 0, 'contact Telegram');
assert(html.indexOf('universalDeleteButtonHtml') >= 0, 'universal Delete helper');
assert(html.indexOf('10 Coins') >= 0 || html.indexOf('Coins or $5') >= 0, 'third-party paid delete path');
assert(html.indexOf('You already have a pending delete request') >= 0, 'duplicate remove request blocked');
assert(html.indexOf('function shortDisplayUser') >= 0, 'anon names shortened for display');
assert(html.indexOf("return 'Sub'+num") >= 0 || /Sub\d+/.test(html), 'anon display uses SubN numbers');

console.log('\nFeed delete UI checks passed');
