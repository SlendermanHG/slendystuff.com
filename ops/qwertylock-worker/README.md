# QwertyLock Hosted API

This is the public backend for server-backed one-time QwertyLock messages.

It is designed for Cloudflare Workers with Durable Objects. The browser still encrypts and decrypts locally; this API stores only encrypted QLR blocks until successful consume or expiration. New messages use authenticated `QLR2` blocks, while `QLR1` remains accepted for older links.

## Endpoints

- `POST /api/qwertylock/messages`
- `GET /api/qwertylock/messages/:id`
- `POST /api/qwertylock/messages/:id/consume`
- `GET /api/health`

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
