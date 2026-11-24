# Cloudflare Worker — admin DELETE `/media/:key`

## Why

Permanent account purge needs R2 objects removed, not only DB rows. The live Worker
CORS header lists `DELETE`, but there is no delete handler — requests return 404 while
objects remain on `pub-…r2.dev`.

## Patch

1. Paste `workers/media-delete.js` into the Worker module.
2. In the router, for `path.startsWith('/media/')` and `req.method === 'DELETE'`, call:

```js
import { handleMediaDelete } from './media-delete.js';
// …
if (path.startsWith('/media/') && request.method === 'DELETE') {
  const key = decodeURIComponent(path.slice('/media/'.length));
  return handleMediaDelete(request, env, key, verifyAdminToken);
}
```

3. Deploy the Worker.
4. Re-run media deletion with an admin bearer:

```bash
TOKEN='…'  # from POST /admin/login
while read -r KEY; do
  curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
    "https://ruiningsubs-api.0788adm.workers.dev/media/$KEY"
done < media-keys.txt
```

Keys for `@UkPakiUmayr29` were inventoried by `scripts/purge-user-ukpakiumayr29.js`
(57 objects at purge time).
