#!/usr/bin/env node
'use strict';
/**
 * EXTENDED vs ALL POSTS chrome separation:
 * - Stories only on Extended
 * - All Posts drops header/Share/+Post/Stories
 * - Extended keeps original 2-col posts; All Posts keeps 2-col grid
 * - Floating switch retained
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

var feed = html.slice(html.indexOf('id="panel-feed"'), html.indexOf('id="panel-detail"'));
var wall = html.slice(html.indexOf('id="panel-wall"'), html.indexOf('id="panel-extended"'));

// All Posts removals
assert(wall.indexOf('class="wall-head"') < 0, 'no All Posts LIVE header');
assert(wall.indexOf('＋ Post') < 0 && wall.indexOf('btn-create-normal-post-explore') < 0, 'no All Posts + Post');
assert(!/copySectionLink\(['"]wall['"]/.test(wall), 'no All Posts Share');
assert(wall.indexOf('id="wall-stories"') < 0, 'no Stories in All Posts');

// All Posts kept
assert(wall.includes('id="wall-search"'), 'All Posts search');
assert(wall.includes('id="wall-hot-slot"') && html.includes('PHOTOS OF THE DAY'), 'Photos of the Day');
assert(wall.includes('id="explore-normal-posts"'), 'All Posts grid');
assert(/#explore-normal-posts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(html), 'All Posts 2-col');
assert(wall.includes('data-wall-filter="all"') && wall.includes('data-wall-filter="tasks"'), 'All Posts filters');

// Extended Stories + compact sort head
assert(feed.includes('id="home-random-strip"'), 'Stories strip on Extended');
assert(feed.includes('id="feed-search"') && feed.includes('feed-gender-filter'), 'Extended search + filters');
assert(feed.includes('feed-sort-row') && feed.includes('Newest') && feed.includes('Most Time') && feed.includes('Ending Soon'), 'Extended sort chips');
assert(feed.includes('id="featured-slot"') && feed.includes('id="posts-container"'), 'Spotlight + Extended posts');
assert(!/copySectionLink\(['"]extend['"]/.test(feed), 'Extended Share row removed');
assert(/#posts-container\{display:grid;grid-template-columns:1fr 1fr/.test(html), 'Extended original 2-column posts');

// Stories paint target
assert(html.includes("getElementById('home-random-strip')"), 'Stories paint Extended strip');
assert(!/getElementById\('wall-stories'\)/.test(html), 'Stories do not paint All Posts');

// Floating switch
assert(html.includes('id="feed-float-switch"'), 'floating switch kept');
assert((html.match(/id="feed-float-switch"/g) || []).length === 1, 'single floating switch');

console.log('\nFeed separation checks passed');
