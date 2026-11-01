# Cloudflare Worker patch (required for full backend lock)

The live Worker at `ruiningsubs-api.0788adm.workers.dev` currently has two production bugs:

## 1) Print requests accept unpaid submissions
`POST /requests` with `kind=print_request` creates a pending Admin Print row with **no payment check**.

That is why DevTools / direct API calls could create:
`manual · $40 · No payment screenshot attached`.

### Required Worker validation on `POST /requests` when `kind === 'print_request'`
Reject unless ONE of:

**A. FC**
- `provider === 'fc'`
- AND a real wallet ledger spend exists for the same `user_id` with:
  - `action === 'print'`
  - `coins >= 350`
  - `ref_id === payload.order_code`
- Do **not** trust `payload.paid=true` from the client.

**B. Throne / manual**
- `provider === 'throne_proof'`
- AND `payload.payment_proof` is an `https://` URL on an allowed media host
- AND `payload.order_code` matches `PR-…`

Otherwise return `402 payment_required`.

The website now routes print creates through `/api/print-submit` (Vercel), which already enforces this. Patching the Worker closes the remaining direct-API hole.

## 2) `POST /posts` is broken — GoonTok empty
Creating posts fails with:

```text
D1_ERROR: 16 values for 18 columns: SQLITE_ERROR
```

Feed posts currently expose **18** columns:

`id, username, title, description, tags, media_url, thumb_url, media_type, expires_at, featured_until, views, likes_count, created_at, extensions_count, extend_amount, extenders, saves_count, downloads_count`

The Worker INSERT likely only binds **16** values (missing `saves_count` + `downloads_count` defaults).

### Fix
Update the INSERT to provide all 18 columns, e.g. default the last two to `0`:

```sql
INSERT INTO posts (
  id, username, title, description, tags, media_url, thumb_url, media_type,
  expires_at, featured_until, views, likes_count, created_at,
  extensions_count, extend_amount, extenders, saves_count, downloads_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
```

Until this is deployed, the SPA falls back to **Supabase `posts`** for video publish + GoonTok fetch.
