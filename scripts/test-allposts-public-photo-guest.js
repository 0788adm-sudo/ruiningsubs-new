#!/usr/bin/env node
'use strict';
/**
 * ALL POSTS public photo publish ≠ EXTENDED exposure:
 * - PUBLIC PHOTO POST copy for All Posts composer
 * - Guest publish allowed; optional Register / Continue as Guest
 * - Wall path tags normal_feed + no expires / extend_amount
 * - Extended composer copy remains separate
 */
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// —— Differentiation copy ——
assert(html.includes('PUBLIC PHOTO POST'), 'PUBLIC PHOTO POST title/copy');
assert(
  html.includes('Add a photo to the public community wall. Your photo will appear in All Posts, not in Extended.'),
  'All Posts vs Extended explanatory copy'
);
assert(html.includes('Publish to All Posts'), 'publish CTA says All Posts');
assert(!/Permanent Wall post/.test(html), 'old Permanent Wall post copy removed from composer');
assert(html.includes("title.textContent='New Exposure'") || html.includes('textContent=\'New Exposure\''), 'Extended keeps New Exposure title');
assert(html.includes("textContent='Publish Exposure'") || html.includes('Publish Exposure'), 'Extended keeps Publish Exposure CTA');

// —— Guest invite (optional, never required) ——
assert(html.includes('Create your profile!'), 'Create your profile invite heading');
assert(
  html.includes('Join RuinExpose to connect your photos to your own profile and build your identity in the community.'),
  'register invite body copy'
);
assert(html.includes('Continue as Guest'), 'Continue as Guest option');
assert(html.includes('id="wall-guest-invite"'), 'inline guest invite in composer');
assert(html.includes('id="allposts-guest-modal"'), 'guest invite modal');
assert(html.includes('function markGuestContinueAllPosts'), 'guest continue helper');
assert(html.includes('function goRegisterFromAllPostsInvite'), 'register from invite helper');
assert(html.includes('function syncAllPostsGuestInvite'), 'guest invite sync');
assert(html.includes("rs_allposts_guest_continue"), 'session flag so guest continue is sticky');

// —— Guest publish not blocked ——
assert(
  html.includes('All Posts public photos allowed for anonymous') ||
    html.includes('Wall posts allowed for anonymous'),
  'anonymous All Posts publish comment/path'
);
assert(html.includes('function ensureAnonIdentity'), 'stable anon identity');
assert(html.includes("account:anonymous"), 'anonymous posts tagged');
assert(html.includes('function isAnonymousAccount'), 'anon account helper');
assert(
  !/function openNormalPostComposer\(\)\{[\s\S]{0,500}Login to publish/.test(html),
  'openNormalPostComposer has no login gate'
);

// —— Classification / no Extended bleed ——
assert(
  /profileMode\?\(tags\.concat\(\['profile_gallery','normal_feed'\]\)\)/.test(html) ||
    html.includes("tags.concat(['profile_gallery','normal_feed'])"),
  'All Posts tags profile_gallery + normal_feed'
);
assert(
  /expires_at:\(profileMode \|\| hasUploadedVideo\) \? null/.test(html),
  'All Posts path sets expires_at null'
);
assert(
  /extend_amount:\(profileMode \|\| hasUploadedVideo\) \? 0/.test(html),
  'All Posts path sets extend_amount 0'
);
assert(html.includes('Published in All Posts — not in Extended'), 'success toast clarifies destination');
assert(html.includes('Published in Extended'), 'Extended success toast still exists separately');
assert(html.includes('function setExposurePostMode') && html.includes('hideAllPostsGuestInvite'), 'Extended mode clears guest invite');

// —— Registered ownership / no fake profile attribution ——
assert(html.includes('function userClickable'), 'userClickable gates profile links');
assert(/isAnonymousAccountName\(s\)\) return false/.test(html) || html.includes("isAnonymousAccountName(s)) return false"), 'anon names not clickable');
assert(html.includes('rs_linked_anon') && html.includes("action:'link_anon'"), 'register links anon history');
assert(html.includes("resumeAllPosts") || html.includes("allposts_publish"), 'after register can resume All Posts composer');

console.log('\nAll Posts public photo / guest publish checks passed');
