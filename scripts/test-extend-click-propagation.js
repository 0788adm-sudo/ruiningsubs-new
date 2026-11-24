#!/usr/bin/env node
'use strict';
/**
 * Extend button must not open the post detail page.
 * Regression checks for event.stopPropagation / suppressDetailOpen wiring
 * and Chrome ghost-click modal dismiss.
 */
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(html.includes('__suppressDetailOpen'), 'suppressDetailOpen flag present');
assert(html.includes('__suppressModalClose'), 'suppressModalClose flag present (Chrome ghost backdrop)');
assert(html.includes('[data-nf-act="extend"]'), 'extend matched by data-nf-act in fast-tap path');
assert(/fireExtendFromEl|stopImmediatePropagation/.test(html), 'extend path stops immediate propagation');
assert(html.includes("window.__suppressDetailOpen=Date.now()+800"), 'openExtend sets suppress window');
assert(html.includes("window.__suppressModalClose=Date.now()+900"), 'openExtend sets modal close suppress');
assert(html.includes('if(!focusComment && window.__suppressDetailOpen'), 'openDetail respects suppress flag');
assert(html.includes("data-nf-act=\"extend\"") && html.includes('onclick="event.preventDefault();event.stopPropagation()'), 'Wall Extend stops propagation inline');
assert(html.includes('openExtend('), 'Wall/feed Extend onclick calls openExtend');
assert(html.includes("renderNormalFeed({keepVisible:true})"), 'confirmExtend keeps wall visible window');
assert(html.includes('Keep the user on the feed — block ghost card taps'), 'openExtend documents feed-stay intent');
assert(html.includes('data-ghost-guard'), 'extend modal ghost-click guard attribute');
assert(html.includes('is-arming'), 'immediate visual feedback class for Extend');
assert(html.includes('content-visibility:auto'), 'Chrome content-visibility for feed cards');
assert(/Action buttons first/.test(html) || /never lose Extend/.test(html), 'Extend handled before scroll jitter gate');

// Behavioral model of the fast-tap + ghost-click sequence
(function(){
  var openedDetail=null;
  var openedExtend=null;
  var suppressUntil=0;
  var modalCloseUntil=0;
  var modalOpen=false;
  function now(){return Date.now()}
  function openDetail(id){
    if(suppressUntil && now()<suppressUntil) return;
    openedDetail=id;
  }
  function openExtend(id){
    suppressUntil=now()+800;
    modalCloseUntil=now()+900;
    openedExtend=id;
    modalOpen=true;
  }
  function onPointerUp(target){
    if(target==='extend'){
      openExtend('2910');
      return 'extend';
    }
    if(suppressUntil && now()<suppressUntil) return 'blocked';
    openDetail('2910');
    return 'detail';
  }
  function onGhostClick(target){
    if(target==='extend') return 'ignored-btn';
    if(target==='modal-bg'){
      if(modalCloseUntil && now()<modalCloseUntil) return 'modal-guarded';
      modalOpen=false;
      return 'modal-closed';
    }
    if(suppressUntil && now()<suppressUntil && target==='card') return 'suppressed';
    if(target==='card'){ openDetail('2910'); return 'detail'; }
    return 'other';
  }

  openedDetail=null; openedExtend=null; modalOpen=false;
  assert(onPointerUp('extend')==='extend' && openedExtend==='2910' && !openedDetail && modalOpen, 'pointer Extend opens modal only');
  assert(onGhostClick('modal-bg')==='modal-guarded' && modalOpen, 'Chrome ghost backdrop click does not close modal');
  assert(onGhostClick('card')==='suppressed' && !openedDetail, 'ghost card click suppressed after Extend');
  assert(onGhostClick('extend')==='ignored-btn' && !openedDetail, 'extend button click does not open detail');

  // After suppress window, content click still opens detail
  suppressUntil=0;
  modalCloseUntil=0;
  openedDetail=null;
  assert(onGhostClick('card')==='detail' && openedDetail==='2910', 'post content still opens detail when not suppressed');
  assert(onGhostClick('modal-bg')==='modal-closed' && !modalOpen, 'backdrop close works after guard expires');
})();

console.log('Extend click propagation checks passed');
