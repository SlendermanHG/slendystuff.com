# QwertyLock Hosted API

This is the public backend for server-backed one-time QwertyLock messages.

It is designed for Cloudflare Workers with Durable Objects. The browser still encrypts and decrypts locally; this API stores only encrypted QLR blocks until successful consume or expiration. New messages use authenticated `QLR2` blocks, while `QLR1` remains accepted for older links.

## Endpoints

- `POST /api/qwertylock/messages`
- `GET /api/qwertylock/messages/:id`
- `POST /api/qwertylock/messages/:id/consume`
- `GET /api/qwertylock/stats` owner-only anonymous stats. Requires `Authorization: Bearer <STATS_ADMIN_TOKEN>`.
- `GET /api/health`

## Owner Stats

The stats endpoint is intentionally private and aggregate-first. It tracks:

- all-time created message count
- all-time successful use count
- last-24-hour created/use/expired/final-delete counts, bucketed hourly
- option totals by duration, use limit, and QLR version
- active server block count
- active block timing metadata: creation date, duration, expiration date, use limit, use count, and remaining uses

The stats report does not return message IDs, encrypted blocks, plaintext, passphrases, IP addresses, user agents, phone numbers, or recipients.

Before deploying stats, set the secret:

```powershell
cd ops\qwertylock-worker
$token = "replace-with-long-random-token"
$token | npx wrangler secret put STATS_ADMIN_TOKEN
```

Then query it:

```powershell
$headers = @{ Authorization = "Bearer replace-with-long-random-token" }
Invoke-RestMethod https://lock.slendystuff.com/api/qwertylock/stats -Headers $headers
```

Limitation: Durable Objects cannot be listed globally after the fact. Active block inventory starts with messages created after this stats index is deployed. Older messages are not discoverable unless they pass through updated open/consume/expiry code.

## Deploy

1. Create a Cloudflare Worker.
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Choose an API hostname, for example `lock.slendystuff.com`.
4. Uncomment and update the `routes` entry in `wrangler.toml`.
5. Deploy:

```powershell
cd ops\qwertylock-worker
npx wrangler deploy
```

6. After deployment, update this meta tag in both `public/r/index.html` and `public/qwertylock-paper.html`:

```html
<meta name="qwertylock-api-base" content="https://lock.slendystuff.com">
```

7. Run a health check:

```powershell
Invoke-WebRequest https://lock.slendystuff.com/api/health -UseBasicParsing
```

## Privacy Boundary

The Worker should receive only encrypted QLR blocks and random message IDs. It should never receive plaintext or the shared phrase.

The public claim should stay conservative:

> Encrypted one-time message links. Passwords are never sent by text. Server-stored encrypted messages are deleted after successful decode or expiration.
