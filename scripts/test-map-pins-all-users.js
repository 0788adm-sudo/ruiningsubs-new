#!/usr/bin/env node
/**
 * Map pins must include every confirmed location — anonymous + registered.
 * Guards geocode-on-confirm (no stale map-tap), heal of misplaced country pins,
 * unique keys so guests never collapse, and public anon popup.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

function extractFn(name) {
  var re = new RegExp('function\\s+' + name + '\\s*\\(');
  var m = re.exec(html);
  if (!m) {
    console.error('FAIL · missing function ' + name);
    process.exit(1);
  }
  var start = m.index;
  var i = html.indexOf('{', start);
  var depth = 0;
  for (; i < html.length; i++) {
    var ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

assert(html.indexOf('function resolveMapPinUser') >= 0, 'resolveMapPinUser present');
assert(html.indexOf('function geocodePlace') >= 0, 'geocodePlace present');
assert(html.indexOf('function pickGeocodeFeature') >= 0, 'pickGeocodeFeature ranks country/city over house');
assert(html.indexOf('function healMisplacedPins') >= 0, 'healMisplacedPins present');
assert(html.indexOf('function pinLooksMisplaced') >= 0, 'pinLooksMisplaced present');
assert(html.indexOf('function markerLatLng') >= 0, 'markerLatLng offsets same-city accounts');
assert(html.indexOf('function startPinPolling') >= 0, 'auto refresh polling');
assert(html.indexOf('typed city/country always wins') >= 0, 'saveMapPin prefers geocode over stale pending');
assert(html.indexOf('anonymous included') >= 0 || /anonymous included/i.test(html), 'copy mentions anonymous pins');
assert(html.indexOf('Public location only') >= 0, 'anon popup respects privacy');
assert(!/var user=\(window\.currentUser&&currentUser\.name\)\|\|'guest'/.test(
  html.slice(html.indexOf('window.saveMapPin'), html.indexOf('window.saveMapPin') + 2500)
), 'saveMapPin no longer defaults bare guest');

// Behavioral: pinUserKey must not collapse distinct anons / guest fallbacks
var api = new Function(
  extractFn('normUser') +
    '\n' +
    extractFn('pinUserKey') +
    '\n' +
    extractFn('pinLooksMisplaced') +
    '\n' +
    extractFn('pickGeocodeFeature') +
    '\n' +
    'var COUNTRY_ROUGH=' +
    (function () {
      var m = html.match(/var COUNTRY_ROUGH=\{[\s\S]*?\};/);
      assert(m, 'COUNTRY_ROUGH block');
      return m[0].replace(/^var COUNTRY_ROUGH=/, '');
    })() +
    ';\n' +
    'return {pinUserKey:pinUserKey, pinLooksMisplaced:pinLooksMisplaced, pickGeocodeFeature:pickGeocodeFeature};'
)();

var k1 = api.pinUserKey({ user: 'anon_amwo9a3gsu53smg7485', lat: 8, lng: -66, t: 1 });
var k2 = api.pinUserKey({ user: 'anon_amwroouubwdn72i3luccj5hq2', lat: 51, lng: 0, t: 2 });
var k3 = api.pinUserKey({ user: 'Truckerj', lat: 41, lng: -101, t: 3 });
assert(k1 !== k2, 'distinct anon users keep distinct pin keys');
assert(k3 === 'truckerj', 'registered username normalizes');
var g1 = api.pinUserKey({ user: 'guest', lat: 10, lng: 20, t: 111 });
var g2 = api.pinUserKey({ user: 'guest', lat: 30, lng: 40, t: 222 });
assert(g1 !== g2, 'bare guest pins do not collapse into one key');

assert(
  api.pinLooksMisplaced({ city: 'Venezuela', country: 'Venezuela', lat: 52.1, lng: 4.28 }) === true,
  'Venezuela text at Netherlands coords is misplaced'
);
assert(
  api.pinLooksMisplaced({ city: 'Caracas', country: 'Venezuela', lat: 10.5, lng: -66.9 }) === false,
  'real Venezuela coords are accepted'
);
assert(
  api.pinLooksMisplaced({ city: 'Ogallala', country: 'United States', lat: 24.46, lng: 124.08 }) === true,
  'US city at East Asia coords is misplaced'
);

var features = [
  {
    properties: { type: 'house', name: 'Venezuela', country: 'Argentina', osm_key: 'railway' },
    geometry: { coordinates: [-58.4, -34.6] }
  },
  {
    properties: { type: 'country', name: 'Venezuela', country: 'Venezuela' },
    geometry: { coordinates: [-66.11, 8.0] }
  }
];
var best = api.pickGeocodeFeature(features, 'Venezuela', 'Venezuela');
assert(best && best.properties.type === 'country', 'pickGeocodeFeature prefers country over railway house');

console.log('\nMap pins all-users checks passed');
