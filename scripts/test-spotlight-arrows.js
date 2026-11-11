#!/usr/bin/env node
'use strict';
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(cond,msg){ if(!cond){ console.error('FAIL:',msg); process.exit(1);} console.log('PASS ·',msg); }

assert(/\.feat-carousel\{[^}]*overflow:hidden/.test(html), 'Spotlight carousel overflow hidden (no iOS scroll-snap steal)');
assert(html.includes('touch-action:pan-y'), 'Spotlight / galleries prefer vertical pan');
assert(html.includes('feat-nav') && html.includes('feat-prev') && html.includes('feat-next'), 'Spotlight prev/next arrow buttons');
assert(html.includes('function featCarouselStep') && html.includes('function featCarouselGo'), 'Spotlight arrow step helpers');
assert(html.includes('feat-track'), 'Spotlight uses transform track');
assert(!/\.feat-carousel\{[^}]*overflow-x:auto/.test(html), 'Legacy overflow-x:auto carousel removed');
assert(!/\.feat-carousel\{[^}]*scroll-snap-type:x mandatory/.test(html), 'Legacy scroll-snap-x removed from Spotlight');
assert(html.includes('Math.abs(dx)<Math.abs(dy)*1.6'), 'Swipe requires horizontal dominance so scroll does not jump photos');
assert(html.includes('featCarouselStep(-1') && html.includes('featCarouselStep(1'), 'Arrow onclick wires step helpers');

console.log('\nSpotlight arrow / anti-jump checks passed');
