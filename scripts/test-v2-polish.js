#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'extend.js'), 'utf8');
function assert(c, m){ if(!c) throw new Error(m); console.log('PASS · '+m); }

assert(html.includes('home-strip-card'), 'home strip cards');
assert(html.includes('data-home-strip="1"'), 'home strip data attr');
assert(html.includes('extendedFeedRank'), 'extended ranking');
assert(html.includes('syncExtendedPanel'), 'extended panel sync');
assert(html.includes("gt('expires_at'"), 'loads active timed posts from supabase');
assert(html.includes('/api/extend'), 'uses server extend API');
assert(html.includes('EXTEND_COOLDOWN_MS=6*60*60*1000') || html.includes('6*60*60*1000; // 6h'), '6h extend cooldown');
assert(html.includes('EXTEND_ADD_MINUTES=360'), 'extend adds fixed +6h');
assert(html.includes('Add <strong style="color:var(--orange)">6h</strong> of visibility'), 'extend modal English +6h');
assert(html.includes('Confirm · +6h'), 'confirm +6h CTA');
assert(html.includes('You can extend again in '), 'English cooldown copy');
assert(!html.includes('Puedes volver a extender'), 'no Spanish cooldown copy');
assert(html.includes('Telegram · @mastersan01') || html.includes('t.me/mastersan01'), 'custom exposure telegram');
assert(html.includes('GT_TARGET=80') || html.includes('GT_PAGE=24'), 'goontok no hard 2-cap target');
assert(html.includes('loadMoreGoonTok'), 'goontok infinite scroll helper');
assert(html.includes('btn-hot') && html.includes('hotBumpWall'), 'HOT controls present');
assert(html.includes("id-archive-actions") && html.includes('HOT'), 'HOT on ID/PEA archive');
assert(html.includes('Delete · $5 / 50 FC'), 'delete price $5/50 FC');
assert(!/Remove — 100 FC/.test(html), 'no stale 100 FC remove price');
assert(html.includes('Promise.all(jobs)') || html.includes('Parallel network'), 'feed loads sources in parallel');
assert(api.includes('EXTEND_MINUTES = 360') || api.includes('EXTEND_MINUTES=360'), 'api fixed +6h');
assert(api.includes('return []') && api.includes('cooldown_board'), 'api soft-fails cooldown board');
assert(api.includes('You can extend again in '), 'api English cooldown message');
assert(api.includes('callSbExtend') || api.includes('sbFetch'), 'api has Supabase extend fallback');
assert(api.includes('ruinexpose.com'), 'api SITE defaults to ruinexpose');
assert(html.includes('extendViaSupabase'), 'SPA Supabase extend fallback');
assert(html.includes('SITE_CANONICAL') && html.includes('ruinexpose.com'), 'SPA canonical site is ruinexpose');
assert(html.includes('Sending delete request'), 'delete request toast-only (no 100% bar)');
assert(html.includes('next in ') || html.includes("toast('Extended · +6h · next in "), 'cooldown countdown toast after extend');
assert(fs.existsSync(path.join(__dirname,'..','migrations','20261101_extend_cooldowns.sql')), 'migration file present');
console.log('\\nAll V2 polish static checks passed');
