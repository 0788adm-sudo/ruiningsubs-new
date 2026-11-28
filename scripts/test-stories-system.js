#!/usr/bin/env node
'use strict';
/**
 * Stories system static + API checks.
 * - No random 5-photo strip under logo (Stories carousel instead)
 * - Anon publish allowed (no register gate)
 * - Free owner/admin delete (no Coins)
 * - Stories excluded from Extended / All Posts
 * - Legacy LoserFagg migration helpers present
 */
var fs = require('fs');
var path = require('path');
var assert = function (c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
};

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var gamePlay = fs.readFileSync(path.join(root, 'api/game-play.js'), 'utf8');
var storiesLib = fs.readFileSync(path.join(root, 'lib/stories.js'), 'utf8');
var mig = fs.readFileSync(path.join(root, 'migrations/20261128_stories_system.sql'), 'utf8');

assert(fs.existsSync(path.join(root, 'lib/stories.js')), 'lib/stories.js exists');
assert(fs.existsSync(path.join(root, 'migrations/20261128_stories_system.sql')), 'stories migration exists');
assert(gamePlay.indexOf("require(path.join(__dirname, '..', 'lib', 'stories'))") >= 0, 'game-play hosts stories API');
assert(gamePlay.indexOf('stories_publish') >= 0 || gamePlay.indexOf('storiesApi') >= 0, 'game-play routes story actions');
assert(storiesLib.indexOf("STORY_TAG = '__story__'") >= 0, 'story tag constant');
assert(storiesLib.indexOf('STORY_MS = 24') >= 0, '24h TTL');
assert(storiesLib.indexOf('cost: 0') >= 0 && storiesLib.indexOf('free: true') >= 0, 'delete is free');
assert(storiesLib.indexOf('migrateLegacyStories') >= 0, 'legacy migration helper');
assert(storiesLib.indexOf('st_mwzixonpihq') >= 0 || storiesLib.indexOf('ensureLoserFaggMigrated') >= 0, 'LoserFagg migration guard');
assert(mig.indexOf('CREATE TABLE IF NOT EXISTS public.stories') >= 0, 'stories table DDL');
assert(mig.indexOf('story_views') >= 0 && mig.indexOf('story_likes') >= 0, 'views/likes tables DDL');

assert(html.indexOf('Register to post a story') < 0, 'no register gate for story publish');
assert(html.indexOf('Free deletes used') < 0, 'no paid/limited story delete quota');
assert(html.indexOf("action:'stories_publish'") >= 0 || html.indexOf("'stories_publish'") >= 0, 'client publishes via stories_publish');
assert(html.indexOf("action:'stories_delete'") >= 0 || html.indexOf("'stories_delete'") >= 0, 'client deletes via stories_delete');
assert(html.indexOf('story-composer') >= 0, 'story composer with preview');
assert(html.indexOf('confirmPublishStory') >= 0, 'publish confirmation');
assert(html.indexOf('function isStoryPost') >= 0, 'isStoryPost helper');
assert(/function isWallUnifiedPost[\s\S]{0,400}isStoryPost/.test(html), 'All Posts excludes stories');
assert(/function isWallTimedPost[\s\S]{0,200}isStoryPost/.test(html), 'Extended timed excludes stories');
assert(html.indexOf('function renderPosts') >= 0 && html.indexOf('isStoryPost(p)) return false') >= 0, 'renderPosts path excludes stories');
assert(html.indexOf('asec-stories') >= 0 && html.indexOf('adminDeleteStory') >= 0, 'admin stories delete UI');
assert(html.indexOf('paintProfileStoryRing') >= 0, 'profile story ring');
assert(
  /function fillHomeRandomStrip\(\)\{[\s\S]{0,280}renderWallStories/.test(html),
  'home strip under logo uses Stories carousel'
);
assert(html.indexOf('resolveHomeStripFive();') < 0 || !/function fillHomeRandomStrip\(\)\{[\s\S]{0,200}resolveHomeStripFive\(\)/.test(html),
  'fillHomeRandomStrip no longer paints random five photos');

// Live API checks against Supabase via lib (no Vercel deploy required)
var stories = require(path.join(root, 'lib', 'stories'));
assert(typeof stories.listStories === 'function', 'listStories export');
assert(typeof stories.publishStory === 'function', 'publishStory export');
assert(typeof stories.deleteStory === 'function', 'deleteStory export');

stories
  .listStories({})
  .then(function (list) {
    assert(Array.isArray(list), 'listStories returns array');
    var loser = list.filter(function (s) {
      return String(s.user || '').toLowerCase() === 'loserfagg' || s.legacy_id === 'st_mwzixonpihq';
    });
    assert(loser.length <= 1, 'LoserFagg story not duplicated (' + loser.length + ')');
    if (loser.length === 1) {
      assert(!!(loser[0].url || loser[0].media_url), 'LoserFagg media preserved');
      assert(Number(loser[0].expires_at) > Date.now(), 'LoserFagg still within 24h window');
      console.log('PASS · LoserFagg active story id=' + loser[0].id + ' views=' + loser[0].views);
    } else {
      console.log('PASS · LoserFagg not active (expired or deleted) — no duplicate');
    }
    // Exclude stories from looking like normal posts in markup helpers
    assert(html.indexOf("tags.indexOf('__story__')") >= 0 || html.indexOf("'__story__'") >= 0, 'frontend knows __story__ tag');
    console.log('\nStories system checks passed');
  })
  .catch(function (e) {
    console.error('FAIL · live list', e);
    process.exit(1);
  });
