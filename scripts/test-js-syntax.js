#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var scripts = [];
var re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
var m;
while ((m = re.exec(html))) scripts.push(m[1]);
var main = scripts.sort(function (a, b) { return b.length - a.length; })[0];
try {
  // eslint-disable-next-line no-new-func
  new Function(main);
  console.log('PASS · main inline script parses');
} catch (e) {
  console.error('FAIL · main script SyntaxError:', e.message);
  process.exit(1);
}
if (/\btoast\(\s*'[^']*;/.test(html)) {
  console.error('FAIL · toast(...; missing closing paren');
  process.exit(1);
}
console.log('PASS · no toast(\'...\'; pattern');
console.log('\nJS syntax checks passed');
