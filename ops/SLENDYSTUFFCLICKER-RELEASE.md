# Public preview release

The release tag must be `v0.5.1.0`, matching the EXE's file/product/assembly version. Upload only `SlendyStuffClicker.exe`; there is no distribution ZIP. Do not upload source backups, paired mod files, test executables, keys, user logs or game source.

Before publishing, rebuild and run the app's isolated UI/resource/restart/golden-cookie checks and public startup check. Update `public/slendystuffclicker/product.json` with that exact EXE's SHA-256 and byte size. Review the page and the final release notes. Publication requires the owner's approval.

Create a GitHub draft release using that exact tag and mark this v0.x release as a preview. After approval, publish it and merge the page changes. The page enables downloading only when GitHub's asset name, URL, size and SHA-256 digest match the curated product metadata. Hashes check artifact identity; they do not make an unsigned app tamper-proof or prove publisher identity.

The app's update button checks public GitHub releases and opens the matching release page. It does not install downloaded code automatically. Trusted automatic updating and Windows code signing remain separate unfinished work; do not bypass the existing trusted-signature release gate to imply either is solved.

GitHub Pages refreshes anonymous aggregate release download counts on publishing, pushes, manual runs and a nominal 30-minute schedule. Scheduled Actions can be delayed; the page labels stale counts and does not enable downloading from an old cache. API failures show unavailable, not an invented zero.

Upcoming announcements are editable in `public/slendystuffclicker/news.json`. Feedback and direct diagnostics require separately activating the reviewed Cloudflare reporting Worker; the page detects whether the service is available.

## Proposed release notes

SlendyStuffClicker v0.5.1.0 is a free portable Windows preview for a supported Steam cookie-building idle game. It sends actions inside the game and leaves your mouse free.

- Updated SlendyStuff/SlenderFox branding and visible internal version.
- Clicks this run and purchases in Live status.
- Manual Check for updates through GitHub releases.
- Selected auto-buy and optional golden-cookie collection while clicking.
- Save & restart game verifies the local save by reading it back, waits for the game to close, then reopens through Steam and reconnects before resuming. Failures leave automation stopped.
- Bounded resource checks and a reminder to save and fully restart the app and game every six hours because long game sessions can increase memory usage.
- Preview voluntary diagnostics before sending through SlendyStuff's reporting service when activated.

This EXE is unsigned; Windows may warn or block it. No installer is included. First-time setup writes a companion mod to the game folder and keeps local pairing/settings and bounded logs. The full Steam restart cycle and overnight behavior need live verification; isolated tests do not prove either.
