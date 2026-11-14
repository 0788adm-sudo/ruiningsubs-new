#!/usr/bin/env node
/**
 * Request Delete FC button — reuse Premium Pin spend path, never auto-delete.
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

assert(html.indexOf('function requestDeleteWithCoins') >= 0, 'requestDeleteWithCoins helper');
assert(html.indexOf("spendFagCoins('delete'") >= 0, 'reuses spendFagCoins delete action');
assert(html.indexOf("spendFagCoins('pin'") >= 0, 'Premium Pin spend path still present');
assert(/Delete now — \$\{?delCost|Delete now — '\+delCost|Delete now — '\+.*FC_COSTS/.test(html) || html.indexOf("Delete now — '+delCost+' FC") >= 0, 'Request Delete shows Delete now — N FC');
assert(html.indexOf("fc.setAttribute('onclick','requestDeleteWithCoins()')") >= 0, 'non-owner FC button wires requestDeleteWithCoins');
assert(!/!owner\)\{[\s\S]{0,500}fc\.style\.display='none'/.test(html), 'non-owner path no longer hides FC button');
assert(html.indexOf('paidWithFc:true') >= 0 || html.indexOf('paidWithFc: true') >= 0, 'FC request marks paidWithFc');
assert(html.indexOf('auto_delete:false') >= 0 || html.indexOf('DO NOT auto-delete') >= 0, 'admin payload says no auto-delete');
assert(html.indexOf('openNeedCoins({cost:cost,why:\'delete\'})') >= 0 || html.indexOf('openNeedCoins({cost:cost,why:"delete"})') >= 0 || /openNeedCoins\(\{cost:cost,why:'delete'\}/.test(html), 'insufficient FC opens Buy coins');
assert(html.indexOf('function pinWithCoins') >= 0, 'Premium Pin unchanged (pinWithCoins exists)');
assert(html.indexOf('Pin now — 50 FC') >= 0, 'Premium Pin yellow button copy kept');
assert(html.indexOf('btn-remove-paypal') >= 0 && html.indexOf('btn-remove-throne') >= 0, 'PayPal and Throne kept');
assert(html.indexOf("FC_COSTS = {pin:50") >= 0 || html.indexOf('FC_COSTS={pin:50') >= 0 || /FC_COSTS\s*=\s*\{[^}]*pin\s*:\s*50/.test(html), 'shared FC_COSTS.delete/pin table');
assert(/delete\s*:\s*50/.test(html), 'FC_COSTS.delete is 50');

console.log('OK · request-delete-fc');
