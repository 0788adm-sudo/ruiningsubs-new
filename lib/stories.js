/**
 * RuinExpose Stories — server API helpers.
 * Prefer dedicated stories / story_views / story_likes tables when present.
 * Fallback: posts rows tagged __story__ (+ notifications for view receipts).
 * Delete is always free for owner (token/hash) or verified admin.
 */
'use strict';

const crypto = require('crypto');

const STORY_TAG = '__story__';
const STORY_DELETED_TAG = 'story_deleted';
const STORY_MS = 24 * 60 * 60 * 1000;
const MAX_STORIES_PER_PUBLISHER_24H = 12;
const MAX_MEDIA_URL = 1200;
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const MEDIA_HOSTS = [
  'ruiningsubs-api.0788adm.workers.dev',
  'pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev',
  'www.ruinexpose.com',
  'ruinexpose.com',
  'www.ruiningsubs.com',
  'ruiningsubs.com'
];

const SB_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

var _nativeStories = null; // null unknown, true/false after probe

function sha256Hex(v) {
  return crypto.createHash('sha256').update(String(v || ''), 'utf8').digest('hex');
}

function normUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .slice(0, 64);
}

function cleanUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .slice(0, 40);
}

function sanitizeAnonId(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);
}

function isAnonName(name) {
  var n = normUser(name);
  return (
    !n ||
    n === 'guest' ||
    n === 'anon' ||
    n.indexOf('anon_') === 0 ||
    n.indexOf('anon:') === 0 ||
    /^anon\d*$/i.test(n)
  );
}

function viewerKey(opts) {
  opts = opts || {};
  var user = cleanUser(opts.username || opts.user || '');
  if (user && !isAnonName(user)) return 'u:' + normUser(user);
  var anon = sanitizeAnonId(opts.anon_id || opts.anonymous_user_id || '');
  if (anon && anon.length >= 8) return 'a:' + anon;
  var sess = String(opts.session_key || opts.viewer_key || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
  if (sess.length >= 8) return 's:' + sess;
  return '';
}

function mintOwnerToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function sbRest(path, opts) {
  opts = opts || {};
  var r = await fetch(SB_URL + path, {
    method: opts.method || 'GET',
    headers: Object.assign(
      {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation'
      },
      opts.headers || {}
    ),
    body: opts.body || undefined,
    cache: 'no-store'
  });
  var text = await r.text();
  var data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  return { ok: r.ok, status: r.status, data: data };
}

async function nativeStoriesAvailable() {
  if (_nativeStories != null) return _nativeStories;
  try {
    var r = await sbRest('/rest/v1/stories?select=id&limit=1');
    _nativeStories = !!(r.ok && Array.isArray(r.data));
  } catch (e) {
    _nativeStories = false;
  }
  return _nativeStories;
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    var j = JSON.parse(String(raw));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return { legacy_text: String(raw).slice(0, 200) };
  }
}

function isAllowedMediaUrl(url) {
  url = String(url || '').trim();
  if (!url || url.length > MAX_MEDIA_URL) return false;
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(url) && url.length < 900000) return true;
  try {
    var u = new URL(url);
    if (u.protocol !== 'https:') return false;
    var host = String(u.hostname || '').toLowerCase();
    if (MEDIA_HOSTS.indexOf(host) >= 0) return true;
    if (/\.r2\.dev$/i.test(host)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function postIsStory(row) {
  var tags = row && row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = [];
    }
  }
  if (!Array.isArray(tags)) return false;
  return tags.map(function (t) {
    return String(t || '').toLowerCase();
  }).indexOf(STORY_TAG) >= 0;
}

function postIsDeletedStory(row) {
  var tags = row && row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = [];
    }
  }
  if (!Array.isArray(tags)) tags = [];
  var low = tags.map(function (t) {
    return String(t || '').toLowerCase();
  });
  if (low.indexOf(STORY_DELETED_TAG) >= 0) return true;
  var meta = parseMeta(row && row.description);
  return !!(meta.deleted || meta.deleted_at);
}

function mapPostStory(row, extras) {
  extras = extras || {};
  var meta = parseMeta(row.description);
  var created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  var expires = row.expires_at ? new Date(row.expires_at).getTime() : created + STORY_MS;
  var likedBy = Array.isArray(row.liked_by) ? row.liked_by : [];
  if (typeof row.liked_by === 'string') {
    try {
      likedBy = JSON.parse(row.liked_by) || [];
    } catch (e) {
      likedBy = [];
    }
  }
  var me = extras.viewer_key || '';
  var liked = !!(me && likedBy.some(function (k) {
    return String(k).toLowerCase() === String(me).toLowerCase();
  }));
  return {
    id: String(row.id),
    legacy_id: meta.legacy_id || null,
    user: row.username || meta.username || 'anon',
    username: row.username || meta.username || 'anon',
    anon_id: meta.anon_id || null,
    account_type: meta.account_type || (isAnonName(row.username) ? 'anonymous' : 'registered'),
    url: row.image_url || meta.media_url || '',
    media_url: row.image_url || meta.media_url || '',
    thumb: row.image_url || meta.thumb_url || meta.media_url || '',
    thumb_url: row.image_url || meta.thumb_url || meta.media_url || '',
    avatar_url: meta.avatar_url || '',
    at: created,
    created_at: created,
    expires_at: expires,
    views: Number(row.views || 0) || 0,
    likes: Number(row.likes_count || 0) || 0,
    liked: liked,
    is_owner: !!extras.is_owner,
    can_delete: !!extras.can_delete,
    deleted: postIsDeletedStory(row),
    storage: 'posts'
  };
}

function mapNativeStory(row, extras) {
  extras = extras || {};
  var created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  var expires = row.expires_at ? new Date(row.expires_at).getTime() : created + STORY_MS;
  return {
    id: 'ns_' + String(row.id),
    native_id: row.id,
    legacy_id: row.legacy_id || null,
    user: row.username,
    username: row.username,
    anon_id: row.anon_id || null,
    account_type: row.account_type || 'anonymous',
    url: row.media_url,
    media_url: row.media_url,
    thumb: row.thumb_url || row.media_url,
    thumb_url: row.thumb_url || row.media_url,
    avatar_url: row.avatar_url || '',
    at: created,
    created_at: created,
    expires_at: expires,
    views: Number(row.views_count || 0) || 0,
    likes: Number(row.likes_count || 0) || 0,
    liked: !!extras.liked,
    is_owner: !!extras.is_owner,
    can_delete: !!extras.can_delete,
    deleted: !!row.deleted_at,
    storage: 'stories'
  };
}

function activeFilterIso(now) {
  return new Date(now || Date.now()).toISOString();
}

async function listPostStories(opts) {
  opts = opts || {};
  var nowIso = activeFilterIso();
  // Prefer tagged contains filter; fall back to a wider recent scan.
  var r = await sbRest(
    '/rest/v1/posts?tags=cs.%7B%22__story__%22%7D&select=id,username,title,description,tags,image_url,created_at,expires_at,views,likes_count,liked_by&order=created_at.desc&limit=200'
  );
  if (!r.ok || !Array.isArray(r.data)) {
    r = await sbRest(
      '/rest/v1/posts?select=id,username,title,description,tags,image_url,created_at,expires_at,views,likes_count,liked_by&order=created_at.desc&limit=400'
    );
  }
  if (!r.ok || !Array.isArray(r.data)) return [];
  var viewer = viewerKey(opts);
  var ownerTok = String(opts.owner_token || '');
  var ownerHash = ownerTok ? sha256Hex(ownerTok) : '';
  var admin = !!opts.is_admin;
  var out = [];
  r.data.forEach(function (row) {
    if (!postIsStory(row)) return;
    if (postIsDeletedStory(row)) return;
    var exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (!exp || exp <= Date.now()) return;
    var meta = parseMeta(row.description);
    var isOwner =
      (!!ownerHash && meta.owner_hash === ownerHash) ||
      (!!opts.username && normUser(opts.username) === normUser(row.username) && !isAnonName(opts.username)) ||
      (!!opts.anon_id && meta.anon_id && sanitizeAnonId(opts.anon_id) === sanitizeAnonId(meta.anon_id));
    out.push(
      mapPostStory(row, {
        viewer_key: viewer,
        is_owner: isOwner,
        can_delete: isOwner || admin
      })
    );
  });
  if (opts.username) {
    var u = normUser(opts.username);
    out = out.filter(function (s) {
      return normUser(s.user) === u;
    });
  }
  out.sort(function (a, b) {
    return (b.at || 0) - (a.at || 0);
  });
  return out;
}

async function listNativeStories(opts) {
  opts = opts || {};
  var nowIso = activeFilterIso();
  var q =
    '/rest/v1/stories?select=*&deleted_at=is.null&expires_at=gt.' +
    encodeURIComponent(nowIso) +
    '&order=created_at.desc&limit=200';
  if (opts.username) {
    q += '&username=ilike.' + encodeURIComponent(cleanUser(opts.username));
  }
  var r = await sbRest(q);
  if (!r.ok || !Array.isArray(r.data)) return [];
  var viewer = viewerKey(opts);
  var likedSet = {};
  if (viewer && r.data.length) {
    var ids = r.data.map(function (x) {
      return x.id;
    });
    var lr = await sbRest(
      '/rest/v1/story_likes?select=story_id,liker_key&liker_key=eq.' +
        encodeURIComponent(viewer) +
        '&story_id=in.(' +
        ids.join(',') +
        ')'
    );
    if (lr.ok && Array.isArray(lr.data)) {
      lr.data.forEach(function (x) {
        likedSet[String(x.story_id)] = 1;
      });
    }
  }
  var ownerTok = String(opts.owner_token || '');
  var ownerHash = ownerTok ? sha256Hex(ownerTok) : '';
  var admin = !!opts.is_admin;
  return r.data.map(function (row) {
    var isOwner =
      (!!ownerHash && row.owner_token_hash === ownerHash) ||
      (!!opts.username && normUser(opts.username) === normUser(row.username) && !isAnonName(opts.username)) ||
      (!!opts.anon_id && row.anon_id && sanitizeAnonId(opts.anon_id) === sanitizeAnonId(row.anon_id));
    return mapNativeStory(row, {
      liked: !!likedSet[String(row.id)],
      is_owner: isOwner,
      can_delete: isOwner || admin
    });
  });
}

async function listStories(opts) {
  if (await nativeStoriesAvailable()) {
    try {
      return await listNativeStories(opts);
    } catch (e) {
      /* fall through */
    }
  }
  return listPostStories(opts);
}

async function countPublisherStories24h(username, anonId) {
  var list = await listPostStories({});
  var cut = Date.now() - STORY_MS;
  var n = 0;
  var u = normUser(username);
  var a = sanitizeAnonId(anonId);
  list.forEach(function (s) {
    if ((s.at || 0) < cut) return;
    if (u && normUser(s.user) === u) n++;
    else if (a && s.anon_id && sanitizeAnonId(s.anon_id) === a) n++;
  });
  return n;
}

async function publishStory(input) {
  input = input || {};
  var media = String(input.media_url || input.url || '').trim();
  if (!isAllowedMediaUrl(media)) {
    return { ok: false, status: 400, error: 'invalid_media' };
  }
  var username = cleanUser(input.username || input.user || '');
  var anonId = sanitizeAnonId(input.anon_id || input.anonymous_user_id || '');
  var registered = !!(username && !isAnonName(username));
  if (!registered) {
    if (!anonId || anonId.length < 8) return { ok: false, status: 400, error: 'anon_id_required' };
    username = username && isAnonName(username) ? username : 'anon_' + anonId;
  }
  var recent = await countPublisherStories24h(username, anonId);
  if (recent >= MAX_STORIES_PER_PUBLISHER_24H) {
    return { ok: false, status: 429, error: 'rate_limited' };
  }

  var ownerToken = String(input.owner_token || mintOwnerToken());
  var ownerHash = sha256Hex(ownerToken);
  var now = Date.now();
  var createdIso = new Date(now).toISOString();
  var expiresIso = new Date(now + STORY_MS).toISOString();
  var avatar = String(input.avatar_url || '').trim().slice(0, MAX_MEDIA_URL);
  if (avatar && !isAllowedMediaUrl(avatar) && !/^data:image\//i.test(avatar)) avatar = '';

  if (await nativeStoriesAvailable()) {
    var insN = await sbRest('/rest/v1/stories', {
      method: 'POST',
      body: JSON.stringify({
        legacy_id: input.legacy_id || null,
        username: username,
        anon_id: registered ? null : anonId,
        account_type: registered ? 'registered' : 'anonymous',
        media_url: media,
        thumb_url: media,
        avatar_url: avatar || null,
        owner_token_hash: ownerHash,
        views_count: Number(input.views || 0) || 0,
        likes_count: Number(input.likes || 0) || 0,
        created_at: input.created_at || createdIso,
        expires_at: input.expires_at || expiresIso,
        meta: { source: input.source || 'app' }
      })
    });
    if (insN.ok && Array.isArray(insN.data) && insN.data[0]) {
      var storyN = mapNativeStory(insN.data[0], { is_owner: true, can_delete: true });
      return { ok: true, story: storyN, owner_token: ownerToken };
    }
  }

  var meta = {
    kind: 'story',
    owner_hash: ownerHash,
    anon_id: registered ? null : anonId,
    account_type: registered ? 'registered' : 'anonymous',
    avatar_url: avatar || '',
    legacy_id: input.legacy_id || null,
    media_url: media,
    thumb_url: media
  };
  var tags = [STORY_TAG, registered ? 'account:registered' : 'account:anonymous'];
  if (input.legacy_id) tags.push('legacy:' + String(input.legacy_id).slice(0, 40));

  var ins = await sbRest('/rest/v1/posts', {
    method: 'POST',
    body: JSON.stringify({
      username: username,
      title: 'Story',
      description: JSON.stringify(meta),
      tags: tags,
      image_url: media,
      created_at: input.created_at || createdIso,
      expires_at: input.expires_at || expiresIso,
      views: Number(input.views || 0) || 0,
      likes_count: Number(input.likes || 0) || 0,
      liked_by: Array.isArray(input.liked_by) ? input.liked_by : []
    })
  });
  if (!ins.ok || !Array.isArray(ins.data) || !ins.data[0]) {
    return {
      ok: false,
      status: ins.status || 500,
      error: (ins.data && (ins.data.message || ins.data.error)) || 'publish_failed'
    };
  }
  return {
    ok: true,
    story: mapPostStory(ins.data[0], { is_owner: true, can_delete: true }),
    owner_token: ownerToken
  };
}

async function findPostStory(id) {
  var r = await sbRest(
    '/rest/v1/posts?id=eq.' +
      encodeURIComponent(String(id)) +
      '&select=id,username,title,description,tags,image_url,created_at,expires_at,views,likes_count,liked_by'
  );
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
  var row = r.data[0];
  if (!postIsStory(row)) return null;
  return row;
}

async function findNativeStory(id) {
  var raw = String(id || '');
  var nid = raw.indexOf('ns_') === 0 ? raw.slice(3) : raw;
  if (!/^\d+$/.test(nid)) return null;
  var r = await sbRest('/rest/v1/stories?id=eq.' + encodeURIComponent(nid) + '&select=*');
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
  return r.data[0];
}

function ownershipOk(row, opts, native) {
  opts = opts || {};
  if (opts.is_admin) return { ok: true, role: 'admin' };
  var ownerTok = String(opts.owner_token || '');
  var ownerHash = ownerTok ? sha256Hex(ownerTok) : '';
  if (native) {
    if (ownerHash && row.owner_token_hash === ownerHash) return { ok: true, role: 'owner_token' };
    if (opts.username && !isAnonName(opts.username) && normUser(opts.username) === normUser(row.username)) {
      return { ok: true, role: 'registered' };
    }
    if (opts.anon_id && row.anon_id && sanitizeAnonId(opts.anon_id) === sanitizeAnonId(row.anon_id)) {
      return { ok: true, role: 'anon' };
    }
    return { ok: false };
  }
  var meta = parseMeta(row.description);
  if (ownerHash && meta.owner_hash === ownerHash) return { ok: true, role: 'owner_token' };
  if (opts.username && !isAnonName(opts.username) && normUser(opts.username) === normUser(row.username)) {
    return { ok: true, role: 'registered' };
  }
  if (opts.anon_id && meta.anon_id && sanitizeAnonId(opts.anon_id) === sanitizeAnonId(meta.anon_id)) {
    return { ok: true, role: 'anon' };
  }
  return { ok: false };
}

async function deleteStory(id, opts) {
  opts = opts || {};
  var native = await nativeStoriesAvailable();
  if (native && String(id).indexOf('ns_') === 0) {
    var nrow = await findNativeStory(id);
    if (!nrow) return { ok: false, status: 404, error: 'not_found' };
    if (nrow.deleted_at) return { ok: true, already: true };
    var expN = nrow.expires_at ? new Date(nrow.expires_at).getTime() : 0;
    // Allow delete even if expired (owner cleanup); still require auth.
    var ownN = ownershipOk(nrow, opts, true);
    if (!ownN.ok) return { ok: false, status: 403, error: 'forbidden' };
    var upN = await sbRest('/rest/v1/stories?id=eq.' + encodeURIComponent(nrow.id), {
      method: 'PATCH',
      body: JSON.stringify({
        deleted_at: new Date().toISOString(),
        deleted_by: ownN.role === 'admin' ? 'admin' : cleanUser(opts.username || opts.anon_id || 'owner')
      })
    });
    if (!upN.ok) return { ok: false, status: 500, error: 'delete_failed' };
    return { ok: true, free: true, cost: 0 };
  }

  var row = await findPostStory(id);
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (postIsDeletedStory(row)) return { ok: true, already: true };
  var own = ownershipOk(row, opts, false);
  if (!own.ok) return { ok: false, status: 403, error: 'forbidden' };

  var meta = parseMeta(row.description);
  meta.deleted = true;
  meta.deleted_at = Date.now();
  meta.deleted_by = own.role === 'admin' ? 'admin' : cleanUser(opts.username || opts.anon_id || 'owner');
  var tags = row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = [];
    }
  }
  if (!Array.isArray(tags)) tags = [STORY_TAG];
  if (tags.indexOf(STORY_DELETED_TAG) < 0) tags = tags.concat([STORY_DELETED_TAG]);
  // Soft-delete: keep stats, expire immediately so it never reappears as active.
  var up = await sbRest('/rest/v1/posts?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH',
    body: JSON.stringify({
      description: JSON.stringify(meta),
      tags: tags,
      expires_at: new Date(Date.now() - 1000).toISOString()
    })
  });
  if (!up.ok) return { ok: false, status: 500, error: 'delete_failed' };
  return { ok: true, free: true, cost: 0 };
}

async function recordViewReceipt(storyId, key) {
  // Notifications act as unique-ish view ledger for posts fallback.
  var to = '__STORY_VIEW__' + String(storyId);
  var existing = await sbRest(
    '/rest/v1/notifications?to_username=eq.' +
      encodeURIComponent(to) +
      '&from_username=eq.' +
      encodeURIComponent(key) +
      '&type=eq.story_view&select=id&limit=1'
  );
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    return { fresh: false };
  }
  await sbRest('/rest/v1/notifications', {
    method: 'POST',
    body: JSON.stringify({
      to_username: to,
      from_username: key.slice(0, 40),
      type: 'story_view',
      post_id: /^\d+$/.test(String(storyId)) ? Number(storyId) : 0,
      message: JSON.stringify({ story_id: String(storyId), viewer: key, at: Date.now() }),
      read: false
    })
  });
  return { fresh: true };
}

async function viewStory(id, opts) {
  opts = opts || {};
  var key = viewerKey(opts);
  if (!key) return { ok: false, status: 400, error: 'viewer_required' };

  if (await nativeStoriesAvailable() && String(id).indexOf('ns_') === 0) {
    var nrow = await findNativeStory(id);
    if (!nrow || nrow.deleted_at) return { ok: false, status: 404, error: 'not_found' };
    if (new Date(nrow.expires_at).getTime() <= Date.now()) {
      return { ok: false, status: 410, error: 'expired' };
    }
    // Skip self-views for registered owners
    if (opts.username && normUser(opts.username) === normUser(nrow.username) && !isAnonName(opts.username)) {
      return { ok: true, views: Number(nrow.views_count || 0) || 0, counted: false };
    }
    var insV = await sbRest('/rest/v1/story_views', {
      method: 'POST',
      prefer: 'return=minimal,resolution=ignore-duplicates',
      headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify({ story_id: nrow.id, viewer_key: key })
    });
    var counted = insV.status === 201 || insV.status === 200;
    if (counted) {
      await sbRest('/rest/v1/stories?id=eq.' + encodeURIComponent(nrow.id), {
        method: 'PATCH',
        body: JSON.stringify({ views_count: (Number(nrow.views_count || 0) || 0) + 1 })
      });
      return { ok: true, views: (Number(nrow.views_count || 0) || 0) + 1, counted: true };
    }
    return { ok: true, views: Number(nrow.views_count || 0) || 0, counted: false };
  }

  var row = await findPostStory(id);
  if (!row || postIsDeletedStory(row)) return { ok: false, status: 404, error: 'not_found' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, error: 'expired' };
  }
  if (opts.username && normUser(opts.username) === normUser(row.username) && !isAnonName(opts.username)) {
    return { ok: true, views: Number(row.views || 0) || 0, counted: false };
  }
  var receipt = await recordViewReceipt(row.id, key);
  if (!receipt.fresh) {
    return { ok: true, views: Number(row.views || 0) || 0, counted: false };
  }
  var next = (Number(row.views || 0) || 0) + 1;
  await sbRest('/rest/v1/posts?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH',
    body: JSON.stringify({ views: next })
  });
  return { ok: true, views: next, counted: true };
}

async function toggleLike(id, opts) {
  opts = opts || {};
  var key = viewerKey(opts);
  if (!key) return { ok: false, status: 400, error: 'viewer_required' };
  var want = opts.like;
  if (want == null) want = true;

  if (await nativeStoriesAvailable() && String(id).indexOf('ns_') === 0) {
    var nrow = await findNativeStory(id);
    if (!nrow || nrow.deleted_at) return { ok: false, status: 404, error: 'not_found' };
    if (new Date(nrow.expires_at).getTime() <= Date.now()) {
      return { ok: false, status: 410, error: 'expired' };
    }
    var existing = await sbRest(
      '/rest/v1/story_likes?story_id=eq.' +
        encodeURIComponent(nrow.id) +
        '&liker_key=eq.' +
        encodeURIComponent(key) +
        '&select=story_id'
    );
    var has = existing.ok && Array.isArray(existing.data) && existing.data.length > 0;
    if (want && !has) {
      await sbRest('/rest/v1/story_likes', {
        method: 'POST',
        body: JSON.stringify({ story_id: nrow.id, liker_key: key })
      });
      var nc = (Number(nrow.likes_count || 0) || 0) + 1;
      await sbRest('/rest/v1/stories?id=eq.' + encodeURIComponent(nrow.id), {
        method: 'PATCH',
        body: JSON.stringify({ likes_count: nc })
      });
      return { ok: true, liked: true, likes: nc };
    }
    if (!want && has) {
      await sbRest(
        '/rest/v1/story_likes?story_id=eq.' +
          encodeURIComponent(nrow.id) +
          '&liker_key=eq.' +
          encodeURIComponent(key),
        { method: 'DELETE', prefer: 'return=minimal' }
      );
      var nc2 = Math.max(0, (Number(nrow.likes_count || 0) || 0) - 1);
      await sbRest('/rest/v1/stories?id=eq.' + encodeURIComponent(nrow.id), {
        method: 'PATCH',
        body: JSON.stringify({ likes_count: nc2 })
      });
      return { ok: true, liked: false, likes: nc2 };
    }
    return { ok: true, liked: has, likes: Number(nrow.likes_count || 0) || 0 };
  }

  var row = await findPostStory(id);
  if (!row || postIsDeletedStory(row)) return { ok: false, status: 404, error: 'not_found' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, error: 'expired' };
  }
  var likedBy = Array.isArray(row.liked_by) ? row.liked_by.slice() : [];
  if (typeof row.liked_by === 'string') {
    try {
      likedBy = JSON.parse(row.liked_by) || [];
    } catch (e) {
      likedBy = [];
    }
  }
  var low = String(key).toLowerCase();
  var hasP = likedBy.some(function (k) {
    return String(k).toLowerCase() === low;
  });
  if (want && !hasP) {
    likedBy.push(key);
  } else if (!want && hasP) {
    likedBy = likedBy.filter(function (k) {
      return String(k).toLowerCase() !== low;
    });
  }
  // Dedupe
  var seen = {};
  likedBy = likedBy.filter(function (k) {
    var x = String(k).toLowerCase();
    if (seen[x]) return false;
    seen[x] = 1;
    return true;
  });
  var likes = likedBy.length;
  await sbRest('/rest/v1/posts?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH',
    body: JSON.stringify({ liked_by: likedBy, likes_count: likes })
  });
  return {
    ok: true,
    liked: likedBy.some(function (k) {
      return String(k).toLowerCase() === low;
    }),
    likes: likes
  };
}

async function fetchLegacyCfStories() {
  try {
    var r = await fetch(CF_API + '/notifs?to=__STORIES__', { cache: 'no-store' });
    var j = await r.json().catch(function () {
      return {};
    });
    return Array.isArray(j.notifs) ? j.notifs : [];
  } catch (e) {
    return [];
  }
}

async function fetchLegacyMeta() {
  try {
    var r = await fetch(CF_API + '/notifs?to=__STORY_META__', { cache: 'no-store' });
    var j = await r.json().catch(function () {
      return {};
    });
    var map = {};
    (j.notifs || []).forEach(function (n) {
      var d = {};
      try {
        d = JSON.parse(n.message || '{}');
      } catch (e) {}
      var id = String(d.id || n.post_id || '');
      if (!id) return;
      if (!map[id] || Number(n.created_at || 0) >= Number(map[id]._at || 0)) {
        map[id] = {
          views: Array.isArray(d.views) ? d.views : [],
          likes: d.likes && typeof d.likes === 'object' ? d.likes : {},
          _at: Number(n.created_at || 0) || 0
        };
      }
    });
    return map;
  } catch (e) {
    return {};
  }
}

async function migrateLegacyStories() {
  var notifs = await fetchLegacyCfStories();
  var metaMap = await fetchLegacyMeta();
  var deleted = {};
  var stories = [];
  notifs.forEach(function (n) {
    if (n.type === 'story_delete') {
      deleted[String(n.post_id || '')] = 1;
      try {
        var dm = JSON.parse(n.message || '{}');
        if (dm.id) deleted[String(dm.id)] = 1;
      } catch (e) {}
      return;
    }
    if (n.type !== 'story') return;
    var m = {};
    try {
      m = JSON.parse(n.message || '{}');
    } catch (e) {
      return;
    }
    if (!m || !m.url || !m.id) return;
    if (m.deleted || deleted[String(m.id)]) return;
    stories.push(m);
  });

  var existing = await listPostStories({});
  // Also check soft-deleted / expired for legacy_id to avoid dupes
  var allTagged = await sbRest(
    '/rest/v1/posts?select=id,description,tags&order=created_at.desc&limit=500'
  );
  var legacySeen = {};
  existing.forEach(function (s) {
    if (s.legacy_id) legacySeen[String(s.legacy_id)] = 1;
  });
  if (allTagged.ok && Array.isArray(allTagged.data)) {
    allTagged.data.forEach(function (row) {
      if (!postIsStory(row)) return;
      var meta = parseMeta(row.description);
      if (meta.legacy_id) legacySeen[String(meta.legacy_id)] = 1;
    });
  }

  var migrated = [];
  var skipped = [];
  for (var i = 0; i < stories.length; i++) {
    var s = stories[i];
    var lid = String(s.id);
    if (legacySeen[lid]) {
      skipped.push(lid);
      continue;
    }
    var at = Number(s.at || 0) || Date.now();
    var exp = at + STORY_MS;
    // Migrate even if expired — keep stats, but only active ones appear in list.
    var meta = metaMap[lid] || { views: [], likes: {} };
    var views = Array.isArray(meta.views) ? meta.views.length : 0;
    var likesObj = meta.likes || {};
    var likedBy = Object.keys(likesObj).map(function (k) {
      return 'u:' + normUser(k);
    });
    var pub = await publishStory({
      username: s.user,
      media_url: s.url,
      legacy_id: lid,
      created_at: new Date(at).toISOString(),
      expires_at: new Date(exp).toISOString(),
      views: views,
      likes: likedBy.length,
      liked_by: likedBy,
      source: 'legacy_cf',
      owner_token: 'legacy-migrated-' + lid
    });
    if (pub.ok) {
      legacySeen[lid] = 1;
      migrated.push({ legacy_id: lid, id: pub.story.id, user: s.user, active: exp > Date.now() });
    } else {
      skipped.push(lid + ':' + (pub.error || 'fail'));
    }
  }
  return { ok: true, migrated: migrated, skipped: skipped, total_legacy: stories.length };
}

async function activeUsernames() {
  var list = await listStories({});
  var set = {};
  list.forEach(function (s) {
    set[normUser(s.user)] = cleanUser(s.user);
  });
  return Object.keys(set).map(function (k) {
    return set[k];
  });
}

async function handleStoriesRequest(req, res, body, query, helpers) {
  helpers = helpers || {};
  var json = helpers.json;
  var verifyAdminToken = helpers.verifyAdminToken;
  var bearerToken = helpers.bearerToken;

  var action = String((body && body.action) || (query && query.action) || '')
    .toLowerCase()
    .replace(/^story_/, 'stories_')
    .replace(/^stories_/, 'stories_');
  // Normalize short names
  var map = {
    stories_list: 'list',
    stories_active: 'list',
    list: 'list',
    stories_publish: 'publish',
    publish: 'publish',
    stories_view: 'view',
    view: 'view',
    stories_like: 'like',
    like: 'like',
    stories_unlike: 'unlike',
    unlike: 'unlike',
    stories_delete: 'delete',
    delete: 'delete',
    stories_migrate: 'migrate',
    migrate: 'migrate',
    stories_users: 'users',
    users: 'users',
    stories_admin_list: 'admin_list',
    admin_list: 'admin_list'
  };
  // Also accept action like "story_list"
  var rawAction = String((body && body.action) || (query && query.action) || '').toLowerCase();
  if (rawAction.indexOf('story') === 0) {
    action = rawAction.replace(/^stories?_/, '');
  } else {
    action = map[rawAction] || map[action] || action;
  }
  if (map[action]) action = map[action];

  var isAdmin = false;
  try {
    var tok = bearerToken ? bearerToken(req) : '';
    if (!tok && body && body.admin_token) tok = String(body.admin_token);
    if (tok && verifyAdminToken) isAdmin = await verifyAdminToken(tok);
  } catch (e) {
    isAdmin = false;
  }

  var opts = {
    username: (body && (body.username || body.user)) || (query && (query.username || query.user)) || '',
    anon_id:
      (body && (body.anon_id || body.anonymous_user_id)) ||
      (query && (query.anon_id || query.anonymous_user_id)) ||
      '',
    owner_token: (body && body.owner_token) || (query && query.owner_token) || '',
    session_key: (body && (body.session_key || body.viewer_key)) || (query && query.session_key) || '',
    is_admin: isAdmin
  };

  if (req.method === 'GET' || action === 'list' || action === 'users' || action === 'admin_list') {
    if (action === 'users') {
      var users = await activeUsernames();
      return json(res, 200, { ok: true, users: users });
    }
    if (action === 'migrate') {
      var mig = await migrateLegacyStories();
      return json(res, 200, mig);
    }
    // Auto-migrate once per cold start lightly: only if LoserFagg missing and legacy exists
    try {
      await ensureLoserFaggMigrated();
    } catch (e) {}
    var filterUser =
      (query && (query.for_user || query.user)) || (body && body.for_user) || '';
    var list = await listStories(
      Object.assign({}, opts, filterUser ? { username: filterUser } : {})
    );
    return json(res, 200, {
      ok: true,
      stories: list,
      server_now: Date.now(),
      ttl_ms: STORY_MS,
      native: await nativeStoriesAvailable()
    });
  }

  if (action === 'publish') {
    var pub = await publishStory({
      username: opts.username,
      anon_id: opts.anon_id,
      media_url: body.media_url || body.url,
      avatar_url: body.avatar_url,
      owner_token: opts.owner_token || undefined
    });
    if (!pub.ok) return json(res, pub.status || 400, { ok: false, error: pub.error });
    return json(res, 200, { ok: true, story: pub.story, owner_token: pub.owner_token, free: true, cost: 0 });
  }

  if (action === 'view') {
    var vid = body.id || body.story_id || query.id;
    var vr = await viewStory(vid, opts);
    if (!vr.ok) return json(res, vr.status || 400, { ok: false, error: vr.error });
    return json(res, 200, vr);
  }

  if (action === 'like' || action === 'unlike') {
    var lid = body.id || body.story_id || query.id;
    var lr = await toggleLike(lid, Object.assign({}, opts, { like: action === 'like' }));
    if (!lr.ok) return json(res, lr.status || 400, { ok: false, error: lr.error });
    return json(res, 200, lr);
  }

  if (action === 'delete') {
    var did = body.id || body.story_id || query.id;
    var dr = await deleteStory(did, opts);
    if (!dr.ok) return json(res, dr.status || 400, { ok: false, error: dr.error });
    return json(res, 200, Object.assign({ ok: true, free: true, cost: 0 }, dr));
  }

  if (action === 'migrate') {
    var m2 = await migrateLegacyStories();
    return json(res, 200, m2);
  }

  return json(res, 400, { ok: false, error: 'unknown_story_action', action: rawAction });
}

var _loserMigrated = false;
async function ensureLoserFaggMigrated() {
  if (_loserMigrated) return;
  _loserMigrated = true;
  var active = await listPostStories({});
  var has = active.some(function (s) {
    return normUser(s.user) === 'loserfagg' || s.legacy_id === 'st_mwzixonpihq';
  });
  if (has) return;
  // Check any legacy row including expired
  var allTagged = await sbRest(
    '/rest/v1/posts?select=id,description,tags,username&order=created_at.desc&limit=300'
  );
  if (allTagged.ok && Array.isArray(allTagged.data)) {
    for (var i = 0; i < allTagged.data.length; i++) {
      var row = allTagged.data[i];
      if (!postIsStory(row)) continue;
      var meta = parseMeta(row.description);
      if (meta.legacy_id === 'st_mwzixonpihq' || normUser(row.username) === 'loserfagg') {
        return;
      }
    }
  }
  await migrateLegacyStories();
}

module.exports = {
  STORY_TAG,
  STORY_MS,
  handleStoriesRequest,
  listStories,
  publishStory,
  deleteStory,
  viewStory,
  toggleLike,
  migrateLegacyStories,
  ensureLoserFaggMigrated,
  isStoryPost: postIsStory,
  viewerKey,
  sha256Hex,
  mintOwnerToken,
  normUser
};
