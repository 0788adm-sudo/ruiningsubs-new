#!/usr/bin/env node
/**
 * Explore map preview + search UX — markup and helpers only.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(html.indexOf('id="explore-map-preview"') >= 0, 'Explore map preview container');
assert(html.indexOf('explore-map-preview-hit') >= 0, 'read-only hit overlay');
assert(html.indexOf('btn-explore-open-map') >= 0, 'Open Map button');
assert(html.indexOf('window.refreshExploreMapPreview') >= 0, 'preview refresher');
assert(html.indexOf('function redrawPreviewMarkers') >= 0, 'preview markers reuse pins');
assert(html.indexOf("showPanel('map')") >= 0, 'full map still opens via showPanel map');
assert(/one pin per account/i.test(html), 'one pin per account rule kept');

assert(html.indexOf('id="search-results" class="explore-search-results"') >= 0, 'results sit under search bar');
assert((html.match(/id="search-results"/g) || []).length === 1, 'exactly one search-results box');
assert(html.indexOf('function clearExploreSearch') >= 0, 'clear search helper');
assert(html.indexOf('No results found') >= 0, 'empty-state copy');
assert(html.indexOf('scrollToExploreResults') >= 0, 'auto-scroll to results');
assert(html.indexOf('id="explore-browse"') >= 0, 'browse block below results');
assert(html.indexOf('setExploreBrowseHidden') >= 0, 'hides coins/tools while searching');

// Must not remove core panels / tools.
['panel-wall', 'panel-feed', 'panel-goontok', 'openCoinShop', 'openGoonTok', 'saveMapPin'].forEach(function (needle) {
  assert(html.indexOf(needle) >= 0, 'kept ' + needle);
});

console.log('OK · explore map + search');
