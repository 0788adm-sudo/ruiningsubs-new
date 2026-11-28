#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var del = fs.readFileSync(path.join(__dirname, '..', 'api/delete-post.js'), 'utf8');
var gamePlay = fs.readFileSync(path.join(__dirname, '..', 'api/game-play.js'), 'utf8');
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(!fs.existsSync(path.join(__dirname, '..', 'api/anon-identity.js')), 'no separate anon-identity route (Hobby 12-fn cap)');
assert(fs.readdirSync(path.join(__dirname, '..', 'api')).filter(function(f){return f.endsWith('.js')}).length<=12, 'api/ has ≤12 serverless functions');
assert(gamePlay.includes('anonymous_user_id'), 'game-play returns anonymous_user_id');
assert(gamePlay.includes('handleAnonIdentity'), 'game-play hosts anon identity');
assert(gamePlay.includes("action === 'link_anon'") || gamePlay.includes("action === 'anon_identity'"), 'game-play supports anon actions');
assert(html.includes('function ensureAnonIdentity'), 'ensureAnonIdentity helper');
assert(html.includes("action:'anon_identity'"), 'client calls game-play anon_identity');
assert(html.includes('function isAnonymousAccount'), 'isAnonymousAccount helper');
assert(html.includes("Login to publish proof") === false || !/openGameTaskPublish[\s\S]{0,200}Login to publish proof/.test(html), 'openGameTaskPublish no login gate');
assert(!/function publishRouletteToFeed\(\)\{[\s\S]{0,800}Login to publish proof/.test(html), 'roulette publish no login gate');
assert(!/function publishDiceProof\(\)\{[\s\S]{0,500}Login to publish proof/.test(html), 'dice publish no login gate');
assert(!/function openNormalPostComposer\(\)\{[\s\S]{0,600}(Login to publish|Register to publish)/.test(html), 'All Posts composer no login gate');
assert(html.includes('Continue as Guest') && html.includes('Create your profile!'), 'optional guest register invite');
assert(html.includes('PUBLIC PHOTO POST'), 'All Posts public photo framing');
// Universal Delete: anon owners may free-delete; anon non-owners must pay / are gated server-side.
assert(del.includes('anonymous_cannot_delete'), 'server rejects anon non-owner free delete');
assert(del.includes('requesterAnon'), 'delete-post checks anonymous requester');
assert(/requesterAnon && !isOwner/.test(del), 'anon non-owners cannot free-delete');
assert(/function ownerDeleteCost[\s\S]*?return 0/.test(del), 'owners (incl. anon owners) delete free on API');
assert(html.includes("account:anonymous") || html.includes("account:registered"), 'posts tag account type');
assert(html.includes('rs_linked_anon'), 'register links anon history');
assert(html.includes('function canDeletePostAsOwner'), 'owner delete helper');
assert(html.includes('function universalDeleteButtonHtml'), 'universal delete on every surface');
assert(html.includes('PENDING GAME TASKS'), 'pending tasks visible');

console.log('\nAnon publish/delete checks passed');
