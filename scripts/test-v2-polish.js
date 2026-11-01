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
assert(html.includes('EXTEND_COOLDOWN_MS'), 'hourly cooldown constant');
assert(html.includes('EXTEND_ADD_MINUTES') && html.includes('1440'), 'extend adds 1 day (1440m)');
assert(html.includes('fmtExtendCountdown') && html.includes("padStart(2,'0')"), 'cooldown MM:SS countdown');
assert(html.includes('Add <strong style="color:var(--orange)">1 day</strong> of visibility'), 'extend modal copy +1 day');
assert(html.includes('Promise.all(jobs)') || html.includes('Parallel network'), 'feed loads sources in parallel');
assert(/object-fit:contain/i.test(html) && html.includes('goontok'), 'goontok contain');
assert(html.includes('id-archive-card'), 'id archive cards');
assert(html.includes('grid-template-columns:repeat(4,minmax(0, 1fr))') || html.includes('grid-template-columns:repeat(4,minmax(0,1fr))'), '4-col desktop gallery css');
assert(html.includes('focusMapSelection'), 'map select helper');
assert(html.includes('Selected location'), 'map selected label');
assert(html.includes('Confirm location'), 'map confirm CTA');
assert(api.includes('COOLDOWN_MS') && api.includes('__EXTEND_COOLDOWN__'), 'api stores cooldown server-side');
assert(api.includes("user_id + post_id") || api.includes('cooldownKey(user, postId)'), 'api keys by user+post');
assert(fs.existsSync(path.join(__dirname,'..','migrations','20261101_extend_cooldowns.sql')), 'migration file present');
console.log('\\nAll V2 polish static checks passed');
