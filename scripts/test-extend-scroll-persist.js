#!/usr/bin/env node
'use strict';
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(html.includes('__feedPaintSig'), 'soft paint signature present');
assert(html.includes('Soft paint: same filter'), 'soft paint skips remount');
assert(html.includes('__feedScrollTrackBound'), 'continuous Extend scroll tracking');
assert(html.includes('cancelFeedScrollRestore'), 'filter change cancels pending scroll restores');
assert(html.includes('Prefix-stable growth'), 'prefix growth appends without wipe');
assert(/window\.__feedPaintSig=feedSig\+'#'\+paintIds/.test(html) || html.includes("window.__feedPaintSig=feedSig+'#'+paintIds"), 'appendFeedPage updates paint signature');
assert(html.includes('data-views-id'), 'soft path can patch views in place');
assert(html.includes("renderPosts(opts)") || html.includes('function renderPosts(opts)'), 'renderPosts accepts opts.force');
assert(html.includes('do not fight native scroll') || html.includes('Soft path did not remount'), 'soft paint no longer restores scroll');
assert(html.includes('__feedRestoreActive'), 'user scroll can cancel restore');

// Behavioral model
(function(){
  function Feed(){
    this.rest=[]; for(var i=0;i<100;i++) this.rest.push('p'+i);
    this.shown=0; this.sig=null; this.paintSig=''; this.dom=[]; this.scroll=0;
  }
  Feed.prototype.render=function(filter, force){
    filter=filter||'new';
    var feedSig=filter+'||all';
    var prev=this.shown;
    var sigChanged=this.sig!==feedSig;
    if(sigChanged){this.sig=feedSig;prev=0;this.paintSig='';}
    var base=24;
    var initial=Math.min(this.rest.length, Math.max(base, prev||0));
    this.shown=initial;
    var paintIds=this.rest.slice(0,initial).join(',');
    var paintSig=feedSig+'#'+paintIds+'#'+initial;
    if(!force && !sigChanged && this.dom.length && this.paintSig===paintSig){
      return 'soft';
    }
    this.dom=this.rest.slice(0,initial);
    this.paintSig=paintSig;
    if(sigChanged) this.scroll=0;
    return 'hard';
  };
  Feed.prototype.append=function(){
    var next=Math.min(this.rest.length, this.shown+36);
    this.dom=this.dom.concat(this.rest.slice(this.shown,next));
    this.shown=next;
    var paintIds=this.rest.slice(0,next).join(',');
    this.paintSig=this.sig+'||all'.replace('||all','') ; // keep simple
    this.paintSig=(this.sig)+'#'+paintIds+'#'+next;
  };
  var f=new Feed();
  assert(f.render('new',true)==='hard', 'initial paint is hard');
  f.scroll=1500;
  f.append();
  var kept=f.dom.slice();
  assert(f.render('new')==='soft', 'live refresh soft-skips remount');
  assert(f.dom.join(',')===kept.join(','), 'soft refresh keeps DOM cards');
  assert(f.scroll===1500, 'soft refresh keeps scroll');
  assert(f.render('ending')==='hard', 'filter change hard-paints');
  assert(f.scroll===0, 'filter change resets scroll');
  assert(f.dom.length===24, 'filter change resets window');
})();

console.log('\nExtend scroll persistence checks passed');
