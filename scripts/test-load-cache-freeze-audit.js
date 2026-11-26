#!/usr/bin/env node
/**
 * Static + optional headless guards for load / cache / freeze audit.
 * Root causes covered:
 *  - SPA routes missing no-store → stale HTML vs /
 *  - CF /avatars ~8s 404 hanging prefetchAvatars
 *  - Blocking CDN libs in <head>
 *  - Missing soft update / ghost-overlay recovery
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

var html = read('index.html');
var vercel = JSON.parse(read('vercel.json'));
var build = JSON.parse(read('build.json'));
var sw = read('sw.js');

/* —— Build / version —— */
assert(!!build.build, 'build.json has build id');
assert(html.indexOf('name="rs-app-build"') >= 0, 'HTML meta rs-app-build');
assert(html.indexOf("window.__RS_APP_BUILD='" + build.build + "'") >= 0 ||
  html.indexOf('window.__RS_APP_BUILD="' + build.build + '"') >= 0,
  'window.__RS_APP_BUILD matches build.json');
assert(html.indexOf('content="' + build.build + '"') >= 0, 'meta content matches build.json');
assert(html.indexOf('function checkAppFreshness') >= 0, 'soft update checkAppFreshness');
assert(html.indexOf('/build.json') >= 0, 'freshness probes /build.json');

/* —— Cache headers —— */
function hdr(source) {
  return (vercel.headers || []).find(function (h) {
    return h.source === source;
  });
}
function hasNoStore(h) {
  if (!h) return false;
  var blob = (h.headers || [])
    .map(function (x) {
      return (x.key || '') + ':' + (x.value || '');
    })
    .join('|');
  return /Cache-Control:[^|]*no-store/i.test(blob) && /CDN-Cache-Control:[^|]*no-store/i.test(blob);
}
assert(hasNoStore(hdr('/')), '/ has no-store + CDN-Cache-Control');
assert(hasNoStore(hdr('/index.html')), '/index.html has no-store');
assert(hasNoStore(hdr('/wall')), '/wall has no-store (SPA route)');
assert(hasNoStore(hdr('/profile')), '/profile has no-store');
assert(hasNoStore(hdr('/feed')), '/feed has no-store');
assert(hasNoStore(hdr('/goontok')), '/goontok has no-store');
assert(hasNoStore(hdr('/explore')), '/explore has no-store');
assert(hasNoStore(hdr('/login')), '/login has no-store');
assert(hasNoStore(hdr('/build.json')), '/build.json has no-store');
assert(hasNoStore(hdr('/sw.js')), '/sw.js has no-store');
var wall = hdr('/wall');
var wallBlob = (wall.headers || []).map(function (x) { return x.key + ':' + x.value; }).join('|');
assert(/Cloudflare-CDN-Cache-Control:[^|]*no-store/i.test(wallBlob), 'Cloudflare-CDN-Cache-Control on SPA');
assert(/Surrogate-Control:[^|]*no-store/i.test(wallBlob), 'Surrogate-Control on SPA');

/* —— Service worker —— */
assert(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'sw.js has no fetch handler');
assert(html.indexOf("register('/sw.js')") >= 0, 'registers canonical /sw.js');
assert(html.indexOf("register('/sw.js?v=") < 0, 'never registers query-string SW');
assert(html.indexOf('rs_sw_recovered_v3') >= 0, 'one-shot SW recovery key');

/* —— CDN placement (not in head) —— */
var head = html.split(/<\/head>/i)[0];
assert(!/cdn\.jsdelivr\.net\/npm\/@supabase/.test(head), 'supabase CDN not in <head>');
assert(!/tus-js-client/.test(head), 'tus CDN not in <head>');
assert(/cdn\.jsdelivr\.net\/npm\/@supabase[\s\S]{0,400}function enterSite/.test(html) ||
  /@supabase\/supabase-js@2[\s\S]{0,800}function enterSite/.test(html),
  'supabase loads just before app script');
assert(html.indexOf("unpkg.com/@supabase/supabase-js@2") >= 0, 'unpkg fallback for supabase');
assert(!/document\.write\s*\(/.test(html), 'no document.write() CDN fallback');

/* —— CF hang mitigations —— */
assert(/fetchWithTimeout\(\s*CF_API\+'\/avatars/.test(html) ||
  /fetchWithTimeout\(\s*\n?\s*CF_API\+'\/avatars/.test(html) ||
  html.indexOf("CF_API+'/avatars?users=") >= 0 &&
    html.slice(html.indexOf("function prefetchAvatars"), html.indexOf("function prefetchAvatars") + 1200)
      .indexOf('fetchWithTimeout') >= 0,
  'prefetchAvatars uses fetchWithTimeout');
var pref = html.slice(html.indexOf('function prefetchAvatars'), html.indexOf('function prefetchAvatars') + 1600);
assert(pref.indexOf('fetchWithTimeout') >= 0, 'prefetchAvatars timed');
assert(pref.indexOf('2500') >= 0 || pref.indexOf('3000') >= 0, 'avatar timeout ≤3s');
assert(pref.indexOf('__cfAvatarsDead') >= 0, 'sticky CF avatars dead flag');
var pins = html.slice(html.indexOf('async function loadPublicPins'), html.indexOf('async function loadPublicPins') + 500);
assert(pins.indexOf('fetchWithTimeout') >= 0, 'loadPublicPins timed');

/* —— Recovery —— */
assert(html.indexOf('function armInteractionWatchdog') >= 0, 'interaction watchdog');
assert(html.indexOf('function armGlobalErrorRecovery') >= 0, 'global error recovery');
assert(html.indexOf("addEventListener('unhandledrejection'") >= 0, 'unhandledrejection handler');
assert(html.indexOf('armInteractionWatchdog') >= 0 && html.indexOf('function boot') >= 0, 'boot arms watchdog');
assert(/showPanel\(name, opts\)\{[\s\S]{0,200}releaseInteractionBlockers/.test(html),
  'showPanel clears ghost overlays');
assert(html.indexOf('rs-boot-rescue') >= 0, 'boot rescue UI retained');
assert(html.indexOf('function releaseInteractionBlockers') >= 0, 'releaseInteractionBlockers retained');

/* —— Must not touch commercial systems in this audit file —— */
assert(html.indexOf('function enterSite') >= 0, 'enterSite intact');

/* —— Wall cold-load / empty CF feed —— */
assert(html.indexOf('Never poison rs_wall_cache with an empty CF response') >= 0,
  'wall cache not poisoned by empty CF');
assert(html.indexOf('wallBeforeSb') >= 0, 'SB merge compares length before mutation');
assert(html.indexOf("slug0==='wall'") >= 0 || html.indexOf('slug0===\'wall\'') >= 0,
  'boot kicks wall refresh on /wall cold open');
assert(html.indexOf('WALL_SB_COLS=') >= 0, 'wall SB merge uses lean column list');
assert(!/WALL_SB_COLS='[^']*media_url/.test(html), 'wall SB cols omit missing media_url');
assert(html.indexOf('column posts.media_url does not exist') >= 0 ||
  html.indexOf('media_url / thumb_url / media_type') >= 0,
  'documents why wall SB cols omit media_url');

console.log('\nOK · load-cache-freeze-audit static checks passed');
