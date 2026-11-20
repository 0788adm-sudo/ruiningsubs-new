#!/usr/bin/env node
/**
 * Coin request cards show exact created_at in America/Bogota — display only.
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

assert(html.indexOf('function formatAdminBogotaDateTime') >= 0, 'Bogota datetime helper present');
assert(html.indexOf("timeZone:'America/Bogota'") >= 0, 'America/Bogota timezone');
assert(html.indexOf('hour12:false') >= 0, 'exact 24h clock with seconds');
assert(/async function renderAdminPays[\s\S]*?formatAdminBogotaDateTime\(r\.created_at/.test(html), 'Coin cards use stored created_at');
assert(/async function renderAdminPays[\s\S]*?Solicitud:/.test(html), 'Coin cards show Solicitud label');
assert(html.indexOf("data-admin=\"coin-approve\"") >= 0, 'approve button unchanged');
assert(html.indexOf("data-admin=\"coin-reject\"") >= 0, 'reject button unchanged');
assert(html.indexOf('async function approveCoinRequestCustom') >= 0, 'approve logic preserved');
assert(html.indexOf('async function rejectCoinRequestAdmin') >= 0, 'reject logic preserved');
assert(html.indexOf('cfAdminApproveRequest') >= 0 && html.indexOf('cfAdminRejectRequest') >= 0, 'CF approve/reject endpoints preserved');

// Pure formatter unit check (mirrors adminRequestTimestamp + Bogota format).
function adminRequestTimestamp(v){
  if(v==null||v==='') return 0;
  if(typeof v==='number' && isFinite(v)){
    if(v<=0) return 0;
    return v < 1e12 ? Math.round(v*1000) : Math.round(v);
  }
  var s=String(v).trim();
  if(!s) return 0;
  if(/^\d+(\.\d+)?$/.test(s)){
    var n=Number(s);
    if(!isFinite(n)||n<=0) return 0;
    return n < 1e12 ? Math.round(n*1000) : Math.round(n);
  }
  var t=Date.parse(s);
  return isFinite(t) && t>0 ? t : 0;
}
function formatAdminBogotaDateTime(v){
  var ms=adminRequestTimestamp(v);
  if(!ms) return '';
  var d=new Date(ms);
  var date=d.toLocaleDateString('es-CO',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'});
  var time=d.toLocaleTimeString('es-CO',{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  return date+' · '+time+' (America/Bogota)';
}

var iso='2026-11-20T23:51:07.000Z'; // 18:51:07 Colombia (UTC-5)
var out=formatAdminBogotaDateTime(iso);
assert(/18:51:07/.test(out), 'ISO UTC converts to Bogota wall clock: '+out);
assert(/America\/Bogota/.test(out), 'timezone label present: '+out);
assert(formatAdminBogotaDateTime(null)==='', 'missing created_at → empty (no Date.now fallback)');
assert(formatAdminBogotaDateTime(1763682667000).indexOf('18:51:07')>=0, 'epoch ms also formats');

// Ensure two requests with different created_at stay independent (no shared clock).
var a=formatAdminBogotaDateTime('2026-11-20T15:00:00.000Z');
var b=formatAdminBogotaDateTime('2026-11-20T16:30:45.000Z');
assert(a!==b && /10:00:00/.test(a) && /11:30:45/.test(b), 'independent per-request times: '+a+' vs '+b);

console.log('\nCoin request Bogota time checks passed');
