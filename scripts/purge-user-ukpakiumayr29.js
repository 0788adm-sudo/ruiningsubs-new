#!/usr/bin/env node
/**
 * Administrator permanent purge for @UkPakiUmayr29 (and rename alias @UkPaki29).
 *
 * Scope (STRICT):
 *  - profiles: UkPakiUmayr29, UkPaki29 only
 *  - posts: username exact-match those two only (never other usernames, even if anon_id tag matches)
 *  - comments / saves / follows / messages / notifications / wallets tied to those usernames
 *  - media files referenced by THIS user's posts + avatar
 *
 * Does NOT touch @ExposingIqra or any other account (shared anon session tags are ignored for ownership).
 *
 * Usage:
 *   node scripts/purge-user-ukpakiumayr29.js --dry-run
 *   node scripts/purge-user-ukpakiumayr29.js --execute
 */
'use strict';

const SB_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';

/** Canonical + historical display names for THIS account only. */
const TARGET_USERNAMES = ['UkPakiUmayr29', 'UkPaki29'];
const TARGET_USERNAMES_LOWER = TARGET_USERNAMES.map((u) => u.toLowerCase());

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run') || !args.includes('--execute');

function isTargetUsername(name) {
  return TARGET_USERNAMES_LOWER.indexOf(String(name || '').replace(/^@/, '').trim().toLowerCase()) >= 0;
}

async function sb(path, opts) {
  opts = opts || {};
  const headers = Object.assign(
    {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      Accept: 'application/json',
      Prefer: opts.prefer || 'return=representation'
    },
    opts.headers || {}
  );
  const r = await fetch(SB_URL + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body,
    cache: 'no-store'
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  return { ok: r.ok, status: r.status, data: data, cr: r.headers.get('content-range') || '' };
}

function orEq(col, values) {
  return values.map((v) => col + '.eq.' + encodeURIComponent(v)).join(',');
}

function extractMediaKeys(value, into) {
  const set = into || new Set();
  function addUrl(u) {
    if (!u || typeof u !== 'string') return;
    let m = u.match(/\/media\/([^?\s"'\\]+)/i);
    if (m && m[1]) {
      try {
        set.add(decodeURIComponent(m[1]));
      } catch (_) {
        set.add(m[1]);
      }
    }
    m = u.match(/r2\.dev\/([^?\s"'\\]+)/i);
    if (m && m[1]) {
      try {
        set.add(decodeURIComponent(m[1]));
      } catch (_) {
        set.add(m[1]);
      }
    }
  }
  function walk(v) {
    if (v == null) return;
    if (typeof v === 'string') {
      const s = v.trim();
      if ((s.startsWith('[') || s.startsWith('{')) && s.length > 2) {
        try {
          walk(JSON.parse(s));
          return;
        } catch (_) {}
      }
      addUrl(s);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k]));
  }
  walk(value);
  if (Array.isArray(value)) {
    value.forEach((t) => {
      const s = String(t || '');
      if (s.indexOf('album:') === 0) {
        try {
          walk(Buffer.from(s.slice(6), 'base64').toString('utf8'));
        } catch (_) {}
      }
    });
  }
  return set;
}

async function countPosts() {
  const r = await sb('/rest/v1/posts?select=id', {
    prefer: 'count=exact',
    headers: { 'Range-Unit': 'items', Range: '0-0' }
  });
  const m = String(r.cr || '').match(/\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  console.log('=== Permanent purge @UkPakiUmayr29 ===');
  console.log('Mode:', DRY ? 'DRY-RUN (pass --execute to apply)' : 'EXECUTE');
  console.log('Targets:', TARGET_USERNAMES.join(', '));

  const beforeTotal = await countPosts();
  console.log('Posts in DB (before):', beforeTotal);

  // --- Inventory posts (username ownership only) ---
  const postsRes = await sb(
    '/rest/v1/posts?select=id,username,title,image_url,tags,created_at&or=(' +
      orEq('username', TARGET_USERNAMES) +
      ')&order=id.asc'
  );
  if (!postsRes.ok) throw new Error('posts_query_failed ' + postsRes.status + ' ' + JSON.stringify(postsRes.data));
  const posts = (postsRes.data || []).filter((p) => isTargetUsername(p.username));
  const rejected = (postsRes.data || []).filter((p) => !isTargetUsername(p.username));
  if (rejected.length) {
    throw new Error('safety_abort: unexpected non-target username in query: ' + rejected.map((p) => p.id + ':' + p.username).join(','));
  }
  console.log('Target posts:', posts.length, posts.map((p) => p.id).join(', '));

  const media = new Set();
  posts.forEach((p) => {
    extractMediaKeys(p.image_url, media);
    extractMediaKeys(p.tags, media);
  });

  const profilesRes = await sb(
    '/rest/v1/profiles?select=username,status,banned,avatar_url,xp&or=(' + orEq('username', TARGET_USERNAMES) + ')'
  );
  const profiles = (profilesRes.data || []).filter((p) => isTargetUsername(p.username));
  profiles.forEach((p) => extractMediaKeys(p.avatar_url, media));
  console.log(
    'Target profiles:',
    profiles.map((p) => p.username + '(' + (p.status || '') + ')').join(', ')
  );
  console.log('Media keys to delete:', media.size);

  // Related rows
  const commentsRes = await sb('/rest/v1/comments?select=id,username,post_id&or=(' + orEq('username', TARGET_USERNAMES) + ')');
  const comments = commentsRes.ok ? commentsRes.data || [] : [];
  console.log('Comments:', comments.length);

  const savesRes = await sb('/rest/v1/user_saves?select=*&or=(' + orEq('username', TARGET_USERNAMES) + ')');
  const saves = savesRes.ok ? savesRes.data || [] : [];
  console.log('User saves:', saves.length);

  const followsRes = await sb(
    '/rest/v1/follows?select=*&or=(' + orEq('follower', TARGET_USERNAMES) + ',' + orEq('following', TARGET_USERNAMES) + ')'
  );
  const follows = followsRes.ok ? followsRes.data || [] : [];
  console.log('Follows:', follows.length);

  const msgsRes = await sb(
    '/rest/v1/messages?select=id,from_user,to_user&or=(' +
      orEq('from_user', TARGET_USERNAMES) +
      ',' +
      orEq('to_user', TARGET_USERNAMES) +
      ')'
  );
  const messages = msgsRes.ok ? msgsRes.data || [] : [];
  console.log('Messages (from/to target):', messages.length);

  const notifsRes = await sb(
    '/rest/v1/notifications?select=id&or=(' +
      orEq('from_username', TARGET_USERNAMES) +
      ',' +
      orEq('to_username', TARGET_USERNAMES) +
      ')&limit=1000'
  );
  const notifs = notifsRes.ok ? notifsRes.data || [] : [];
  console.log('Notifications:', notifs.length);

  const walletIds = TARGET_USERNAMES.concat(['ukpakiumayr29', 'ukpaki29']);
  const wallets = [];
  for (let i = 0; i < walletIds.length; i++) {
    const w = await sb('/rest/v1/coin_wallets?select=*&user_id=eq.' + encodeURIComponent(walletIds[i]));
    if (w.ok && Array.isArray(w.data)) wallets.push.apply(wallets, w.data);
  }
  console.log('Wallets:', wallets.length);

  // Saves of THIS user's posts by anyone (orphaned after post delete — clean by post_id)
  const postIds = posts.map((p) => p.id);
  let savesByPost = [];
  if (postIds.length) {
    const sp = await sb('/rest/v1/user_saves?select=*&post_id=in.(' + postIds.join(',') + ')');
    savesByPost = sp.ok ? sp.data || [] : [];
  }
  console.log('Saves referencing target posts:', savesByPost.length);

  if (DRY) {
    console.log('\nDRY-RUN complete — no changes written.');
    console.log('Re-run with --execute to permanently delete.');
    return { dry: true, posts: posts.length, media: media.size };
  }

  const summary = {
    postsDeleted: [],
    postsFailed: [],
    mediaDeleted: [],
    mediaFailed: [],
    mediaMissing: [],
    profilesTombstoned: [],
    commentsDeleted: 0,
    savesDeleted: 0,
    followsDeleted: 0,
    messagesDeleted: 0,
    notifsDeleted: 0,
    walletsDeleted: 0,
    cfPostDeletes: 0
  };

  // 1) Delete posts one-by-one with ownership re-check
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (!isTargetUsername(p.username)) {
      summary.postsFailed.push({ id: p.id, error: 'ownership_guard' });
      continue;
    }
    // Re-fetch to confirm still owned by target
    const live = await sb('/rest/v1/posts?select=id,username&id=eq.' + encodeURIComponent(String(p.id)) + '&limit=1');
    const row = live.ok && Array.isArray(live.data) && live.data[0];
    if (!row) {
      summary.postsDeleted.push(p.id);
      continue;
    }
    if (!isTargetUsername(row.username)) {
      summary.postsFailed.push({ id: p.id, error: 'ownership_changed:' + row.username });
      continue;
    }
    const del = await sb('/rest/v1/posts?id=eq.' + encodeURIComponent(String(p.id)), {
      method: 'DELETE',
      prefer: 'return=representation'
    });
    if (del.ok && Array.isArray(del.data) && del.data.length) {
      summary.postsDeleted.push(p.id);
    } else if (del.ok) {
      // verify gone
      const check = await sb('/rest/v1/posts?select=id&id=eq.' + encodeURIComponent(String(p.id)) + '&limit=1');
      if (check.ok && (!check.data || !check.data.length)) summary.postsDeleted.push(p.id);
      else summary.postsFailed.push({ id: p.id, error: 'delete_noop', detail: del.data });
    } else {
      summary.postsFailed.push({ id: p.id, error: 'http_' + del.status, detail: del.data });
    }
    // CF mirror (best-effort)
    try {
      const cfr = await fetch(CF_API + '/posts/' + encodeURIComponent(String(p.id)), {
        method: 'DELETE',
        headers: { Origin: SITE },
        cache: 'no-store'
      });
      if (cfr.ok || cfr.status === 404) summary.cfPostDeletes++;
    } catch (_) {}
  }

  // 2) Media files from R2 via Worker DELETE
  const keys = Array.from(media).sort();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const r = await fetch(CF_API + '/media/' + key.split('/').map(encodeURIComponent).join('/'), {
        method: 'DELETE',
        headers: { Origin: SITE },
        cache: 'no-store'
      });
      const body = await r.text().catch(() => '');
      if (r.ok || r.status === 204) summary.mediaDeleted.push(key);
      else if (r.status === 404) summary.mediaMissing.push(key);
      else summary.mediaFailed.push({ key: key, status: r.status, body: String(body).slice(0, 120) });
    } catch (e) {
      summary.mediaFailed.push({ key: key, error: String(e && e.message ? e.message : e) });
    }
  }

  // 3) Comments by target
  if (comments.length) {
    const d = await sb('/rest/v1/comments?or=(' + orEq('username', TARGET_USERNAMES) + ')', {
      method: 'DELETE',
      prefer: 'return=representation'
    });
    summary.commentsDeleted = d.ok && Array.isArray(d.data) ? d.data.length : 0;
  }

  // 4) Saves
  if (saves.length || savesByPost.length) {
    const d1 = await sb('/rest/v1/user_saves?or=(' + orEq('username', TARGET_USERNAMES) + ')', {
      method: 'DELETE',
      prefer: 'return=representation'
    });
    let n = d1.ok && Array.isArray(d1.data) ? d1.data.length : 0;
    if (postIds.length) {
      const d2 = await sb('/rest/v1/user_saves?post_id=in.(' + postIds.join(',') + ')', {
        method: 'DELETE',
        prefer: 'return=representation'
      });
      n += d2.ok && Array.isArray(d2.data) ? d2.data.length : 0;
    }
    summary.savesDeleted = n;
  }

  // 5) Follows
  if (follows.length) {
    const d = await sb(
      '/rest/v1/follows?or=(' + orEq('follower', TARGET_USERNAMES) + ',' + orEq('following', TARGET_USERNAMES) + ')',
      { method: 'DELETE', prefer: 'return=representation' }
    );
    summary.followsDeleted = d.ok && Array.isArray(d.data) ? d.data.length : 0;
  }

  // 6) Messages — hard delete when RLS allows; otherwise scrub bodies FROM target only
  summary.messagesScrubbed = 0;
  if (messages.length) {
    const d = await sb(
      '/rest/v1/messages?or=(' + orEq('from_user', TARGET_USERNAMES) + ',' + orEq('to_user', TARGET_USERNAMES) + ')',
      { method: 'DELETE', prefer: 'return=representation' }
    );
    summary.messagesDeleted = d.ok && Array.isArray(d.data) ? d.data.length : 0;
    if (!summary.messagesDeleted) {
      const fromTarget = await sb(
        '/rest/v1/messages?select=id,from_user&or=(' + orEq('from_user', TARGET_USERNAMES) + ')'
      );
      const rows = fromTarget.ok ? fromTarget.data || [] : [];
      for (let i = 0; i < rows.length; i++) {
        if (!isTargetUsername(rows[i].from_user)) continue;
        const u = await sb('/rest/v1/messages?id=eq.' + encodeURIComponent(String(rows[i].id)), {
          method: 'PATCH',
          prefer: 'return=representation',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: '[account permanently deleted]', image_url: null })
        });
        if (u.ok && Array.isArray(u.data) && u.data.length) summary.messagesScrubbed++;
      }
    }
  }

  // 7) Notifications — hard delete when RLS allows; otherwise scrub message text
  summary.notifsScrubbed = 0;
  if (notifs.length) {
    for (let i = 0; i < notifs.length; i += 50) {
      const chunk = notifs.slice(i, i + 50).map((n) => n.id);
      const d = await sb('/rest/v1/notifications?id=in.(' + chunk.join(',') + ')', {
        method: 'DELETE',
        prefer: 'return=representation'
      });
      const nDel = d.ok && Array.isArray(d.data) ? d.data.length : 0;
      summary.notifsDeleted += nDel;
      if (!nDel) {
        for (let j = 0; j < chunk.length; j++) {
          const u = await sb('/rest/v1/notifications?id=eq.' + encodeURIComponent(String(chunk[j])), {
            method: 'PATCH',
            prefer: 'return=representation',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: '[account permanently deleted]', read: true })
          });
          if (u.ok && Array.isArray(u.data) && u.data.length) summary.notifsScrubbed++;
        }
      }
    }
  }

  // 8) Wallets
  for (let i = 0; i < wallets.length; i++) {
    const uid = wallets[i].user_id;
    if (!uid) continue;
    const d = await sb('/rest/v1/coin_wallets?user_id=eq.' + encodeURIComponent(uid), {
      method: 'DELETE',
      prefer: 'return=representation'
    });
    if (d.ok && Array.isArray(d.data)) summary.walletsDeleted += d.data.length;
  }

  // 9) Tombstone profiles (prevent username reuse; keep banned/deleted shell)
  for (let i = 0; i < TARGET_USERNAMES.length; i++) {
    const uname = TARGET_USERNAMES[i];
    const patch = {
      status: 'deleted',
      banned: true,
      suspended: false,
      avatar_url: null,
      telegram: '',
      twitter: '',
      link: '',
      bio: '',
      xp: 0,
      updated_at: new Date().toISOString()
    };
    const exists = profiles.some((p) => String(p.username) === uname);
    if (exists) {
      const u = await sb('/rest/v1/profiles?username=eq.' + encodeURIComponent(uname), {
        method: 'PATCH',
        prefer: 'return=representation',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (u.ok && Array.isArray(u.data) && u.data.length) {
        summary.profilesTombstoned.push(uname);
      } else {
        // fallback: hard delete if patch fails
        const del = await sb('/rest/v1/profiles?username=eq.' + encodeURIComponent(uname), {
          method: 'DELETE',
          prefer: 'return=representation'
        });
        if (del.ok) summary.profilesTombstoned.push(uname + '(deleted)');
      }
    } else {
      // Insert tombstone so the username cannot be claimed again via upsert
      const ins = await sb('/rest/v1/profiles', {
        method: 'POST',
        prefer: 'return=representation',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(Object.assign({ username: uname }, patch))
      });
      if (ins.ok) summary.profilesTombstoned.push(uname + '(created_tombstone)');
    }
  }

  const afterTotal = await countPosts();
  const remaining = await sb(
    '/rest/v1/posts?select=id,username&or=(' + orEq('username', TARGET_USERNAMES) + ')'
  );

  console.log('\n=== PURGE SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Posts in DB after:', afterTotal, '(delta', beforeTotal != null && afterTotal != null ? afterTotal - beforeTotal : '?', ')');
  console.log('Remaining target posts:', remaining.data);

  if (summary.postsFailed.length) {
    console.error('WARNING: some posts failed to delete');
    process.exitCode = 2;
  }
  if (remaining.ok && Array.isArray(remaining.data) && remaining.data.length) {
    console.error('WARNING: target posts still present');
    process.exitCode = 2;
  }

  // Collateral check: ensure ExposingIqra post 3892 still exists
  const other = await sb('/rest/v1/posts?select=id,username&id=eq.3892');
  if (!other.ok || !other.data || !other.data.length || other.data[0].username !== 'ExposingIqra') {
    console.error('CRITICAL: unrelated post 3892 missing or changed — investigate immediately');
    process.exitCode = 3;
  } else {
    console.log('Collateral OK: post 3892 @ExposingIqra preserved');
  }

  return summary;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
