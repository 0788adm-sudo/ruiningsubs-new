// Edge gate for /post/:id — bots get OG HTML; deleted posts get HTTP 410 for everyone.
// Never 410 an active post: lookup failures fall through to the SPA.
import { rewrite } from '@vercel/edge';

const BOT_UA =
  /TelegramBot|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|vkShare|Pinterest|redditbot|Applebot|Googlebot|bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Embedly|Quora Link Preview|Showyoubot|outbrain|Viber|Snapchat|Iframely|BitlyBot/i;

const SITE = 'https://www.ruinexpose.com';
const CF_API = 'https://ruiningsubs-api.0788adm.workers.dev';
const SUPABASE_URL = 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

export const config = {
  matcher: ['/', '/index.html', '/post/:id*', '/p/:id*']
};

function postIdFrom(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('p') || url.searchParams.get('post') || url.searchParams.get('id');
  if (q) return String(q).trim();
  const m = url.pathname.match(/^\/(?:post|p)\/([^\/?#]+)/i);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]).trim();
    } catch (e) {
      return String(m[1]).trim();
    }
  }
  if (/^\/\d+$/.test(url.pathname)) return url.pathname.slice(1);
  return '';
}

function goneHtml(id) {
  const path = '/post/' + encodeURIComponent(String(id || ''));
  const title = 'This post is no longer available';
  const desc = 'This post was deleted and is no longer available on Ruinexpose.';
  return (
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    '<title>' +
    title +
    '</title>' +
    '<meta name="description" content="' +
    desc +
    '"/>' +
    '<meta name="robots" content="noindex,nofollow"/>' +
    '<meta name="googlebot" content="noindex,nofollow"/>' +
    '<meta name="googlebot-image" content="noindex"/>' +
    '<link rel="canonical" href="' +
    SITE +
    path +
    '"/>' +
    '<meta property="og:title" content="' +
    title +
    '"/>' +
    '<meta property="og:description" content="' +
    desc +
    '"/>' +
    '<meta property="og:url" content="' +
    SITE +
    path +
    '"/>' +
    '<meta property="og:type" content="website"/>' +
    '</head><body style="background:#050506;color:#ececef;font-family:system-ui,sans-serif;padding:28px;max-width:640px;margin:0 auto;text-align:center">' +
    '<p style="color:#9a9aa3;font-size:13px;letter-spacing:.4px">RUINEXPOSE</p>' +
    '<h1 style="font-size:1.4rem;margin:18px 0 10px">' +
    title +
    '</h1>' +
    '<p style="color:#9a9aa3;line-height:1.45;margin:0 0 22px">' +
    desc +
    '</p>' +
    '<p><a href="/" style="color:#ff6a00;text-decoration:none;font-weight:700">Back to feed</a></p>' +
    '</body></html>'
  );
}

function goneResponse(id) {
  return new Response(goneHtml(id), {
    status: 410,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noimageindex',
      Vary: 'User-Agent'
    }
  });
}

/** Edge lookup must never hang Telegram/Safari on /post/:id (no Abort → blank spinner). */
const LOOKUP_TIMEOUT_MS = 3500;

async function fetchJson(url, headers, ms) {
  const timeoutMs = Number(ms) || LOOKUP_TIMEOUT_MS;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  try {
    if (ctrl) {
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e) {}
      }, timeoutMs);
    }
    const r = await fetch(url, {
      headers: headers || {},
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** true = exists, false = confirmed missing, null = lookup failed (do not 410). */
async function postExists(id) {
  id = String(id || '').trim();
  if (!id) return null;

  try {
    const sbUrl =
      SUPABASE_URL +
      '/rest/v1/posts?id=eq.' +
      encodeURIComponent(id) +
      '&select=id&limit=1';
    const rows = await fetchJson(sbUrl, {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      Accept: 'application/json'
    });
    if (Array.isArray(rows)) {
      if (rows.length > 0 && rows[0] && rows[0].id != null) return true;
      // Confirmed empty from SB — still check CF for UUID worker posts.
    } else if (rows == null) {
      // SB request failed; try CF before giving up.
    }
  } catch (e) {}

  try {
    const cf =
      (await fetchJson(CF_API + '/posts/' + encodeURIComponent(id), {
        Accept: 'application/json',
        Origin: SITE,
        'User-Agent': 'Mozilla/5.0 RuiningSubsEdge/1.0'
      })) ||
      (await fetchJson(CF_API + '/feed?id=' + encodeURIComponent(id) + '&limit=1', {
        Accept: 'application/json',
        Origin: SITE,
        'User-Agent': 'Mozilla/5.0 RuiningSubsEdge/1.0'
      }));
    if (cf) {
      const row = cf.post || (cf.posts && cf.posts[0]) || (cf.id != null ? cf : null);
      if (row && row.id != null) return true;
    }
  } catch (e) {}

  // SB returned [] and CF had nothing → gone.
  // If SB fetch failed entirely and CF failed, return null to avoid false 410s.
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e) {}
      }, LOOKUP_TIMEOUT_MS);
    }
    const probe = await fetch(
      SUPABASE_URL +
        '/rest/v1/posts?id=eq.' +
        encodeURIComponent(id) +
        '&select=id&limit=1',
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: 'Bearer ' + SUPABASE_ANON,
          Accept: 'application/json'
        },
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      }
    );
    if (timer) clearTimeout(timer);
    if (probe.ok) {
      const rows = await probe.json();
      if (Array.isArray(rows) && rows.length === 0) return false;
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export default async function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  const isBot = BOT_UA.test(ua);
  const url = new URL(request.url);
  const isPostPath = /^\/(?:post|p)\//i.test(url.pathname);
  const id = postIdFrom(request);

  // Humans + bots opening a post permalink: confirm it still exists.
  if (id && isPostPath) {
    const exists = await postExists(id);
    if (exists === false) return goneResponse(id);
  }

  if (!isBot) return;

  if (!id) return;

  const dest = new URL('/api/og', request.url);
  dest.search = '';
  dest.searchParams.set('p', id);
  return rewrite(dest);
}
