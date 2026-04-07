# SlendyStuff Prebuild Services Checklist

Date: 2026-04-07

## Recommended Product Direction

Based on the completed questionnaire, SlendyStuff should be built as:

- a multi-page brand site
- a service funnel for remote support and custom work
- a content hub connected to Discord, Twitch, and YouTube

This no longer requires a community application for version one.
It can be built as a strong content and conversion site first.

## Recommended Core Stack

### 1. Frontend/Application

Recommended:

- Next.js site
- TypeScript
- modern component-based UI system

Why:

- supports multiple public pages cleanly
- supports strong SEO for public pages
- gives room to expand later without rebuilding from scratch

### 2. Hosting

Recommended:

- Vercel for app deployment

Why:

- fast deployment workflow
- suitable for a Next.js app
- built-in deployment controls

### 3. DNS, SSL, and Bot Protection

Recommended:

- Cloudflare

Why:

- DNS
- SSL/TLS edge handling
- optional caching and WAF layer
- Turnstile for anti-spam and anti-bot form protection

### 4. Forms, Content Storage, and Lightweight Data

Recommended:

- Supabase or a simpler form/data layer

Why:

- Postgres database
- file storage
- contact/support intake persistence if needed
- future expansion path if you add accounts later

### 5. Transactional Email

Recommended:

- Resend

Why:

- support/contact routing
- account emails
- notification emails
- remote support inquiry confirmations

## Required External Accounts / Services Before Implementation

These should exist or be chosen first:

1. Domain and DNS control
   - `slendystuff.com`
   - access to DNS records

2. Cloudflare account
   - zone control for the domain
   - Turnstile widgets for forms

3. Vercel account
   - production project
   - preview deployments

4. Data/form backend choice
   - Supabase project
   - or simpler contact form backend if you want a lighter stack

5. Resend account
   - verified sending domain or subdomain
   - API key

6. GitHub repository
   - source control
   - deployment integration

7. Real community/profile links
   - Discord invite URL
   - Twitch URL
   - YouTube URL
   - support email

8. Remote support operations choice
   - attended remote support tool
   - process for one-time support sessions
   - whether users upload screenshots/files before a session

9. Scheduling choice for booked support sessions
   - simple contact-only flow
   - embedded scheduler
   - both

## Recommended Site Capabilities for Version One

### Public side

- homepage
- about page
- service pages
- software page
- reviews page
- Discord/community landing page
- contact/support page

### Admin side

- content editing
- reviews/testimonials management
- support inquiry management
- homepage section controls
- social link management

## Additional Services Worth Deciding Early

### Error monitoring

Optional but strongly recommended:

- Sentry

### Analytics / behavior insight

Optional but recommended:

- privacy-aware analytics or product analytics tool

### Scheduling

Optional but strongly recommended if remote support is the main offer:

- scheduling/booking tool or embedded booking flow

### Remote support delivery tool

Required if remote support is the top service:

- a secure attended support tool
- or a self-hosted alternative if you want more control

### Media / image handling

Can be handled by:

- Supabase Storage initially

## Missing Inputs Still Needed

These are not blockers to planning, but they are blockers to implementation quality:

1. Real Discord invite link
2. Real Twitch URL
3. Real YouTube URL
4. Preferred support/contact email
5. Whether remote support requests should go to a form, email, scheduler, or all three
6. Which remote support tool should be used in practice
7. Whether reviews should launch with placeholders, anonymized quotes, or remain hidden until real ones exist
8. Whether file uploads are needed at launch for support requests

## Recommended Implementation Order

1. Lock service stack
2. Create accounts and environment keys
3. Define content structure and information architecture
4. Build the visual system
5. Build public pages
6. Build contact/support flows
7. Build Discord/community integration surfaces
8. Build admin controls
9. Connect email and anti-spam protections
10. Launch and tune
