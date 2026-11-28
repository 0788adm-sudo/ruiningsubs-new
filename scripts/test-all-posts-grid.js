#!/usr/bin/env node
'use strict';
/**
 * ALL POSTS 2-column grid presentation — scoped to #explore-normal-posts.
 * EXTENDED (#posts-container) and the floating feed switch must stay intact.
 */
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

assert(html.includes('id="explore-normal-posts"'), 'All Posts container present');
assert(/#explore-normal-posts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(html), '2-column grid for All Posts');
assert(html.includes('function normalFeedPostHtml'), 'card renderer retained');
assert(html.includes('normal-feed-post-title'), 'card title class');
assert(html.includes('normal-feed-post-stats'), 'views/likes stats row');
assert(html.includes("data-nf-act=\"open\"") && html.includes("data-nf-act=\"comment\""), 'open + comment actions');
assert(html.includes("data-nf-act=\"picker\"") && html.includes("data-nf-act=\"save\""), 'like picker + save actions');
assert(html.includes('function openUser') || html.includes('openUser('), 'profile navigation retained');
assert(html.includes('function renderNormalFeed') && html.includes('appendWallPage'), 'infinite scroll path retained');
assert(html.includes('wallImageHtml') || html.includes('feedThumb'), 'thumb helpers retained');
assert(html.includes('object-fit:cover'), 'cover fit for thumbs');

// Categories / filters — ID + PEA unified as id_pea
['all', 'tasks', 'id_pea', 'normal', 'timed'].forEach(function (f) {
  assert(html.includes('data-wall-filter="' + f + '"'), 'filter ' + f + ' retained');
});
assert(!html.includes('data-wall-filter="id"') && !html.includes('data-wall-filter="pea"'), 'separate ID/PEA chips removed');


// EXTENDED untouched structurally
assert(html.includes('id="posts-container"'), 'Extended posts container');
assert(/#posts-container\{display:grid;grid-template-columns:1fr 1fr/.test(html), 'Extended original 2-column posts');
assert(html.includes('id="feed-search"') && html.includes('feed-sort-row'), 'Extended search/sort chrome');
assert(html.includes('id="feed-float-switch"'), 'floating EXTENDED/ALL POSTS switch');
assert((html.match(/id="feed-float-switch"/g) || []).length === 1, 'single floating switch');

// Scope: All Posts card chrome must not rewrite Extended article.post rules as the only grid
assert(html.includes('#explore-normal-posts > article.normal-feed-post'), 'All Posts card rules scoped');
assert(!/#posts-container\s*>\s*article\.normal-feed-post/.test(html), 'does not force normal-feed-post into Extended container');

console.log('\nAll Posts 2-column grid checks passed');
