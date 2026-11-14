#!/usr/bin/env node
/** Guards for Spotlight pin retirement + universal Delete UI. */
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
assert(html.indexOf('confirmRemoveRights') >= 0, 'rights remove channel');
assert(html.indexOf('btn-remove-rights') >= 0, 'rights button in modal');
assert(html.indexOf('Request delete · $5') >= 0, 'third-party $5 request copy');
assert(html.indexOf('$5 request · or rights') >= 0, 'detail Delete for non-owners');
assert(html.indexOf("openRemove(' + jsId(p.id) + ')") >= 0, 'feed card Delete opens openRemove');
assert(html.indexOf('data-nf-act="delete"') >= 0, 'Wall delete button present');
assert(html.indexOf('Approve & delete post') >= 0, 'admin approve label');
assert(html.indexOf('RIGHTS REVIEW') >= 0, 'admin rights badge');
assert(/retirePinBoardNotifs\(id,\s*\{\s*skipDb:\s*true\s*\}\)/.test(html), 'unpin clears pin board');
assert(html.indexOf('function recordRemoveHistory') >= 0, 'remove history recorder');
assert(html.indexOf('admin-req-remove-hist') >= 0, 'admin remove history panel');
console.log('OK spotlight-delete-system guards');
