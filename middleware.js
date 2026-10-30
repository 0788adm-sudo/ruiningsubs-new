// Prefer vercel.json rewrites → /api/og (UA handled there).
// This middleware is a belt-and-suspenders path for crawlers when
// query-based rewrites are skipped by the CDN edge.
import { rewrite } from '@vercel/edge';

const BOT_UA =
  /TelegramBot|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|vkShare|Pinterest|redditbot|Applebot|Googlebot|bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Embedly|Quora Link Preview|Showyoubot|outbrain|Viber|Snapchat|Iframely|BitlyBot/i;

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

export default function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!BOT_UA.test(ua)) return;

  const id = postIdFrom(request);
  if (!id) return;

  const dest = new URL('/api/og', request.url);
  dest.search = '';
  dest.searchParams.set('p', id);
  return rewrite(dest);
}
