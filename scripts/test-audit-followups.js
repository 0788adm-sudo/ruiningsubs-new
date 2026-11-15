#!/usr/bin/env node
'use strict';
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
var kenny=fs.readFileSync(path.join(__dirname,'..','kenny-touchard.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(html.includes("imgs=imgs.map(function(u){return typeof publicMediaUrl==='function'?publicMediaUrl(u):u}"), 'mergePostImages rewrites via publicMediaUrl');
assert(html.includes("hit.views=Math.max(Number(hit.views)||0, Number(p.views)||0"), 'Wall quiet merge uses Math.max for views');
assert(html.includes('function authorizePinGrant(') && html.includes('function canAuthorizePin('), 'pin grant helpers present');
assert(html.includes('if(pin && !canAuthorizePin(id))'), 'adminPin requires grant or admin');
assert(html.includes("if(typeof isSiteAdmin==='function' && !isSiteAdmin())") && html.includes("toast('Admin login required')"), 'approveFeature/approvePinPublish gated');
assert(html.includes('authorizePinGrant(id, 120000)'), 'FC pin path authorizes grant');
assert(html.includes('authorizePinGrant(postId, 120000)'), 'Triki path authorizes grant');
assert(!/return 'kenny00'/.test(kenny), 'hardcoded kenny password removed');
assert(kenny.includes("localStorage.getItem(PASS_KEY)"), 'kenny admin uses local password store');
assert(kenny.includes('Admin password created on this device'), 'kenny first-run bootstrap without hardcoded secret');

console.log('\nAudit follow-up checks passed');
