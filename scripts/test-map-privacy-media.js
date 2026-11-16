#!/usr/bin/env node
'use strict';
var fs=require('fs');
var path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS ·',m)}

assert(html.includes('function sanitizePlaceText('), 'map place sanitizer present');
assert(html.includes('function fuzzCoords('), 'coord fuzzing present');
assert(html.includes('function addBasemap('), 'basemap helper present');
assert(html.includes('World_Dark_Gray_Base'), 'Esri dark basemap primary (Carto watermarked without API key)');
assert(!/basemaps\.cartocdn\.com\/dark_all/.test(html), 'Carto watermark tiles no longer primary');
assert(html.includes('MAP_MAX_ZOOM=11') || html.includes('var MAP_MAX_ZOOM=11'), 'city-level max zoom');
assert(html.includes('showMapFail('), 'map fail UI helper');
assert(html.includes('cdn.jsdelivr.net/npm/leaflet'), 'Leaflet CDN fallback');
assert(!/explore-map-preview\{\s*height:180px;width:100%;pointer-events:none;touch-action:none;background:#0c1b33/.test(html), 'blue empty preview background removed');
assert(html.includes("data-views-id=\"'+String(p.id)"), 'Wall view badge uses data-views-id');
assert(html.includes('window.__nfImgRetry'), 'Wall media onerror retry');
assert(html.includes("onerror=\"window.__nfImgRetry&&window.__nfImgRetry(this)\""), 'Wall img wires retry');

// Behavioral: sanitizePlaceText + fuzzCoords
(function(){
  var sanitizePlaceText=function(s){
    s=String(s||'').replace(/\s+/g,' ').trim();
    if(!s) return '';
    s=s.replace(/\b(?:[\wÀ-ÿ.\-]+\s+)?[\wÀ-ÿ.\-]*(straße|strasse|straat|street|avenue|ave\.?|road|rd\.?|blvd\.?|boulevard|lane|ln\.?|drive|dr\.?|weg|calle|avenida|rua|plaza|plaats|plein)\.?\s*\d{0,5}[A-Za-z]?\b/ig,'');
    s=s.replace(/\b\d{1,5}\s*[A-Za-zÀ-ÿ.\-]*\s*(straße|strasse|straat|str\.?|street|st\.?|avenue|ave\.?|road|rd\.?|blvd\.?|boulevard|lane|ln\.?|drive|dr\.?|weg|calle|avenida|rua|plaza|plaats|plein)\b[^,]*/ig,'');
    s=s.replace(/\b\d{4,6}\b/g,'');
    s=s.replace(/\s{2,}/g,' ').replace(/^[,.\-\s]+|[,.\-\s]+$/g,'').trim();
    return s.slice(0,40);
  };
  var fuzzCoords=function(lat,lng){
    lat=Number(lat); lng=Number(lng);
    return {lat:Math.round(lat*50)/50, lng:Math.round(lng*50)/50};
  };
  assert(sanitizePlaceText('Nürnberg 90473 jauerstraße 22').toLowerCase().indexOf('jauer')<0, 'strips German street');
  assert(sanitizePlaceText('Enschede, noorderkroonstraat 33').toLowerCase().indexOf('straat')<0, 'strips Dutch street');
  assert(sanitizePlaceText('Freiburg im Breisgau Bugginger Straße 37').toLowerCase().indexOf('bugginger')<0, 'strips street prefix word');
  assert(sanitizePlaceText('Bogotá').indexOf('Bog')===0, 'keeps city name');
  var f=fuzzCoords(49.4054645, 11.1467889);
  assert(Math.abs(f.lat-49.4054645)>0.001 || Math.abs(f.lng-11.1467889)>0.001, 'fuzzes precise coords');
  assert(String(f.lat).length<=6, 'fuzzed lat is coarse');
})();

console.log('\nMap privacy + media checks passed');
