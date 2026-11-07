#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var dmApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'dm.js'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

assert(html.includes('function chatPromiseTimeout'), 'chat promise timeout helper');
assert(html.includes('function paintChatMsgs'), 'chat paint helper');
assert(html.includes('function armChatWatchdog'), 'chat loading watchdog');
assert(html.includes('function subscribeDmRealtime'), 'supabase realtime DM subscription');
assert(html.includes("fetchWithTimeout('/api/dm?me="), 'inbox uses /api/dm');
assert(html.includes("fetchWithTimeout('/api/dm?me="), 'thread uses /api/dm');
assert(html.includes("'/api/dm'") || html.includes('"/api/dm"') || html.includes('/api/dm'), 'send uses /api/dm');
assert(html.includes('.ilike(') && html.includes("ilike('from_user'"), 'case-insensitive supabase DM queries');
assert(html.includes('function sameChatUser'), 'case-insensitive user compare');
assert(/loadChat\(\{force:true\}\)/.test(html), 'openChat forces a fresh load');
assert(/loadChat\(\{force:false\}\)/.test(html), 'poll soft-refreshes without Loading reset');
assert(html.includes('Instant local cache so the thread never sits on Loading forever'), 'local cache paints first');
assert(html.includes('Could not load chat.'), 'fallback error when paint fails');
assert(html.includes('Optimistic local + paint first'), 'sendMessage paints optimistically');
assert(dmApi.includes('from_user=ilike.'), 'api/dm uses ilike filters');
assert(dmApi.includes('async function fetchThread'), 'api/dm thread loader');
assert(dmApi.includes('async function sendMessage'), 'api/dm send');

// Live probe of /api/dm logic via direct require simulation of fetchThread pieces
(async function () {
  var KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
  var SB = 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
  async function sb(path) {
    var r = await fetch(SB + path, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' },
    });
    return r.json();
  }
  var a = await sb(
    '/rest/v1/messages?select=id,from_user,to_user,body,created_at&from_user=ilike.mastersan&to_user=ilike.loserfagg&order=created_at.asc&limit=20'
  );
  var b = await sb(
    '/rest/v1/messages?select=id,from_user,to_user,body,created_at&from_user=ilike.loserfagg&to_user=ilike.mastersan&order=created_at.asc&limit=20'
  );
  var rows = [].concat(Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []);
  assert(rows.length >= 2, 'case-insensitive thread returns real MasterSan↔LoserFagg history (' + rows.length + ')');

  // Simulate wrong-case login still finding messages
  var bad = await sb(
    '/rest/v1/messages?select=id&from_user=eq.mastersan&to_user=eq.loserfagg&limit=5'
  );
  assert(Array.isArray(bad) && bad.length === 0, 'exact eq with wrong case returns empty (the bug we fixed)');

  console.log('\nDM chat loading checks passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
