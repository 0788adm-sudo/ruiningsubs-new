#!/usr/bin/env node
'use strict';
/**
 * Controlled audit fixes — static regression checks.
 * Covers: Extend top-5 desktop CSS, Explore single Games entry,
 * Random Cam coming soon gate, Esri basemap, silent compress path.
 */
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
var fails=0;
function assert(c,m){
  if(!c){console.error('FAIL:',m);fails++;return}
  console.log('PASS ·',m);
}

// 1) Desktop-only enlarge for home strip; mobile max-width:96px retained
assert(/#home-random-strip \.home-strip-card\{[^}]*max-width:96px/.test(html), 'mobile strip max-width 96px kept');
assert(/@media\(min-width:900px\)\{[\s\S]*?#home-random-strip \.home-strip-card\{[\s\S]*?max-width:168px/.test(html), 'desktop strip enlarged at 900px');
assert(/@media\(max-width:480px\)\{[\s\S]*?#home-random-strip \.home-strip-card\{flex:0 0 calc\(20% - 5px\);min-width:58px\}/.test(html), 'mobile ≤480 strip rule unchanged');

// 2) Single Explore Games access — no duplicate "Open games" promo button
assert(html.includes('id="btn-explore-games"'), 'Explore Games entry present');
assert(/id="btn-explore-games"[\s\S]*?<strong>Games<\/strong>/.test(html), 'Explore entry labeled Games');
assert(!/explore-xp-promo[\s\S]{0,280}Open games/.test(html), 'XP promo no longer opens games');
assert(!/rsPromoStripHtml\(\{title:'🏆 REACH 10,000 XP',sub:'UNLOCK A SPECIAL REWARD',action:'[^']*openChallengesHub/.test(html), 'explore XP promo has no games action');

// 3) Random Cam coming soon — route kept, camera gated
assert(html.includes('var RC_COMING_SOON=true'), 'RC_COMING_SOON gate on');
assert(html.includes('id="rc-coming-soon"'), 'coming soon overlay markup');
assert(/Próximamente/.test(html), 'Próximamente copy present');
assert(/if\(RC_COMING_SOON\)\{[\s\S]*?showComingSoonUi\(\);[\s\S]*?return;/.test(html), 'connect() aborts when gated');
assert(/id="rc-start"[^>]*disabled/.test(html), 'Start button disabled in markup');

// 4) Map: Esri primary, Carto watermark URL gone
assert(html.includes('World_Dark_Gray_Base'), 'Esri dark basemap in addBasemap');
assert(!/basemaps\.cartocdn\.com\/dark_all/.test(html), 'Carto dark_all URL removed');
assert(html.includes('API KEY REQUIRED') || html.includes('watermark'), 'comment documents CARTO watermark cause');

// 5) Ghost compression / Fast Start: silent background path + panel clear
assert(/compressVideoForUpload\(file,\s*\{silent:true\}\)/.test(html), 'optimize worker uses silent compress');
assert(/ensureMp4FastStart\(out,\s*\{silent:true\}\)/.test(html), 'optimize worker uses silent Fast Start remux');
assert(/async function ensureMp4FastStart\(file,\s*opts\)/.test(html), 'ensureMp4FastStart accepts opts');
assert(/opts\.silent/.test(html)||/var showUi=!!opts\.showProgress/.test(html), 'compress/faststart respect silent/showProgress');
assert(/!window\.__publishingVideo[\s\S]{0,80}hideVideoProgress/.test(html), 'panel change hides orphan progress when not publishing');
assert(/panel-randomcam[\s\S]{0,40}panel-map[\s\S]{0,80}return/.test(html)||/act\.id==='panel-randomcam'/.test(html), 'optimize worker skips Random Cam / Map panels');

if(fails){console.error('\n'+fails+' assertion(s) failed');process.exit(1)}
console.log('\nControlled audit fix checks passed');
