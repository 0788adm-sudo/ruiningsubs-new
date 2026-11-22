#!/usr/bin/env node
/**
 * Universal Delete: detail (+ GoonTok/archive) shows Delete; feed/Wall cards do not.
 * Profile gallery: Delete only inside owner admin menu (never a visible under-post button for visitors).
 * Owner free; non-owner $5/50 FC; backend ownerDeleteCost always 0.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(root, 'api/delete-post.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

function fnBody(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    function ');
  var m = html.match(re);
  return m ? m[0] : '';
}

assert(/function universalDeleteButtonHtml/.test(html), 'universalDeleteButtonHtml helper');
assert(/function canDeletePostAsOwner/.test(html), 'canDeletePostAsOwner helper');
assert(fnBody('normalFeedPostHtml').indexOf('universalDeleteButtonHtml') < 0, 'Wall cards hide Delete');
assert(fnBody('postCardActionButtons').indexOf('universalDeleteButtonHtml') < 0, 'Feed cards hide Delete');
assert(/function goontokSlideHtml[\s\S]*?universalDeleteButtonHtml|gt-del/.test(html), 'GoonTok has Delete');
assert(/function profileGalleryPostHtml[\s\S]*?pg-admin-menu[\s\S]*?openRemove/.test(html), 'Profile gallery Delete lives in owner admin menu');
assert(/\.profile-gallery-post \.pg-delete\{display:none!important\}/.test(html), 'Profile gallery hides visible Delete button');
assert(!/function profileGalleryPostHtml[\s\S]*?ownerDelete\s*=\s*typeof universalDeleteButtonHtml/.test(html), 'Profile gallery no longer injects universal Delete under posts');
assert(/id-archive-actions[\s\S]{0,800}universalDeleteButtonHtml|openRemove/.test(html), 'Archive has Delete');
assert(/universalDeleteButtonHtml\(post,\s*\{\s*style:\s*'dx'\s*\}/.test(html), 'Detail view always shows Delete');

assert(/Owner always free|Delete now — free|free · your post/.test(html), 'owner free UI copy');
assert(/requestDeleteWithCoins/.test(html), 'non-owner FC auto-delete');
assert(/I paid \$5 — pending admin verify/.test(html), 'external pay awaits admin');
assert(/btn-remove-paypal/.test(html) && /btn-remove-throne/.test(html), 'PayPal + Throne kept');
assert(/You already have a pending delete request/.test(html), 'duplicate request blocked');
assert(/APPROVE &amp; DELETE|APPROVE & DELETE/.test(html), 'admin approve & delete');
assert(/data-asec="removereq"/.test(html), 'admin delete-requests section');

assert(/function ownerDeleteCost[\s\S]*?return 0/.test(api), 'API ownerDeleteCost always 0');
assert(/anonymous_cannot_delete/.test(api), 'API still gates anon non-owners');
assert(/requesterAnon && !isOwner/.test(api), 'anon non-owner must pay');
assert(/DELETE_COST_FC/.test(api) && /50/.test(api), 'paid path still 50 FC');
assert(
  (/12000/.test(api) || /15000/.test(api)) &&
    (/resolveFcBalance/.test(api) || /spendDeleteFc/.test(api)) &&
    /spend_timeout|Never report "insufficient/.test(api),
  'delete FC resolves real balance and does not mask CF timeout as empty wallet'
);

assert(/Never promote a JPEG|treatAsVideo/.test(html), 'Wall photo→video gate');
assert(/if\(vsrc && typeof isVideoUrl==='function' && !isVideoUrl\(vsrc\)\) vsrc=''/.test(html), 'feed rejects non-video src');

assert(!/Anonymous accounts cannot delete posts\. Register to manage your own content/.test(html), 'anon owners no longer hard-blocked in client');
assert(/Pay \$5 \/ 50 FC to request delete/.test(html) || /deletes it immediately/.test(html), 'non-owner paid messaging');
assert(/function shortDisplayUser/.test(html), 'shortDisplayUser for long anon_ names');
assert(/return 'Sub'\+num/.test(html), 'anon display maps to SubN');

console.log('\nUniversal delete checks passed');
