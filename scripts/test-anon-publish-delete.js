#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var del = fs.readFileSync(path.join(__dirname, '..', 'api/delete-post.js'), 'utf8');
var anon = fs.readFileSync(path.join(__dirname, '..', 'api/anon-identity.js'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(anon.includes('anonymous_user_id'), 'anon-identity API returns anonymous_user_id');
assert(anon.includes('Set-Cookie') || anon.includes('rs_anon_id'), 'anon-identity sets cookie');
assert(anon.includes("action === 'link'"), 'anon-identity supports link to registered');
assert(html.includes('function ensureAnonIdentity'), 'ensureAnonIdentity helper');
assert(html.includes('function isAnonymousAccount'), 'isAnonymousAccount helper');
assert(html.includes("Login to publish proof") === false || !/openGameTaskPublish[\s\S]{0,200}Login to publish proof/.test(html), 'openGameTaskPublish no login gate');
assert(!/function publishRouletteToFeed\(\)\{[\s\S]{0,800}Login to publish proof/.test(html), 'roulette publish no login gate');
assert(!/function publishDiceProof\(\)\{[\s\S]{0,500}Login to publish proof/.test(html), 'dice publish no login gate');
assert(html.includes('Anonymous accounts cannot delete'), 'anon delete blocked in UI');
assert(html.includes('anonymous_cannot_delete') || del.includes('anonymous_cannot_delete'), 'server rejects anon delete');
assert(del.includes('requesterAnon'), 'delete-post checks anonymous requester');
assert(html.includes("account:anonymous") || html.includes("account:registered"), 'posts tag account type');
assert(html.includes('rs_linked_anon'), 'register links anon history');
assert(html.includes('function canDeletePostAsOwner') && html.includes('Anonymous visitors may publish but never delete'), 'owner delete requires registered');
assert(html.includes('You can only delete your own posts'), 'openRemove blocks non-owners');
assert(html.includes('PENDING GAME TASKS'), 'pending tasks visible');

console.log('\nAnon publish/delete checks passed');
