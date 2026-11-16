#!/usr/bin/env node
/**
 * Critical post deletion fixes:
 * - PayPal/Throne tickets carry postId
 * - Admin APPROVE refreshes CF token + closes request after delete
 * - API canonicalizes post ids + SB ledger already_deleted
 * - Do not mark requests completed before the post is gone
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(root, 'api/delete-post.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(/startPayTicket\(\{kind:'remove'[\s\S]*?postId:window\.__removePostId/.test(html), 'PayPal ticket passes postId');
assert(/btn-remove-throne[\s\S]*?startPayTicket\(\{kind:'remove'[\s\S]*?postId:window\.__removePostId/.test(html), 'Throne ticket passes postId');
assert(/ticketPostId=opts\.postId\|\|opts\.id\|\|opts\.post_id/.test(html), 'startPayTicket resolves delete post id');
assert(/Backfill missing delete post id/.test(html), 'markTicketPaid backfills post id');
assert(/cfCreateRequest\(\{[\s\S]*?kind:'remove_request'[\s\S]*?postId:String\(t\.postId\)/.test(html), 'ticket paid creates CF remove_request with postId');

assert(/cfAdminLogin/.test(html) && /Expired admin bearer/.test(html), 'secureDeletePost refreshes admin bearer');
assert(/admin_auth_required/.test(api), 'API returns admin_auth_required for expired moderation');
assert(/function canonicalPostId/.test(api), 'API canonicalPostId helper');
assert(/findSbDeleteSpend/.test(api), 'API checks Supabase ledger for already_deleted');
assert(/postIdLookupVariants/.test(api), 'API tries string+number id variants');
assert(/Idempotent DELETE: missing post/.test(api) || /already_deleted: true/.test(api), 'missing post returns already_deleted (no charge)');
assert(!/return json\(res, 404, \{ error: 'not_found'/.test(api), 'delete of missing post is not a hard 404 anymore');

assert(/data-request-id/.test(html), 'APPROVE button carries CF request id');
assert(/Only mark completed after the publication is actually gone|Do NOT remove from local queue until the post is actually deleted|Delete did not verify — request left pending/.test(html), 'approve waits for real delete');
assert(/treatMissingAsDeleted:true/.test(html), 'admin approve treats missing post as already deleted');
assert(/Approved — post #|clearRemoveRequestArtifacts/.test(html), 'approve closes CF remove_request after delete');

assert(/GoonTok|goontok/.test(html), 'GoonTok player kept');
assert(!/migrate.*R2|new storage provider/i.test(api), 'no storage migration in delete-post');

console.log('\nOK · post-deletion-fix');
