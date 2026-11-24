#!/usr/bin/env node
'use strict';
/**
 * Static guards for Chrome performance + Extend first-click fixes.
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

assert(html.includes('content-visibility:auto'), 'feed cards use content-visibility');
assert(html.includes('contain-intrinsic-size'), 'intrinsic size for content-visibility');
assert(html.includes('__suppressModalClose'), 'Chrome modal ghost-click suppress');
assert(html.includes('fireExtendFromEl'), 'shared Extend fire helper');
assert(html.includes('is-arming'), 'Extend press visual feedback');
assert(html.includes("document.addEventListener('pointerdown',function(e){") && /addEventListener\('pointerdown',function\(e\)\{[\s\S]*?\},\{passive:true,capture:true\}\)/.test(html), 'fast-tap pointerdown stays passive for Chrome scroll');
assert(html.includes("if(v.textContent!==txt) v.textContent=txt"), 'updateTimers skips unchanged text');
assert(html.includes('requestAnimationFrame(function()') && html.includes('stopAllMedia'), 'nav defers media stop');
assert(html.includes('Action buttons first') || html.includes('never lose Extend'), 'Extend before movement gate');
assert(!/el\.closest\('\.modal-bg[\s\S]{0,80}\.gt-keep/.test(html.split('Action buttons first')[1] || ''), 'gt-keep not excluded before Extend handler');
assert(/\.bottom-nav\{[^}]*z-index:5000/.test(html), 'bottom nav stacks above Explore map hit layer');
assert(/\.explore-map-preview-hit\{[^}]*z-index:2/.test(html), 'map preview hit layer stays local');

console.log('\nChrome perf / Extend guards passed');
