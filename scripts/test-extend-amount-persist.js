#!/usr/bin/env node
/**
 * Live persist check: createCfPost-style SB insert with ext_1440 must store
 * extend_amount=1440 (not the DB default / cooldown-shaped 360).
 * Also asserts SPA helpers normalize expires_at and prefer tags on write.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

function extractFn(src, name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}');
  var m = src.match(re);
  if (!m) throw new Error('missing function ' + name);
  return m[0];
}

assert(html.includes('function normalizeExpiresAtForDb'), 'normalizeExpiresAtForDb present');
assert(html.includes('function intendedExtendAmountForWrite'), 'intendedExtendAmountForWrite present');
assert(html.includes('function reconcilePostExtendAmount'), 'reconcilePostExtendAmount present');
assert(html.includes('expires_at:payload.expires_at||null') || html.includes('expires_at:payload.expires_at || null'), 'publish no longer Date.parse-only into createCfPost');
assert(!/expires_at:payload\.expires_at\?Date\.parse\(payload\.expires_at\):null/.test(html), 'removed Date.parse expires_at on createCfPost call');
assert(/normalizeExpiresAtForDb\(row\.expires_at\)/.test(html), 'createCfPost normalizes expires_at for SB');
assert(/reconcilePostExtendAmount\(row\.id,\s*wantExt\)/.test(html), 'publish reconciles extend_amount after save');
assert(/extendAmount:cachedAmt>0\?cachedAmt:undefined/.test(html), 'writePostCache keeps extendAmount');

var helpers = [
  extractFn(html, 'parseExtendMins'),
  extractFn(html, 'clampPubExtendMinutes'),
  extractFn(html, 'tagExtendMinutes'),
  extractFn(html, 'columnExtendMinutes'),
  extractFn(html, 'resolveExtendAmountMinutes'),
  extractFn(html, 'normalizeExpiresAtForDb'),
  extractFn(html, 'intendedExtendAmountForWrite')
].join('\n');

var sandbox = Function(
  helpers +
    '\nreturn {normalizeExpiresAtForDb:normalizeExpiresAtForDb,intendedExtendAmountForWrite:intendedExtendAmountForWrite,resolveExtendAmountMinutes:resolveExtendAmountMinutes};'
)();

var ms = Date.now() + 1440 * 60000;
var iso = sandbox.normalizeExpiresAtForDb(ms);
assert(typeof iso === 'string' && iso.indexOf('T') > 0, 'epoch ms → ISO for DB');
assert(sandbox.normalizeExpiresAtForDb(iso) === iso || Date.parse(sandbox.normalizeExpiresAtForDb(iso)) === Date.parse(iso), 'ISO stays ISO');
assert(
  sandbox.intendedExtendAmountForWrite({ extend_amount: 360, tags: ['ext_1440'] }, ['ext_1440']) === 1440,
  'write intent prefers ext_1440 over stale 360 column'
);
assert(
  sandbox.intendedExtendAmountForWrite({ extend_amount: 1440, tags: ['exposed'] }, ['exposed']) === 1440,
  'write intent uses column when no tag'
);

(async function live() {
  const SB = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
  const KEY =
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
  const sb = createClient(SB, KEY);

  // Simulate broken pre-fix path: raw ms expires_at must fail (documents root cause).
  var bad = await sb
    .from('posts')
    .insert({
      username: '__ext_persist_probe__',
      title: 'bad-ms-expires',
      description: 'probe',
      tags: ['exposed', 'ext_1440', 'probe_delete'],
      image_url: 'https://placehold.co/10x10.png',
      expires_at: ms,
      extend_amount: 1440
    })
    .select('id,extend_amount')
    .limit(1);
  assert(!!(bad && bad.error), 'raw epoch-ms expires_at is rejected by Supabase (root cause of fallback)');

  // Fixed path: ISO + intended 1440
  var intended = sandbox.intendedExtendAmountForWrite(
    { extend_amount: 1440, extend_mins: 1440, tags: ['exposed', 'ext_1440'] },
    ['exposed', 'ext_1440']
  );
  assert(intended === 1440, 'intended amount for 24h selection is 1440');

  var ok = await sb
    .from('posts')
    .insert({
      username: '__ext_persist_probe__',
      title: 'extend-24h-persist-probe',
      description: 'probe — delete me',
      tags: ['exposed', 'gender_man', 'man', 'ext_1440', 'del:deletable', 'probe_delete'],
      image_url: 'https://placehold.co/10x10.png',
      expires_at: sandbox.normalizeExpiresAtForDb(ms),
      extend_amount: intended
    })
    .select('id,extend_amount,tags,expires_at')
    .limit(1);

  assert(!(ok && ok.error), 'fixed insert succeeds: ' + ((ok && ok.error && ok.error.message) || ''));
  var row = ok && ok.data && ok.data[0];
  assert(row && row.id, 'probe row created');
  assert(Number(row.extend_amount) === 1440, 'stored extend_amount is 1440 (not 360)');
  assert(
    sandbox.resolveExtendAmountMinutes(row, row.tags) === 1440,
    'resolver reads 1440 for probe post'
  );

  // Simulate DB default leak then reconcile
  var leak = await sb
    .from('posts')
    .insert({
      username: '__ext_persist_probe__',
      title: 'extend-default-leak-probe',
      description: 'probe',
      tags: ['exposed', 'ext_1440', 'probe_delete'],
      image_url: 'https://placehold.co/10x10.png',
      expires_at: sandbox.normalizeExpiresAtForDb(Date.now() + 3600000)
      // omit extend_amount → DB default 360
    })
    .select('id,extend_amount,tags')
    .limit(1);
  var leakRow = leak && leak.data && leak.data[0];
  assert(leakRow && Number(leakRow.extend_amount) === 360, 'omitted column defaults to 360');
  var want = sandbox.intendedExtendAmountForWrite(leakRow, leakRow.tags);
  assert(want === 1440, 'reconcile intent from ext_1440 is 1440');
  var patched = await sb
    .from('posts')
    .update({ extend_amount: want })
    .eq('id', leakRow.id)
    .select('id,extend_amount')
    .maybeSingle();
  assert(patched && patched.data && Number(patched.data.extend_amount) === 1440, 'reconcile PATCHes 1440');

  // Cleanup
  await sb.from('posts').delete().eq('username', '__ext_persist_probe__');
  console.log('\nExtend amount persist checks passed');
})().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
