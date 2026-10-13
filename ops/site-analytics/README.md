# SlendyStuff site analytics

SlendyStuff uses aggregate analytics to understand visits and improve its software pages and setup guide.

Cloudflare Web Analytics measures page views, referrers and browser performance. The custom Worker counts allowlisted events such as page views, download-link clicks, guide visits, self-hosted video progress and accepted feedback.

## What the counts mean

Download-link clicks are not completed downloads or unique people. The product page separately reports GitHub release-asset downloads, including repeat downloads and updates. Self-hosted video events do not measure YouTube views. Traffic-source categories depend on browser referrer settings.

## Privacy

The custom D1 store contains aggregate counters grouped by UTC day, event, page, source category and release version. It stores no visitor identifiers, cookies, IP addresses, user-agent strings, full referrer URLs, query strings, form contents or per-person histories. Requests from the EU and UK, and requests signaling Do Not Track or Global Privacy Control, are excluded from this custom collector.

Private chat, encrypted links, hidden pages and statistics administration are not instrumented. A transient network-address key limits abuse without being written to D1. Raw request logging is disabled, and aggregate counters expire after 90 days. Cloudflare may maintain platform records under its own service policies.

## Repository reference

`worker.js` validates events and increments counters; `schema.sql` defines the database and aggregate views. `public/analytics.js` sends bounded browser events. The public Worker exposes no analytics reports. Tests run with `node --test test.mjs`.

The free service's daily limits can temporarily stop collection. Static website pages remain available independently of the custom collector.

## Canonical pages

The sitemap lists canonical public URLs. Legacy homepage, contact, software and explicit directory-index URLs redirect to their canonical equivalents. Removed pages remain missing, and private or held pages retain their noindex settings. Search engines decide indexing and ranking.
