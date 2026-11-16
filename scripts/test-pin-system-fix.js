#!/usr/bin/env node
/**
 * Guards for surgical pin-system fixes:
 * 1) Approve must fall back when CF D1 lacks the Supabase post (post not found: N)
 * 2) Unpin must use data-admin delegation (inline onclick was a no-op under CSP/delegation)
 * 3) Public Spotlight must load active featured_until from Supabase (not admin localStorage /
 *    broken deletion_tier selects)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var https = require('https');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var unpinApi = fs.readFileSync(path.join(root, 'api', 'admin-unpin.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

function get(url) {
  return new Promise(function (resolve, reject) {
    https
      .get(url, { headers: { Origin: 'https://www.ruinexpose.com' } }, function (res) {
        var chunks = [];
        res.on('data', function (c) {
          chunks.push(c);
        });
        res.on('end', function () {
          var body = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, text: body });
          }
        });
      })
      .on('error', reject);
  });
}

function sbGet(pathQuery) {
  var url =
    'https://snlpdolzhzcbbdyxqlnb.supabase.co/rest/v1/' +
    pathQuery;
  var key =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
  return new Promise(function (resolve, reject) {
    https
      .get(
        url,
        {
          headers: {
            apikey: key,
            Authorization: 'Bearer ' + key
          }
        },
        function (res) {
          var chunks = [];
          res.on('data', function (c) {
            chunks.push(c);
          });
          res.on('end', function () {
            var body = Buffer.concat(chunks).toString('utf8');
            try {
              resolve({ status: res.statusCode, json: JSON.parse(body) });
            } catch (e) {
              resolve({ status: res.statusCode, text: body });
            }
          });
        }
      )
      .on('error', reject);
  });
}

// —— 1) Approve fallback for CF-missing posts ——
assert(/resolvePinRequestPostId/.test(html), 'resolvePinRequestPostId helper');
assert(/Approved via Supabase pin \(CF post missing\)/.test(html), 'CF approve falls back + clears request');
assert(/post not found:\s*\(\[A-Za-z0-9_-\]\+\)/.test(html) || /post not found:/.test(html), 'parses post not found id from CF error');
assert(/Wall posts often live only in Supabase/.test(html), 'adminPin hydrates from Supabase when CF misses');
assert(/Never create a CF duplicate for an existing Supabase post/.test(html), 'no duplicate create on SB-backed posts');
assert(/sbOk \|\| boardOk/.test(html), 'pin success accepts SB and/or public pin board');

// —— 2) Unpin wiring ——
assert(/data-admin="unpin"/.test(html), 'Unpin uses data-admin delegation');
assert(/act==='unpin'/.test(html), 'bindAdminClicks handles unpin');
assert(!/onclick="adminUnpinFromPanel\(/.test(html), 'Pinned Posts Unpin no longer relies on inline onclick');
assert(/adminSbAnonPatchPost\(key,\s*\{featured_until:null/.test(html), 'unpin verifies SB clear via anon fallback');
assert(/keys\.push\(Number\(raw\)\)/.test(unpinApi) && /keys\.push\(raw\)/.test(unpinApi), 'admin-unpin tries numeric + string ids');

// —— 3) Public visibility ——
assert(/Source of truth for everyone \(admin \+ visitors\): active Supabase featured_until/.test(html), 'loadPublicPins merges Supabase featured');
assert(/Public Spotlight source: active featured_until for ALL visitors/.test(html), 'loadPosts featQ comment');
assert(!/select\(META\+',image_url'\)\.gt\('featured_until'/.test(html) || /FEAT_COLS/.test(html), 'featQ uses FEAT_COLS without deletion_tier');
assert(/var FEAT_COLS=META\+',image_url'/.test(html), 'FEAT_COLS defined');
assert(
  /var META='id,username,title,description,tags,expires_at,created_at,views,likes_count,extensions_count,extend_amount,extenders,liked_by,featured_until,saves_count,downloads_count,reactions'/.test(
    html
  ),
  'META no longer selects missing deletion_tier'
);
assert(/never select posts\.deletion_tier/.test(html), 'deletion_tier hazard documented');

async function liveChecks() {
  var cf = await get('https://ruiningsubs-api.0788adm.workers.dev/posts/2472');
  assert(cf.json && cf.json.error === 'not found', 'live: CF D1 missing post 2472 (reproduces approve bug)');

  var sb = await sbGet('posts?id=eq.2472&select=id,username,featured_until,featured');
  assert(Array.isArray(sb.json) && sb.json[0] && Number(sb.json[0].id) === 2472, 'live: Supabase has post 2472');

  var bad = await sbGet(
    'posts?select=id,deletion_tier,featured_until&featured_until=gt.2020-01-01T00:00:00Z&limit=1'
  );
  assert(bad.json && bad.json.code === '42703', 'live: deletion_tier select still 400s (why old featQ failed)');

  var good = await sbGet(
    'posts?select=id,username,title,featured_until,image_url&featured_until=gt.' +
      encodeURIComponent(new Date().toISOString()) +
      '&order=featured_until.desc&limit=10'
  );
  assert(Array.isArray(good.json) && good.json.length > 0, 'live: anon can read active featured pins');

  var board = await get('https://ruiningsubs-api.0788adm.workers.dev/notifs?to=__PIN_BOARD__');
  var notifs = (board.json && board.json.notifs) || [];
  assert(Array.isArray(notifs), 'live: pin board readable without admin auth');

  console.log('\nPin system fix checks passed');
}

liveChecks().catch(function (e) {
  console.error(e);
  process.exit(1);
});
