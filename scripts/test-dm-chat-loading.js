#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

assert(html.includes('function chatPromiseTimeout'), 'chat promise timeout helper');
assert(html.includes('function paintChatMsgs'), 'chat paint helper');
assert(html.includes("fetchWithTimeout(CF_API+'/posts/'+encodeURIComponent(threadKey)+'/comments'"), 'CF comments use timeout');
assert(/loadChat\(\{force:true\}\)/.test(html), 'openChat forces a fresh load');
assert(/loadChat\(\{force:false\}\)/.test(html), 'poll soft-refreshes without Loading reset');
assert(html.includes('Instant local cache so the thread never sits on Loading forever'), 'local cache paints first');
assert(html.includes('Could not load chat. Try again.'), 'fallback error when paint fails');
assert(!/var tok=\+\+window\.__chatLoadTok;\s*box\.setAttribute\('data-who',who\);\s*if\(!box\.innerHTML \|\| box\.getAttribute\('data-who'\)!==who\) box\.innerHTML='<div class="empty">Loading…<\/div>';\s*var rows=\[\];\s*try\{\s*if\(sb\)\{\s*var r1=await sb\.from\('messages'\)/.test(html), 'old unbounded loadChat path removed');
assert(html.includes('Optimistic local + paint first'), 'sendMessage paints optimistically');
assert(html.includes("sb.from('messages').insert") && html.includes('chatPromiseTimeout'), 'sendMessage bounds supabase insert');

console.log('\nDM chat loading checks passed');
