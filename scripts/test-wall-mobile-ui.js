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

// Permanence notice fully removed
assert(!html.includes('wall-permanence-notice'), 'permanence notice id removed');
assert(!html.includes('Wall posts are permanent.'), 'permanence notice copy removed');

// All Posts chrome: no redundant header / Share / + Post / Stories
var wall = html.slice(html.indexOf('id="panel-wall"'), html.indexOf('id="panel-extended"'));
assert(wall.indexOf('class="wall-head"') < 0, 'All Posts header removed');
assert(wall.indexOf('btn-create-normal-post-explore') < 0, 'All Posts + Post button removed');
assert(wall.indexOf('copySectionLink(\'wall\'') < 0 && wall.indexOf('copySectionLink("wall"') < 0, 'All Posts Share removed');
assert(wall.indexOf('id="wall-stories"') < 0, 'Stories not in All Posts');
assert(wall.includes('id="wall-search"'), 'All Posts search kept');
assert(wall.includes('id="wall-hot-slot"'), 'Photos of the Day kept');
assert(wall.includes('id="wall-filter-bar"') && wall.includes('id="wall-sort-bar"'), 'All Posts filters/sort kept');
assert(wall.includes('id="explore-normal-posts"'), 'All Posts grid container kept');

var markers = [
  'id="wall-search"',
  'id="wall-hot-slot"',
  'id="wall-filter-bar"',
  'id="wall-sort-bar"',
  'id="explore-normal-posts"'
];
var idxs = markers.map(function (m) { return wall.indexOf(m); });
assert(idxs.every(function (n) { return n >= 0; }), 'all Wall order markers present');
assert(
  idxs.slice().sort(function (a, b) { return a - b; }).join(',') === idxs.join(','),
  'Wall element order: search → Photos of the Day → filters → sort → feed'
);
assert(wall.indexOf('feed-mode-tabs') < 0 && wall.indexOf('data-feed-tab') < 0, 'no inline feed tabs in panel-wall');
assert(html.includes('id="feed-float-switch"'), 'floating feed switch present');
assert(wall.indexOf('data-wall-filter="all"') < wall.indexOf('data-wall-filter="tasks"'), 'ALL before GAMES');
assert(wall.indexOf('data-wall-filter="tasks"') < wall.indexOf('data-wall-filter="id"'), 'GAMES before ID');
assert(wall.indexOf('data-wall-filter="id"') < wall.indexOf('data-wall-filter="pea"'), 'ID before PEA');
assert(wall.indexOf('data-wall-filter="pea"') < wall.indexOf('data-wall-filter="normal"'), 'PEA before REGULAR');
assert(wall.indexOf('data-wall-filter="normal"') < wall.indexOf('data-wall-filter="timed"'), 'REGULAR before TIMED');
assert((wall.match(/id="wall-sort-bar"/g) || []).length === 1, 'sorting controls not duplicated');
assert(wall.includes('>ALL<') && wall.includes('>GAMES<') && wall.includes('>TIMED POSTS<'), 'six-filter labels');

// ALL POSTS 2-column grid; EXTENDED single column
assert(/#explore-normal-posts\s*\{[^}]*grid-template-columns:\s*repeat\(2/.test(html), 'All Posts 2-column grid');
assert(html.includes('normal-feed-post-title') && html.includes('normal-feed-post-stats'), 'compact title + stats on All Posts cards');
assert(/#posts-container\{display:grid;grid-template-columns:1fr/.test(html), 'Extended posts single column');
assert(html.includes('id="feed-float-switch"') && html.includes('feed-float-switch'), 'floating feed switch retained');

// Stories exclusive to Extended
assert(html.includes('id="home-random-strip"') && html.includes('function renderWallStories'), 'Stories on Extended strip');
assert(!/getElementById\('wall-stories'\)/.test(html), 'Stories paint no longer targets All Posts');

// Composer still available from bottom + / helpers
assert(html.includes('function openNormalPostComposer') && html.includes('__wallComposer=true'), 'permanent Wall composer flag');
assert(html.includes('function openExtendPostComposer') && html.includes('setExposurePostMode'), 'Extend composer helper');
assert(
  html.includes("pid==='panel-wall'") && html.includes('openNormalPostComposer'),
  'bottom + on Wall opens permanent composer'
);

console.log('\nWall mobile UI checks passed');
