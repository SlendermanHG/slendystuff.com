# SlendyStuffClicker reporting service

The Cloudflare Worker at `reports.slendystuff.com` accepts voluntary filtered diagnostics and visitor-written feedback for delivery to `slender@slendystuff.com`. The website checks the service's health before enabling feedback.

## API

- `GET /api/health`: reporting availability.
- `POST /api/feedback`: a listed category and visitor-written message.
- `POST /api/diagnostics`: an allowlisted diagnostic report.

The service accepts no game commands, arbitrary files, recipients or credentials. Requests cannot open a connection back to a user's computer.

## Privacy and delivery

Diagnostic fields are reconstructed from an allowlist. Pairing keys, paths, names, game saves and unsupported fields are excluded. Feedback contains only the submitted category and message; visitors should leave out personal details.

The rate limiter uses a transient network-address key for abuse control. The Durable Object stores counters, random submission IDs, hashes and outcomes, expiring daily; it is not a report archive. Messages submitted voluntarily remain in the receiving mailbox. Cloudflare may maintain platform records under its service policies.

Recipient and sender restrictions are enforced by the mail binding. Global limits are five new sends per minute and 100 per UTC day. Browser origins, payload size, content and schema are validated. CORS is not authentication for non-browser clients; quotas and validation also apply to them. Quota exhaustion can temporarily make submissions unavailable.

Mail acceptance does not prove inbox delivery. Ambiguous or timed-out sends remain pending to prevent duplicates and are not automatically retried.

## Maintenance

Tests run with `node --test test.mjs`. Deployment uses Wrangler and the existing `wrangler.toml` bindings. Account credentials remain outside the app and repository. Request bodies and network addresses are not logged by the application. Deployment checks preserve the fixed recipient and sending-domain settings; changes to mail delivery are verified separately.

References: [email bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/) · [Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
