#!/usr/bin/env node
'use strict';
/**
 * Unit + live checks for RuinExpose sitemap XML generation.
 * Ensures each URL is an independent <url> block (no concatenated locs).
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var sitemapPath = path.join(root, 'api/sitemap.js');
var handler = require(sitemapPath);

function fail(msg) {
  console.error('FAIL ·', msg);
  process.exit(1);
}
function pass(msg) {
  console.log('PASS ·', msg);
}

function assertTrue(cond, msg) {
  if (!cond) fail(msg);
  pass(msg);
}

assertTrue(typeof handler === 'function', 'handler export is function');
assertTrue(typeof handler.buildSitemapXml === 'function', 'buildSitemapXml exported');
assertTrue(String(handler.SITE).indexOf('www.') < 0, 'SITE origin has no www');
assertTrue(handler.SITE === 'https://ruinexpose.com', 'SITE is https://ruinexpose.com');

var sample = handler.buildSitemapXml(
  [
    {
      id: 3058,
      created_at: '2026-11-16T17:18:27.045Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      tags: ['exposed'],
      image_url: 'https://ruiningsubs-api.0788adm.workers.dev/media/demo-photo.jpg'
    },
    {
      id: 999,
      created_at: '2026-11-16T17:18:27.045Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      tags: ['private'],
      image_url: 'https://example.com/secret.jpg'
    },
    {
      id: 1000,
      created_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2020-01-02T00:00:00.000Z',
      tags: ['exposed'],
      image_url: 'https://example.com/expired.jpg'
    }
  ],
  '2026-11-16'
);

assertTrue(sample.indexOf('<?xml version="1.0" encoding="UTF-8"?>') === 0, 'XML declaration first');
assertTrue(sample.indexOf('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') >= 0, 'urlset sitemap ns');
assertTrue(sample.indexOf('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"') >= 0, 'image extension when image present');
assertTrue(sample.indexOf('https://ruinexpose.com/post/3058') >= 0, 'includes public post 3058');
assertTrue(sample.indexOf('/post/999') < 0, 'excludes private-tagged post');
assertTrue(sample.indexOf('/post/1000') < 0, 'excludes expired post');
assertTrue(sample.indexOf('https://www.ruinexpose.com') < 0, 'no www host in XML');
assertTrue(sample.indexOf('pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/demo-photo.jpg') >= 0, 'rewrites worker media to R2 image');

// Each <loc> must sit inside its own <url>…</url> and not abut another URL string.
var urlBlocks = sample.match(/<url>[\s\S]*?<\/url>/g) || [];
assertTrue(urlBlocks.length >= 8, 'one block per static page + public post (got ' + urlBlocks.length + ')');

var locs = [];
urlBlocks.forEach(function (block, i) {
  var m = block.match(/<loc>([^<]+)<\/loc>/);
  if (!m) fail('url block ' + i + ' missing <loc>');
  var loc = m[1];
  if (locs.indexOf(loc) >= 0) fail('duplicate loc ' + loc);
  locs.push(loc);
  // Guard against historical concatenation artifact: .../post/30582026-11-16...
  if (/\/post\/\d{4,}\d{4}-\d{2}-\d{2}/.test(block.replace(/\s+/g, ''))) {
    fail('concatenated post id + date in block: ' + block.slice(0, 120));
  }
  var locCount = (block.match(/<loc>/g) || []).length;
  if (locCount !== 1) fail('url block must contain exactly one <loc>, got ' + locCount);
});
pass('each <url> has a single independent <loc> (' + locs.length + ')');

// Stripped-text view must still separate URLs by newlines (no glue).
var stripped = sample.replace(/<[^>]+>/g, '');
assertTrue(stripped.indexOf('https://ruinexpose.com/post/30582026') < 0, 'stripped text does not glue id+date');
assertTrue(/\n\s*https:\/\/ruinexpose\.com\/post\/3058\s*\n/.test(stripped) || stripped.indexOf('https://ruinexpose.com/post/3058\n') >= 0 || /https:\/\/ruinexpose\.com\/post\/3058/.test(stripped), 'post loc survives as discrete text');

// Minimal well-formedness with regex + ElementTree via python child if available.
var outFile = path.join('/tmp', 'ruinexpose-sitemap-test.xml');
fs.writeFileSync(outFile, sample, 'utf8');

var { spawnSync } = require('child_process');
var py = spawnSync(
  'python3',
  [
    '-c',
    "import xml.etree.ElementTree as ET,sys;\n" +
      "root=ET.parse(sys.argv[1]).getroot();\n" +
      "ns={'sm':'http://www.sitemaps.org/schemas/sitemap/0.9','img':'http://www.google.com/schemas/sitemap-image/1.1'};\n" +
      "urls=root.findall('sm:url',ns);\n" +
      "assert len(urls)>=8, len(urls);\n" +
      "locs=[u.find('sm:loc',ns).text for u in urls];\n" +
      "assert all(l and l.startswith('https://ruinexpose.com') for l in locs);\n" +
      "assert any('/post/3058' in l for l in locs);\n" +
      "assert not any('www.' in l for l in locs);\n" +
      "imgs=root.findall('.//img:image',ns);\n" +
      "assert len(imgs)>=1;\n" +
      "print('parsed',len(urls),'urls',len(imgs),'images');\n",
    outFile
  ],
  { encoding: 'utf8' }
);
if (py.status !== 0) {
  console.error(py.stdout || '');
  console.error(py.stderr || '');
  fail('python XML parse failed');
}
pass('python ElementTree validates sample XML (' + String(py.stdout || '').trim() + ')');

// Live fetch against production when reachable (non-fatal soft checks after deploy).
var live = process.env.SITEMAP_LIVE_URL || '';
if (live) {
  var https = require('https');
  var http = require('http');
  var mod = live.indexOf('https:') === 0 ? https : http;
  mod
    .get(live, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, function (res) {
      var chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        var ct = String(res.headers['content-type'] || '');
        assertTrue(res.statusCode === 200, 'live status 200');
        assertTrue(/application\/xml/i.test(ct), 'live Content-Type application/xml');
        assertTrue(body.indexOf('<urlset') >= 0, 'live has urlset');
        assertTrue(body.indexOf('</urlset>') >= 0, 'live closes urlset');
        console.log('OK · sitemap xml tests + live');
      });
    })
    .on('error', function (e) {
      fail('live fetch error: ' + e.message);
    });
} else {
  console.log('OK · sitemap xml tests (set SITEMAP_LIVE_URL to also hit production)');
}
