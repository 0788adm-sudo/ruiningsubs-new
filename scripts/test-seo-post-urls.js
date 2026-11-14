#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
var robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
var og = fs.readFileSync(path.join(root, 'api/og.js'), 'utf8');
var sitemap = fs.readFileSync(path.join(root, 'api/sitemap.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS ·', msg);
}

assert(html.includes('function postPath('), 'postPath helper');
assert(html.includes('function postPermalink('), 'postPermalink helper');
assert(html.includes("postPath(post.id)"), 'openDetail uses /post/:id');
assert(html.includes('class="post-permalink"'), 'crawlable permalink anchors in cards');
assert(html.includes('function applyPostSeoMeta'), 'dynamic post SEO meta');
assert(html.includes('function restoreDefaultSeoMeta'), 'restore default SEO meta');
assert(/postShareUrl[\s\S]{0,180}postPermalink/.test(html), 'share URLs use permalinks');
assert(html.includes("parseSharedPostId"), 'legacy #p= / ?p= parser kept');
assert(/\/(?:post|p)\/([^\/?#]+)/.test(html), 'path parser accepts /post/:id');

assert(robots.indexOf('Sitemap: https://www.ruinexpose.com/sitemap.xml') >= 0, 'robots lists sitemap');
assert(robots.indexOf('Disallow: /admin') >= 0, 'robots blocks admin');
assert(robots.indexOf('Allow: /post/') >= 0, 'robots allows /post/');

assert(og.indexOf("SITE + '/post/'") >= 0 || og.indexOf('"/post/"') >= 0, 'OG canonical uses /post/');
assert(og.indexOf('noindex') >= 0, 'OG can noindex ineligible posts');
assert(og.indexOf('SocialMediaPosting') >= 0, 'OG emits structured data');
assert(og.indexOf('isIndexablePost') >= 0, 'OG eligibility gate');

assert(sitemap.indexOf('urlset') >= 0, 'sitemap builder present');
assert(sitemap.indexOf('isIndexableRow') >= 0, 'sitemap eligibility gate');
assert(sitemap.indexOf("'/post/'") >= 0 || sitemap.indexOf('"/post/"') >= 0, 'sitemap emits /post/ URLs');

var sources = (vercel.rewrites || []).map(function (r) {
  return r.source;
});
assert(sources.indexOf('/sitemap.xml') >= 0, 'vercel rewrite sitemap.xml');
assert(sources.indexOf('/post/:id') >= 0, 'vercel rewrite /post/:id');
var postRewrite = (vercel.rewrites || []).find(function (r) {
  return r.source === '/post/:id';
});
assert(postRewrite && postRewrite.destination === '/index.html', '/post/:id serves SPA for humans');

var mw = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
assert(mw.indexOf('Googlebot') >= 0, 'middleware still serves bots OG HTML');
assert(mw.indexOf('/post/:id') >= 0, 'middleware matches /post/:id');

console.log('\nSEO post URL + sitemap checks passed');
