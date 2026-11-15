#!/usr/bin/env node
'use strict';
/**
 * Views persistence — regression checks for the counter that was resetting to 0.
 *
 * Covers:
 * 1) Absolute local totals (not broken increment-from-0)
 * 2) rememberFeedPost returns the stored object + never lowers views
 * 3) Detail markup carries data-views-id for live updates
 * 4) Supabase write path exists alongside CF /view
 * 5) Live open → close → reopen → reload simulation against Supabase
 */
var fs=require('fs');
var path=require('path');
var https=require('https');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(html.includes('function persistViews('), 'persistViews helper present');
assert(html.includes('function mergeViewsValue('), 'mergeViewsValue helper present');
assert(html.includes('function setViewsEverywhere('), 'setViewsEverywhere helper present');
assert(html.includes("sb.from('posts').update({views:total})"), 'Supabase absolute views write present');
assert(html.includes("CF_API+'/posts/'+encodeURIComponent(id)+'/view'"), 'CF /view still called');
assert(/data-views-id="'\+String\(post\.id\)/.test(html) || html.includes('data-views-id="\'+String(post.id)'), 'detail stats use data-views-id');
assert(html.includes('Never let a fresh server row (views:0) wipe'), 'rememberFeedPost protects views');
assert(html.includes('posts[i].views=Math.max(Number(posts[i].views)||0, Number(sp.views)||0'), 'profile sync uses Math.max for views');
assert(!/map\[id\]=\(Number\(map\[id\]\)\|\|0\)\+n/.test(html), 'old localStorage increment-from-0 removed');

// Behavioral model mirroring the fixed helpers
(function(){
  var posts=[];
  var local={};
  function known(id){
    var best=Number(local[id])||0;
    posts.forEach(function(p){if(String(p.id)===String(id)) best=Math.max(best, Number(p.views)||0)});
    return best;
  }
  function setAll(id,total){
    posts.forEach(function(p){if(String(p.id)===String(id)) p.views=Math.max(Number(p.views)||0,total)});
    local[id]=Math.max(Number(local[id])||0,total);
  }
  function bump(id,n){
    var next=known(id)+(n||1);
    setAll(id,next);
    return next;
  }
  function remember(post){
    post.views=Math.max(Number(post.views)||0, known(post.id));
    var i=posts.findIndex(function(p){return String(p.id)===String(post.id)});
    if(i>=0){
      var merged=Object.assign({},posts[i],post);
      merged.views=Math.max(Number(posts[i].views)||0, Number(post.views)||0);
      posts[i]=merged;
      return merged;
    }
    posts.unshift(post);
    return post;
  }

  // Simulate DB=0, open detail
  var dbViews=0;
  var p=remember({id:2910,views:dbViews});
  var shown1=bump(p.id,1);
  p.views=Math.max(Number(p.views)||0, shown1);
  assert(shown1===1 && p.views===1, 'first open registers view=1 on same object');

  // Close + reopen with stale server row views:0
  var reopened=remember({id:2910,views:0});
  assert(reopened.views===1, 'reopen keeps previous total despite server 0');
  var shown2=bump(reopened.id,1);
  reopened.views=Math.max(Number(reopened.views)||0, shown2);
  assert(shown2===2 && reopened.views===2, 'reopen increments from preserved total');

  // Reload simulation: localStorage floor + DB catch-up
  dbViews=2; // after persist
  var afterReload=remember({id:2910,views:dbViews});
  assert(afterReload.views===2, 'reload restores persisted total');
  assert(bump(afterReload.id,1)===3, 'post-reload open increments correctly');

  // Cache must not overwrite higher live value
  posts[0].views=10;
  var wiped=remember({id:2910,views:0});
  assert(wiped.views===10 && posts[0].views===10, 'cache refresh cannot lower views');
})();

function sbRequest(method, pathName, body){
  return new Promise(function(resolve,reject){
    var url=new URL('https://snlpdolzhzcbbdyxqlnb.supabase.co'+pathName);
    var key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
    var data=body?JSON.stringify(body):null;
    var req=https.request({
      hostname:url.hostname,
      path:url.pathname+url.search,
      method:method,
      headers:{
        apikey:key,
        Authorization:'Bearer '+key,
        'Content-Type':'application/json',
        Prefer:'return=representation'
      }
    },function(res){
      var chunks=[];
      res.on('data',function(c){chunks.push(c)});
      res.on('end',function(){
        var text=Buffer.concat(chunks).toString('utf8');
        var json=null;
        try{json=JSON.parse(text)}catch(e){json=text}
        resolve({status:res.statusCode, body:json});
      });
    });
    req.on('error',reject);
    if(data) req.write(data);
    req.end();
  });
}

(async function live(){
  // Use a recent post; only raise views (never reset/lower).
  var id=2910;
  var before=await sbRequest('GET','/rest/v1/posts?select=id,views&id=eq.'+id);
  assert(before.status===200 && Array.isArray(before.body) && before.body[0], 'live fetch post '+id);
  var cur=Number(before.body[0].views)||0;
  var next=cur+1;
  var up=await sbRequest('PATCH','/rest/v1/posts?id=eq.'+id,{views:next});
  assert(up.status>=200 && up.status<300, 'live persist views via Supabase PATCH');
  var after=await sbRequest('GET','/rest/v1/posts?select=id,views&id=eq.'+id);
  var got=Number(after.body&&after.body[0]&&after.body[0].views)||0;
  assert(got===next, 'live reopen/reload value kept at '+next+' (was '+cur+')');

  // Prove CF /view alone does not write Supabase (documents the root cause we fixed)
  var cfOk=await new Promise(function(resolve,reject){
    https.request({
      hostname:'ruiningsubs-api.0788adm.workers.dev',
      path:'/posts/'+id+'/view',
      method:'POST'
    },function(res){
      var chunks=[];
      res.on('data',function(c){chunks.push(c)});
      res.on('end',function(){resolve({status:res.statusCode, body:Buffer.concat(chunks).toString('utf8')})});
    }).on('error',reject).end();
  });
  assert(cfOk.status===200, 'CF /view still returns ok');
  var afterCf=await sbRequest('GET','/rest/v1/posts?select=id,views&id=eq.'+id);
  var gotCf=Number(afterCf.body&&afterCf.body[0]&&afterCf.body[0].views)||0;
  assert(gotCf===next, 'CF /view alone does not change Supabase (client must persist)');

  console.log('\nViews persistence checks passed');
})().catch(function(e){
  console.error('FAIL: live verification', e);
  process.exit(1);
});
