/**
 * Cloudflare Worker patch: DELETE /media/:key (admin-only R2 object removal).
 *
 * The live Worker currently advertises DELETE in CORS Allow-Methods but has no
 * handler — DELETE returns 404 while the object still exists on R2.
 *
 * Drop into the Worker router BEFORE the GET/HEAD media handler.
 *
 * Auth: Authorization: Bearer <admin token> that passes the same verify used by
 * /admin/requests (CF admin login token).
 *
 * Required bindings:
 *   env.MEDIA (or MEDIA_BUCKET / R2 / BUCKET) — R2 bucket
 *
 * Example:
 *   curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
 *     "https://ruiningsubs-api.0788adm.workers.dev/media/$KEY"
 */
export async function handleMediaDelete(request, env, key, verifyAdminToken) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename, X-Content-Type, Range, Origin, Accept',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } });
  }
  if (request.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, Allow: 'DELETE, OPTIONS' }
    });
  }

  const auth = String(request.headers.get('Authorization') || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? String(m[1] || '').trim() : '';
  let adminOk = false;
  try {
    adminOk = typeof verifyAdminToken === 'function' ? !!(await verifyAdminToken(token)) : false;
  } catch (_) {
    adminOk = false;
  }
  if (!adminOk) {
    return new Response(JSON.stringify({ ok: false, error: 'admin_required' }), {
      status: 401,
      headers: cors
    });
  }

  key = String(key || '')
    .replace(/^\/+/, '')
    .trim();
  try {
    key = decodeURIComponent(key);
  } catch (_) {}
  if (!key || key.includes('..') || /^https?:/i.test(key) || key.includes('\\')) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_key' }), {
      status: 400,
      headers: cors
    });
  }

  const bucket = env.MEDIA || env.MEDIA_BUCKET || env.R2 || env.BUCKET;
  if (!bucket || typeof bucket.delete !== 'function') {
    return new Response(JSON.stringify({ ok: false, error: 'r2_unavailable' }), {
      status: 503,
      headers: cors
    });
  }

  try {
    const existing = typeof bucket.head === 'function' ? await bucket.head(key) : true;
    if (!existing) {
      return new Response(JSON.stringify({ ok: true, deleted: false, missing: true, key }), {
        status: 404,
        headers: cors
      });
    }
    await bucket.delete(key);
    return new Response(JSON.stringify({ ok: true, deleted: true, key }), {
      status: 200,
      headers: cors
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'delete_failed',
        detail: String(e && e.message ? e.message : e)
      }),
      { status: 500, headers: cors }
    );
  }
}
