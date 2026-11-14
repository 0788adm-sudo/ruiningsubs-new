#!/usr/bin/env node
/** Guards for Spotlight pin retirement + delete UI (detail-only Delete; no feed Delete / rights button). */
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}
assert(/var SB_FEED_COLS='[^']*'/.test(html), 'SB_FEED_COLS present');
assert(!/var SB_FEED_COLS='[^']*deletion_tier/.test(html), 'SB_FEED_COLS must not request deletion_tier');
assert(html.indexOf('function retirePinBoardNotifs') >= 0, 'retirePinBoardNotifs helper');
assert(html.indexOf('retireExpiredSpotlightPin') >= 0, 'expire pin helper');
assert(html.indexOf('id="btn-remove-rights"') < 0, 'rights button removed from modal');
assert(html.indexOf('Rights / non-consensual · free review') < 0, 'rights CTA copy removed');
assert(html.indexOf('function setRemoveModalRights') < 0, 'rights modal toggle helper removed');
assert(html.indexOf('Request delete · $5') >= 0, 'third-party $5 request copy');
assert(html.indexOf('$5 request') >= 0, 'detail Delete for non-owners');
assert(html.indexOf('$5 request · or rights') < 0, 'detail Delete no longer advertises rights shortcut');
assert(html.indexOf("openRemove(' + jsId(p.id) + ')") < 0, 'feed card Delete via openRemove removed');
assert(html.indexOf('data-nf-act="delete"') < 0, 'Wall/feed delete shortcut button removed');
assert(/id="btn-remove-led-label"/.test(html), 'Delete remains in post detail');
assert(html.indexOf('btn-remove-paypal') >= 0, 'PayPal $5 remove kept');
assert(html.indexOf('btn-remove-throne') >= 0, 'Throne $5 remove kept');
assert(html.indexOf('btn-remove-paid') >= 0, 'I paid remove kept');
assert(html.indexOf('Approve & delete post') >= 0, 'admin approve label');
assert(html.indexOf('RIGHTS REVIEW') >= 0, 'admin rights badge for legacy requests');
assert(/retirePinBoardNotifs\(id,\s*\{\s*skipDb:\s*true\s*\}\)/.test(html), 'unpin clears pin board');
assert(html.indexOf('function recordRemoveHistory') >= 0, 'remove history recorder');
assert(html.indexOf('admin-req-remove-hist') >= 0, 'admin remove history panel');
assert(html.indexOf('feed-cmt-span') >= 0, 'Comment centered when alone on feed cards');
assert(html.indexOf('Problems with this post? Contact us:') >= 0, 'post-detail contact notice kept');
console.log('OK spotlight-delete-system guards');
