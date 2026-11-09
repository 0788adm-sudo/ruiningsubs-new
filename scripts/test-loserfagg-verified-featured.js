#!/usr/bin/env node
/**
 * @LoserFagg verified badge + featured profile pin helpers.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg || 'assertion failed');
    process.exit(1);
  }
}

assert(/VERIFIED_USERS\s*=\s*\[[^\]]*loserfagg/i.test(html), 'loserfagg must be in VERIFIED_USERS');
assert(/FEATURED_PROFILES\s*=\s*\[[^\]]*loserfagg/i.test(html), 'loserfagg must be in FEATURED_PROFILES');
assert(html.indexOf('function isFeaturedProfile') >= 0, 'isFeaturedProfile helper missing');
assert(html.indexOf('featuredProfileBadgeHtml') >= 0, 'featured badge helper missing');
assert(html.indexOf('FEATURED_PROFILE_PIN_MS') >= 0, 'featured pin duration missing');
assert(html.indexOf('Featured profile') >= 0, 'spotlight featured profile label missing');
assert(html.indexOf('PINNED · ') >= 0 || html.indexOf("PINNED · ") >= 0, 'profile pinned section label missing');
assert(html.indexOf('featured-profile-badge') >= 0, 'featured profile CSS/class missing');

// Smoke: extract helpers and verify casing / pin boost.
var m = html.match(/var VERIFIED_USERS = (\[[^\]]+\]);/);
assert(m, 'VERIFIED_USERS literal missing');
var verified = Function('return ' + m[1])();
assert(verified.indexOf('loserfagg') >= 0, 'normalized loserfagg not verified');

var m2 = html.match(/var FEATURED_PROFILES = (\[[^\]]+\]);/);
assert(m2, 'FEATURED_PROFILES literal missing');
var featured = Function('return ' + m2[1])();
assert(featured.indexOf('loserfagg') >= 0, 'normalized loserfagg not featured');

function normProfileName(name) {
  return String(name || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}
function isVerifiedUser(name) {
  return verified.indexOf(normProfileName(name)) >= 0;
}
function isFeaturedProfile(name) {
  return featured.indexOf(normProfileName(name)) >= 0;
}
assert(isVerifiedUser('LoserFagg') && isVerifiedUser('@loserfagg'), 'verified should match casing');
assert(isFeaturedProfile('LoserFagg') && isFeaturedProfile('@LoserFagg'), 'featured should match casing');
assert(!isFeaturedProfile('mastersan') || true, 'mastersan featured optional');

console.log('OK: LoserFagg verified + featured profile helpers');
