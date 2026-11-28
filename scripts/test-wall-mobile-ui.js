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

// Compact header classes present (now inside FEED → ALL POSTS)
assert(html.includes('class="wall-head"') && html.includes('wall-head-row'), 'compact wall header markup');
assert(html.includes('class="wall-tagline"'), 'community tagline class');

// Exact order inside FEED all-posts pane (Stories → day photos → tagline → filters)
var wallStart = html.indexOf('id="feed-all-posts-pane"');
if (wallStart < 0) wallStart = html.indexOf('id="explore-normal-wrap"');
var wallEnd = html.indexOf('id="panel-extended"');
var wall = html.slice(wallStart, wallEnd > wallStart ? wallEnd : wallStart + 20000);
var markers = [
  'All Posts',
  'btn-create-normal-post-explore',
  'id="wall-stories"',
  'id="wall-hot-slot"',
  'It’s the community',
  'id="wall-filter-bar"',
  'btn-wall-generate-id',
  'btn-wall-generate-pea',
  'id="wall-sort-bar"',
  'id="explore-normal-posts"'
];
var idxs = markers.map(function (m) { return wall.indexOf(m); });
assert(idxs.every(function (n) { return n >= 0; }), 'all Wall order markers present');
assert(
  idxs.slice().sort(function (a, b) { return a - b; }).join(',') === idxs.join(','),
  'Wall element order: title → Post → Stories → day photos → tagline → filters → ID/PEA → sort → feed'
);
assert(wall.indexOf('id="wall-stories"') < wall.indexOf('id="wall-hot-slot"'), 'Stories above day photos');
assert(wall.indexOf('id="wall-hot-slot"') < wall.indexOf('It’s the community'), 'day photos above community tagline');
assert(wall.indexOf('It’s the community') < wall.indexOf('id="wall-filter-bar"'), 'tagline above filter nav');
assert(wall.indexOf('data-wall-filter="all"') < wall.indexOf('data-wall-filter="games"'), 'ALL before GAMES');
assert(wall.indexOf('data-wall-filter="games"') < wall.indexOf('data-wall-filter="id"'), 'GAMES before ID');
assert(wall.indexOf('data-wall-filter="id"') < wall.indexOf('data-wall-filter="pea"'), 'ID before PEA');
assert(wall.indexOf('data-wall-filter="pea"') < wall.indexOf('data-wall-filter="normal"'), 'PEA before REGULAR');
assert(wall.indexOf('data-wall-filter="normal"') < wall.indexOf('data-wall-filter="timed"'), 'REGULAR before TIMED');
assert(wall.indexOf('id="wall-sort-bar"') > wall.indexOf('id="wall-hot-slot"'), 'sort bar is below day photos');
assert(wall.indexOf('id="wall-sort-bar"') < wall.indexOf('id="explore-normal-posts"'), 'sort bar is above publications');
assert((wall.match(/id="wall-sort-bar"/g) || []).length === 1, 'sorting controls not duplicated');

// Wall + Post opens permanent composer
assert(html.includes('onclick="openNormalPostComposer()'), 'Wall + Post calls openNormalPostComposer');
assert(html.includes('function openNormalPostComposer') && html.includes('__wallComposer=true'), 'permanent Wall composer flag');
assert(html.includes('function openExtendPostComposer') && html.includes('setExposurePostMode'), 'Extend composer helper');
assert(
  (html.includes("pid==='panel-wall'") || html.includes("currentFeedTab()==='all'")) && html.includes('openNormalPostComposer'),
  'bottom + on All Posts opens permanent composer'
);

console.log('\nWall mobile UI checks passed');
