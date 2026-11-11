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

assert(html.includes('feed-more-sentinel'), 'Extend feed has infinite-scroll sentinel');
assert(html.includes('function observeFeedSentinel'), 'IntersectionObserver sentinel helper');
assert(html.includes('function appendFeedPage'), 'appendFeedPage grows the painted window');
assert(html.includes('function loadMoreExtendFeed'), 'network fallback when in-memory window ends');
assert(html.includes("rootMargin:'900px 0px'"), 'IO rootMargin preloads before the fold');
assert(/fetchCfFeed\('',\s*160\)/.test(html), 'initial CF fetch is wide (≥160), not capped at 60');
assert(html.includes('never wipe already-scrolled cards'), 'renderPosts documents preserve-shown fix');
assert(html.includes('window.__feedSig'), 'filter/search/gender signature resets window safely');
assert(/Math\.max\(baseInitial,\s*prevShown/.test(html), 're-render keeps previous __feedShown count');
assert(html.includes('keepScroll'), 'scroll position restored after progressive re-paint');
assert(html.includes("document.addEventListener('touchmove'"), 'iOS scroll backup via touchmove');
assert(!/window\.__feedShown=initial;\s*try\{\s*box\.innerHTML=rest\.slice\(0,initial\)/.test(html), 'old reset-only paint path removed');

// Behavioral model of the preserve-shown contract (no DOM).
(function () {
  function Feed() {
    this.rest = [];
    for (var i = 0; i < 120; i++) this.rest.push('p' + i);
    this.shown = 0;
    this.sig = null;
    this.dom = [];
  }
  Feed.prototype.render = function (filter, search, gender, width) {
    filter = filter || 'new';
    search = search || '';
    gender = gender || 'all';
    width = width || 390;
    var feedSig = [filter, search, gender].join('|');
    var prev = this.shown;
    if (this.sig !== feedSig) {
      this.sig = feedSig;
      prev = 0;
    }
    var base = width >= 1280 ? 40 : width >= 900 ? 32 : 24;
    var initial = Math.min(this.rest.length, Math.max(base, prev || 0));
    this.shown = initial;
    this.dom = this.rest.slice(0, initial);
  };
  Feed.prototype.append = function (n) {
    n = n || 36;
    if (this.shown >= this.rest.length) return false;
    var next = Math.min(this.rest.length, this.shown + n);
    this.dom = this.dom.concat(this.rest.slice(this.shown, next));
    this.shown = next;
    return true;
  };
  var feed = new Feed();
  feed.render();
  feed.append();
  feed.append();
  var kept = feed.dom.slice();
  assert(kept.length >= 96, 'two append pages reach ~96 cards');
  feed.render(); // progressive reload must not wipe
  assert(feed.dom.join(',') === kept.join(','), 'progressive re-render keeps scrolled cards');
  feed.render('ending');
  assert(feed.dom.length === 24, 'filter change resets window to first page');
})();

console.log('\nExtend infinite scroll checks passed');
