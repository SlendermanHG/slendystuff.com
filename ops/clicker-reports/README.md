# SlendyStuffClicker reporting service

This Worker accepts only voluntary filtered diagnostics and typed feedback. It emails only `slender@slendystuff.com`. It exposes no game commands, computer access, arbitrary uploads, recipients or account credentials.

## Activate after review

1. In Cloudflare, confirm the `slendystuff.com` zone and onboard the sending domain to Email Service. Verify `slender@slendystuff.com` as a destination without replacing existing mail/MX settings blindly. Confirm that this mailbox can receive the verification email.
2. Authenticate Wrangler through its normal browser login. Keep account credentials out of the app, repository and chat. Confirm the binding name, unique rate-limit namespace and sender restrictions using a dry run.
3. Run `node --test test.mjs`, then deploy this reviewed configuration with Wrangler from this directory. Do not enable application logging of request bodies or IP addresses.
4. Check `https://reports.slendystuff.com/api/health`. Send one synthetic diagnostic report and feedback message to the fixed owner mailbox; verify inbox delivery, deduplication and rate limits. Do not claim sending is live until this passes.

The rate limiter uses a transient network address key for abuse control. The Durable Object enforces a global ceiling of five new sends per minute and 100 per UTC day. Its stored state contains only counters, random submission IDs, hashes and outcomes, expires daily, and is never a diagnostics archive. Messages submitted voluntarily remain in the receiving mailbox. Cloudflare's platform may keep its own service records under its account settings and policies.

The public endpoint is intentionally not authenticated by a secret inside the EXE, which would be extractable. CORS restricts browser origins; request validation, bounded payloads, recipient restrictions, quotas and deduplication limit abuse. An attacker could exhaust the public quota, causing reports to become temporarily unavailable. No report request opens a connection back to a user's PC.

Mail acceptance is not proof of inbox delivery. A timed-out request remains pending to prevent a silent duplicate. Reports are not automatically resent.

References: [email bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [pricing](https://developers.cloudflare.com/email-service/platform/pricing/).
