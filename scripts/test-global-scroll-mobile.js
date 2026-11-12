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

// 1) Single document scroll root
assert(/html\{[^}]*overflow-y:\s*auto/.test(html), 'html is the primary vertical scroller');
assert(/body\{[^}]*overflow-y:\s*visible/.test(html) || html.includes('body{height:auto;min-height:100%;overflow-x:hidden;overflow-y:visible}'), 'body does not compete as overflow-y:auto');
assert(!/body,html\{touch-action:manipulation\}/.test(html), 'removed root touch-action:manipulation');
assert(html.includes('touch-action:pan-y pinch-zoom') || html.includes('touch-action:pan-y'), 'document allows native vertical pan');

// 2) Wall filter bar allows vertical scroll start
assert(/\.wall-filter-bar\{[^}]*touch-action:\s*pan-x pan-y/.test(html), 'wall filter bar allows pan-y');

// 3) Restore cancel on user scroll / touch
assert(html.includes('cancelFeedScrollRestore'), 'cancelFeedScrollRestore exists');
assert(html.includes('__feedRestoreActive') && html.includes('touchstart'), 'user touch cancels delayed restore');
assert(!html.includes('setTimeout(go,280)'), 'removed multi-shot 280ms restore yank');
assert(html.includes('Soft path did not remount cards') || html.includes('do not fight native scroll'), 'soft paint skips restore');

// 4) Wall soft-paint + append-only infinite scroll
assert(html.includes('function appendWallPage') && html.includes('__wallPaintSig'), 'Wall soft-paint signature + append');
assert(html.includes('Prefix-stable growth') || html.includes('appendWallPage()'), 'Wall append-only growth');
assert(html.includes("loadNormalFeed(false,{quiet:true})") || html.includes('quiet:true'), '18s poll uses quiet Wall refresh');
assert(html.includes('keepVisible') && html.includes('__wallVisible'), 'quiet refresh preserves visible window');
assert(html.includes("renderNormalFeed({force:true})") || html.includes('force:true'), 'category switch force-remounts');

// 5) IO margins tightened
assert(html.includes("rootMargin:'480px 0px'") || html.includes('rootMargin:\'480px 0px\''), 'Extend IO margin reduced');
assert(html.includes("rootMargin:'420px 0px'") || html.includes('rootMargin:\'420px 0px\''), 'Wall IO margin reduced');

// Behavioral model: Wall soft paint keeps scroll depth
(function () {
  function Wall() {
    this.ids = [];
    for (var i = 0; i < 80; i++) this.ids.push('w' + i);
    this.visible = 12;
    this.paintSig = '';
    this.dom = [];
    this.scroll = 0;
    this.filter = 'normal';
  }
  Wall.prototype.sig = function () {
    return this.filter + '|' + this.dom.join(',') + '|' + this.visible;
  };
  Wall.prototype.render = function (force) {
    var paintIds = this.ids.slice(0, this.visible).join(',');
    var paintSig = this.filter + '#' + paintIds + '#' + this.visible;
    if (!force && this.dom.length && this.paintSig === paintSig) {
      return 'soft';
    }
    if (!force && this.dom.length && paintIds.indexOf(this.dom.join(',')) === 0) {
      this.dom = this.ids.slice(0, this.visible);
      this.paintSig = paintSig;
      return 'append';
    }
    this.dom = this.ids.slice(0, this.visible);
    this.paintSig = paintSig;
    if (force) this.scroll = 0;
    return 'hard';
  };
  Wall.prototype.append = function () {
    this.visible = Math.min(this.ids.length, this.visible + 8);
    return this.render(false);
  };
  Wall.prototype.quietRefresh = function () {
    // same ids, keep visible
    return this.render(false);
  };
  var w = new Wall();
  assert(w.render(true) === 'hard', 'initial Wall paint hard');
  w.scroll = 1800;
  assert(w.append() === 'append', 'infinite scroll appends');
  assert(w.scroll === 1800, 'append keeps scroll');
  assert(w.quietRefresh() === 'soft', 'quiet refresh soft-skips');
  assert(w.scroll === 1800, 'quiet refresh keeps scroll');
  w.filter = 'roulette';
  w.visible = 12;
  assert(w.render(true) === 'hard', 'category change hard-paints');
  assert(w.scroll === 0, 'category change resets scroll');
})();

console.log('\nGlobal scroll / mobile checks passed');
