#!/usr/bin/env node
/**
 * Explore Coins promo card — replaces ALL POSTS entry under search.
 * Opens existing openCoinShop(); economy unchanged ($5→60, actions 10 each).
 */
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL · ' + msg);
  } else {
    console.log('PASS · ' + msg);
  }
}

var exploreStart = html.indexOf('id="panel-explore"');
var exploreEnd = html.indexOf('id="panel-profile"', exploreStart);
assert(exploreStart >= 0 && exploreEnd > exploreStart, 'Explore panel bounds');
var explore = html.slice(exploreStart, exploreEnd);

assert(!/explore-allposts-card|btn-explore-allposts|Discover all community publications/.test(explore), 'no ALL POSTS card in Explore');
assert(/id="btn-explore-coins-promo"/.test(explore), 'promo button id');
assert(/class="explore-coins-promo"/.test(explore), 'promo card class');
assert(/onclick="openCoinShop\(\)"/.test(explore), 'opens existing coin shop');
assert(/UNLOCK 6 ACTIONS/.test(explore), 'unlock headline');
assert(/60 COINS/.test(explore) && /\$5 USD/.test(explore), '60 Coins · $5 offer');
assert(/Delete · Pin · Unlock Games/.test(explore), 'spend hint line');
assert(/explore-coins-promo-icon/.test(explore) && /explore-card-arrow/.test(explore), 'coin icon + nav arrow');

assert(/\.explore-coins-promo\{/.test(html), 'promo CSS present');
assert(/radial-gradient[\s\S]{0,80}124,58,237/.test(html) && /255,106,0/.test(html), 'purple + orange gradient accents');

// Feed ALL POSTS untouched
assert(html.includes('data-feed-tab="all"') && html.includes('>ALL POSTS<'), 'Feed ALL POSTS tab kept');
assert(html.includes('function openFeedAllPosts'), 'openFeedAllPosts kept');
assert(html.includes('id="panel-wall"') && html.includes('id="explore-normal-posts"'), 'All Posts panel kept');

// Economy unchanged
assert(/usd:\s*5,\s*coins:\s*60/.test(html) || html.indexOf('{usd:5, coins:60') >= 0, '$5 → 60 pack');
assert(/pin:\s*10/.test(html) && /delete:\s*10/.test(html), 'Pin/Delete still 10');
assert(html.includes('function openCoinShop'), 'openCoinShop retained');

// No duplicate Explore → All Posts shortcut
assert(!/btn-explore-allposts/.test(html), 'no duplicate All Posts explore access');

if (failed) {
  console.error('\n' + failed + ' explore coins promo check(s) failed');
  process.exit(1);
}
console.log('\nExplore Coins promo checks passed');
