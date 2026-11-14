#!/usr/bin/env node
/**
 * Feed/wall cards must not expose Delete; Comment stays; detail keeps Delete + $5 flow.
 * Rights free-review button must be gone; contact notice stays in post detail.
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

assert(html.indexOf('data-nf-act="delete"') < 0, 'no feed/wall delete action attribute');
assert(!/color:#f87171[^>]*>Delete/.test(html.replace(/\s+/g, ' ')), 'no red Delete button markup on cards');
assert(html.indexOf("onclick=\"event.stopPropagation();openRemove(' + jsId(p.id) + ')\">Delete</button>") < 0, 'postCardActionButtons has no Delete');
assert(/function postCardActionButtons[\s\S]*?feed-cmt-span/.test(html), 'Comment centering helper in postCardActionButtons');
assert(/nf-feed-comment/.test(html), 'normal feed Comment marked for balanced layout');
assert(/id="btn-remove-led-label"/.test(html), 'detail Delete button id present');
assert(html.indexOf('btn-remove-paypal') >= 0 && html.indexOf('btn-remove-throne') >= 0, 'PayPal + Throne kept');
assert(html.indexOf('I paid $5 — pending admin verify') >= 0, 'I paid kept');
assert(html.indexOf('id="btn-remove-rights"') < 0, 'rights button element removed');
assert(html.indexOf('onclick="confirmRemoveRights()"') < 0, 'no rights onclick in UI');
assert(html.indexOf('Problems with this post? Contact us:') >= 0, 'contact notice copy');
assert(html.indexOf('mailto:0788adm@gmail.com') >= 0, 'contact email');
assert(html.indexOf('Telegram: @mastersan01') >= 0, 'contact Telegram');

console.log('\nFeed delete UI checks passed');
