#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(html.includes('function maybeShowTelegram'), 'maybeShowTelegram exists');
assert(html.includes('function setupTelegramPopup'), 'setupTelegramPopup exists');
assert(html.includes("TG_HIDE_KEY='rs_tg_hide_v2'") || html.includes('rs_tg_hide_v2'), 'permanent hide key');
assert(html.includes('rs_tg_soft_v2') || html.includes("TG_SOFT_KEY='rs_tg_soft_v2'"), 'soft dismiss key persists across refresh');
assert(html.includes('tgRememberHide'), 'shared remember helper');
assert(html.includes('tgPrefHidePermanent'), 'permanent preference reader');
assert(html.includes('tgPrefSoftActive'), 'soft preference reader');
assert(html.includes('__enterSiteStarted'), 'enterSite double-call guard');
assert(html.includes('__tgShownThisLife'), 'telegram once-per-page-life guard');
assert(/function closeTg\(permanent\)|tgRememberHide\(forever\)/.test(html) || html.includes('tgRememberHide(forever)'), 'dismiss remembers preference');
assert(html.includes("id=\"tg-dont\""), 'Don’t show this again checkbox');
assert(html.includes('id="tg-dismiss"'), 'Maybe later button');
assert(html.includes('id="tg-close-x"'), 'close X control');
assert(html.includes('id="tg-join"'), 'Join Telegram CTA kept');
// Must not only persist when checkbox is checked
assert(!/if\(dont&&dont\.checked\)try\{localStorage\.setItem\('rs_tg_hide_v2','1'\)\}catch\(e\)\{\}\s*modal\.classList\.remove\('show'\)/.test(html), 'legacy close-only-if-checked path removed');

console.log('\nTelegram popup persistence checks passed');
