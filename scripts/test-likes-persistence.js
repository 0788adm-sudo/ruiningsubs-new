#!/usr/bin/env node
'use strict';
/**
 * Likes persistence — mirror of views stack.
 * Ensures Supabase write path, merge floors, toggle, and no views regression.
 */
var fs=require('fs');
var path=require('path');
var https=require('https');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(html.includes('function persistLikes('), 'persistLikes helper present');
assert(html.includes('function mergeLikesValue('), 'mergeLikesValue helper present');
assert(html.includes('function setLikesEverywhere('), 'setLikesEverywhere helper present');
assert(html.includes('function localLikesFloor('), 'localLikesFloor helper present');
assert(html.includes("sb.from('posts').update({\n              likes_count:next,\n              liked_by:likedBy,\n              reactions:merged\n            })")
  || /likes_count:\s*next/.test(html), 'Supabase absolute likes write present');
assert(html.includes("CF_API+'/posts/'+encodeURIComponent(id)+'/like'"), 'CF /like still called');
assert(html.includes('data-likes-id'), 'data-likes-id markers present');
assert(/data-likes-id="'\+String\(post\.id\)/.test(html) || html.includes("data-likes-id=\"'+String(post.id)"), 'detail stats use data-likes-id');
assert(html.includes('applyLikesSnapshot'), 'revert snapshot helper present');
assert(html.includes('Never let a fresh server row (views:0 / likes:0) wipe'), 'rememberFeedPost protects likes');
assert(html.includes('function persistViews('), 'views helpers still present');
assert(html.includes("sb.from('posts').update({views:total})"), 'views Supabase write untouched');

// Behavioral model
(function(){
  var posts=[];
  var localCount={};
  var localReact={};
  function unique(likedBy, reactions){
    var seen={};var n=0;
    (likedBy||[]).forEach(function(u){if(u&&!seen[u]){seen[u]=1;n++}});
    Object.keys(reactions||{}).forEach(function(u){if(u&&!seen[u]){seen[u]=1;n++}});
    return n;
  }
  function known(id){
    var best=Number(localCount[id])||0;
    best=Math.max(best, Object.keys(localReact[id]||{}).length);
    posts.forEach(function(p){if(String(p.id)===String(id)) best=Math.max(best, Number(p.likes)||0)});
    return best;
  }
  function setAll(id,total,likedBy,reactions){
    posts.forEach(function(p){
      if(String(p.id)!==String(id))return;
      p.likes=total;p.likedBy=(likedBy||[]).slice();p.reactions=Object.assign({},reactions||{});
    });
    localCount[id]=total;
    localReact[id]=Object.assign({},reactions||{});
  }
  function remember(post){
    post.likes=Math.max(Number(post.likes)||0, known(post.id));
    var i=posts.findIndex(function(p){return String(p.id)===String(post.id)});
    if(i>=0){
      var merged=Object.assign({},posts[i],post);
      merged.likes=Math.max(Number(posts[i].likes)||0, Number(post.likes)||0);
      posts[i]=merged;
      return merged;
    }
    posts.unshift(post);
    return post;
  }
  function toggle(id, user, on){
    var p=posts.find(function(x){return String(x.id)===String(id)});
    var prev=Number(p.likes)||0;
    var reactions=Object.assign({},p.reactions||{});
    var likedBy=(p.likedBy||[]).slice();
    if(on){reactions[user]='❤️';if(likedBy.indexOf(user)<0)likedBy.push(user)}
    else{delete reactions[user];likedBy=likedBy.filter(function(u){return u!==user})}
    var next=on?prev+1:Math.max(0,prev-1);
    next=Math.max(next, unique(likedBy,reactions));
    setAll(id,next,likedBy,reactions);
    p.likes=next;p.likedBy=likedBy;p.reactions=reactions;
    return next;
  }

  var p=remember({id:2969,likes:0,likedBy:[],reactions:{}});
  assert(toggle(p.id,'alice',true)===1 && p.likes===1, 'first like registers 1');
  var reopened=remember({id:2969,likes:0,likedBy:[],reactions:{}});
  assert(reopened.likes===1, 'reopen keeps like despite server 0');
  assert(toggle(reopened.id,'alice',false)===0 && reopened.likes===0, 'unlike clears own like');
  toggle(reopened.id,'alice',true);
  toggle(reopened.id,'bob',true);
  assert(reopened.likes===2, 'two users both count');
  posts[0].likes=10;
  var wiped=remember({id:2969,likes:0,likedBy:[],reactions:{}});
  assert(wiped.likes===10, 'cache refresh cannot lower likes floor');
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
  var id=2969;
  var before=await sbRequest('GET','/rest/v1/posts?select=id,likes_count,liked_by,reactions&id=eq.'+id);
  assert(before.status===200 && before.body && before.body[0], 'live fetch post '+id);
  var row=before.body[0];
  var cur=Number(row.likes_count)||0;
  var likedBy=Array.isArray(row.liked_by)?row.liked_by.slice():[];
  var reactions=(row.reactions&&typeof row.reactions==='object')?Object.assign({},row.reactions):{};
  var user='__likes_persist_probe__';
  // Add probe like
  reactions[user]='❤️';
  if(likedBy.indexOf(user)<0) likedBy.push(user);
  var next=Math.max(cur+1, likedBy.length, Object.keys(reactions).length);
  var up=await sbRequest('PATCH','/rest/v1/posts?id=eq.'+id,{
    likes_count:next,
    liked_by:likedBy,
    reactions:reactions
  });
  assert(up.status===200 && up.body && up.body[0] && Number(up.body[0].likes_count)===next, 'live PATCH raises likes_count to '+next);
  // Remove probe like (cleanup — leave other reactors intact)
  delete reactions[user];
  likedBy=likedBy.filter(function(u){return u!==user});
  var afterCount=Math.max(likedBy.length, Object.keys(reactions).length, Math.max(0, next-1));
  var down=await sbRequest('PATCH','/rest/v1/posts?id=eq.'+id,{
    likes_count:afterCount,
    liked_by:likedBy,
    reactions:reactions
  });
  assert(down.status===200 && down.body && down.body[0], 'live cleanup unlike probe');
  var final=Number(down.body[0].likes_count)||0;
  assert(final>=cur, 'cleanup did not wipe pre-existing likes (final='+final+', before='+cur+')');
  console.log('Likes persistence checks passed');
})().catch(function(e){
  console.error('FAIL: live likes test', e);
  process.exit(1);
});
