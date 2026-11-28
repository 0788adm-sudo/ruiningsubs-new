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
  'feed-mode-tabs',
  'All Posts',
  'btn-create-normal-post-explore',
  'id="wall-search"',
  'id="wall-filter-bar"',
  'id="wall-sort-bar"',
  'id="explore-normal-posts"'
];
var idxs = markers.map(function (m) { return wall.indexOf(m); });
assert(idxs.every(function (n) { return n >= 0; }), 'all Wall order markers present');
assert(
  idxs.slice().sort(function (a, b) { return a - b; }).join(',') === idxs.join(','),
  'Wall element order: tabs → title → Post → search → filters → sort → feed'
);
assert(wall.indexOf('id="wall-search"') < wall.indexOf('id="wall-filter-bar"'), 'search above filters');
assert(wall.indexOf('data-wall-filter="all"') < wall.indexOf('data-wall-filter="tasks"'), 'ALL before GAMES');
assert(wall.indexOf('data-wall-filter="tasks"') < wall.indexOf('data-wall-filter="id"'), 'GAMES before ID');
assert(wall.indexOf('data-wall-filter="id"') < wall.indexOf('data-wall-filter="pea"'), 'ID before PEA');
assert(wall.indexOf('data-wall-filter="pea"') < wall.indexOf('data-wall-filter="normal"'), 'PEA before REGULAR');
assert(wall.indexOf('data-wall-filter="normal"') < wall.indexOf('data-wall-filter="timed"'), 'REGULAR before TIMED');
assert(wall.indexOf('id="wall-sort-bar"') < wall.indexOf('id="explore-normal-posts"'), 'sort bar is above publications');
assert((wall.match(/id="wall-sort-bar"/g) || []).length === 1, 'sorting controls not duplicated');
assert(wall.includes('>ALL<') && wall.includes('>GAMES<') && wall.includes('>TIMED POSTS<'), 'six-filter labels');

// Wall + Post opens permanent composer
assert(html.includes('onclick="openNormalPostComposer()'), 'Wall + Post calls openNormalPostComposer');
assert(html.includes('function openNormalPostComposer') && html.includes('__wallComposer=true'), 'permanent Wall composer flag');
assert(html.includes('function openExtendPostComposer') && html.includes('setExposurePostMode'), 'Extend composer helper');
assert(
  html.includes("pid==='panel-wall'") && html.includes('openNormalPostComposer'),
  'bottom + on Wall opens permanent composer'
);

console.log('\nWall mobile UI checks passed');
