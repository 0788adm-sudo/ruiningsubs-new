#!/usr/bin/env node
'use strict';
/**
 * Real view counting — feed/wall scroll impressions, detail open, re-visit.
 */
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(/function displayViews\(n\)\{[\s\S]*?return Number\(n\)\|\|0;/.test(html), 'displayViews is honest (no multiplier)');
assert(!/return n \* 2/.test(html), 'no ×2 view inflation');
assert(html.indexOf('var boost=1200+')<0, 'print videos no longer add fake boost');
assert(html.includes("startViewVisit('wall')"), 'wall panel starts a view visit');
assert(html.includes('if(name===\'wall\'){try{loadNormalFeed()}catch(e){}startViewVisit(\'wall\')}'), 'entering wall rebinds impressions');
assert(html.includes('clearImpression'), 'scroll-away clears impression so re-scroll counts');
assert(html.includes('impressionNodes'), 'impressions target post cards only');
assert(html.includes('article[data-pid], .normal-feed-post[data-pid]'), 'card selectors cover feed + wall');
assert(html.includes('threshold:[0,0.35]'), '35% visible threshold for feed/wall impressions');
assert(html.includes('try{bumpViews(post.id,1)}catch(e){}'), 'opening a post adds a view');
assert(html.includes("startViewVisit('feed')"), 'returning to feed starts a new visit');

// Behavioral model of visit + scroll-away + detail
(function(){
  var visit={feed:1};
  var seen={};
  var views={};
  function key(panel,id){return panel+':'+visit[panel]+':'+id}
  function bump(id){views[id]=(views[id]||0)+1}
  function count(id,panel){
    var k=key(panel,id);
    if(seen[k])return;
    seen[k]=1;bump(id);
  }
  function clear(id,panel){delete seen[key(panel,id)]}
  function start(panel){visit[panel]=(visit[panel]||1)+1}

  // Scroll into view on feed
  count('p1','feed');
  assert(views.p1===1, 'feed scroll-in → 1 view');
  count('p1','feed');
  assert(views.p1===1, 'same visit does not double-count while still visible');

  // Scroll away then back
  clear('p1','feed');
  count('p1','feed');
  assert(views.p1===2, 'scroll away + back → another view');

  // Open post
  bump('p1');
  assert(views.p1===3, 'open detail → another view');

  // Leave feed and come back
  start('feed');
  count('p1','feed');
  assert(views.p1===4, 'return to feed → another view');
})();

console.log('\nReal view counting checks passed');
