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

// Compact header classes present
assert(html.includes('class="wall-head"') && html.includes('wall-head-row'), 'compact wall header markup');

// Exact order inside panel-wall
var wall = html.slice(html.indexOf('id="panel-wall"'), html.indexOf('id="panel-extended"'));
var markers = [
  'All Posts',
  'btn-create-normal-post-explore',
  'id="wall-search"',
  'id="wall-topics"',
  'id="wall-stories"',
  'id="wall-hot-slot"',
  'id="wall-filter-bar"',
  'id="wall-sort-bar"',
  'id="explore-normal-posts"'
];
var idxs = markers.map(function (m) { return wall.indexOf(m); });
assert(idxs.every(function (n) { return n >= 0; }), 'all Wall order markers present');
assert(
  idxs.slice().sort(function (a, b) { return a - b; }).join(',') === idxs.join(','),
  'Wall element order: title → Post → search → Topics → Stories → day photos → filters → sort → feed'
);
assert(wall.indexOf('id="wall-search"') < wall.indexOf('id="wall-topics"'), 'search above Topics');
assert(wall.indexOf('id="wall-topics"') < wall.indexOf('id="wall-filter-bar"'), 'Topics above filters');
assert(wall.indexOf('data-wall-filter="all"') < wall.indexOf('data-wall-filter="normal"'), 'All before Posts');
assert(wall.indexOf('data-wall-filter="normal"') < wall.indexOf('data-wall-filter="tasks"'), 'Posts before Games');
assert(wall.indexOf('data-wall-filter="tasks"') < wall.indexOf('data-wall-filter="timed"'), 'Games before Extended');
assert(wall.indexOf('id="wall-sort-bar"') < wall.indexOf('id="explore-normal-posts"'), 'sort bar is above publications');
assert((wall.match(/id="wall-sort-bar"/g) || []).length === 1, 'sorting controls not duplicated');

// Wall + Post opens permanent composer
assert(html.includes('onclick="openNormalPostComposer()'), 'Wall + Post calls openNormalPostComposer');
assert(html.includes('function openNormalPostComposer') && html.includes('__wallComposer=true'), 'permanent Wall composer flag');
assert(html.includes('function openExtendPostComposer') && html.includes('setExposurePostMode'), 'Extend composer helper');
assert(
  html.includes("pid==='panel-wall'") && html.includes('openNormalPostComposer'),
  'bottom + on Wall opens permanent composer'
);

console.log('\nWall mobile UI checks passed');
