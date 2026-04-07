# SlendyStuff

SlendyStuff is now a lightweight Node-backed v1 site focused on:

- remote support
- websites and ongoing technical services
- software and custom bot work
- a deep personal About page
- reviews/testimonial structure
- Discord as the primary conversation center
- Twitch and YouTube as growth channels

## Current Pages

Files in [`public/`](./public):

- `index.html`
- `about.html`
- `services.html`
- `software.html`
- `reviews.html`
- `community.html`
- `contact.html`
- `admin.html`
- `404.html`
- `styles.css`
- `site.js`

## Deployment Direction

This build is designed for a lightweight launch:

- Render Node web service or similar lightweight Node hosting
- Cloudflare for DNS / SSL / Turnstile later
- Resend for production form delivery later
- optional scheduler for booked remote support sessions

The public pages are static-first, but the admin config is now persisted through a small server API. The contact form still uses a mailto fallback until a production form backend is connected.

## Admin Preview Page

Use [`public/admin.html`](./public/admin.html) for editing of:

- support email
- Discord link
- Twitch link
- YouTube link
- scheduler link

The admin page now saves to the persistent server config in [`data/site-config.json`](./data/site-config.json) and requires the `ADMIN_PASSWORD` environment variable.

If you deploy on Render and want config changes to survive restarts and deploys, attach a persistent disk or move the config into a database/service store. A plain web service filesystem is not enough for long-term persistence.

## Replace Before Launch

- `support@slendystuff.com`
- `https://discord.gg/your-invite`
- scheduler link
- any Twitch or YouTube links that should change
- set `ADMIN_PASSWORD` in the host environment

## Runtime Files

- [`server.js`](./server.js)
- [`package.json`](./package.json)
- [`data/site-config.json`](./data/site-config.json)

## Project Notes

- [`conversation-log-2026-04-07.md`](./conversation-log-2026-04-07.md)
- [`prebuild-services-checklist-2026-04-07.md`](./prebuild-services-checklist-2026-04-07.md)
