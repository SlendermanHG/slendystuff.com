# SlendyStuffClicker release reference

SlendyStuffClicker is distributed as one portable Windows EXE through versioned GitHub releases. The current public preview is [v0.5.2.0](https://github.com/SlendermanHG/slendystuff.com/releases/tag/v0.5.2.0); [v0.5.1.0](https://github.com/SlendermanHG/slendystuff.com/releases/tag/v0.5.1.0) remains available.

## Published downloads

| Version | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 0.5.2.0 | SlendyStuffClicker.exe | 1,103,360 | b18a24248dc61e3dcbaa62613303679d9eddd182643d7eefb884832b11a68755 |
| 0.5.1.0 | SlendyStuffClicker.exe | 1,007,616 | eb5770592c6a5c2a2c1c6044775e5b5db1e8a8942663c7fac226ae7a8d540dd5 |

Release tags use `v` followed by the EXE's exact four-part internal/file/product/assembly version. Notes are stored beside each version in `ops/releases/`. Publication fragments reconstruct the single EXE for release upload; they are not additional files required by users.

## Publication checks

The version-bound publisher requires a release authorization manifest and verifies the binary hash, byte size and Windows metadata. An existing release asset cannot be replaced. The public website enables its download only when GitHub's asset identity matches `public/slendystuffclicker/product.json` and the generated stats are current.

Binary publication and release-note editing are separate operations. Editorial changes do not replace EXEs, create versions or publish drafts. The automatic-update trust requirements remain independent of manual preview distribution.

The app checks public GitHub release metadata and opens the matching release page. It does not download or run an update automatically.

## Download counts and announcements

`ops/refresh-clicker-stats.cjs` generates aggregate asset-download counts during site deployment and scheduled refreshes. Counts include repeats and updates, not unique people. API failures are shown as unavailable; stale data cannot enable a download.

Announcements use `public/slendystuffclicker/news.json`. The public reporting endpoint is `reports.slendystuff.com`; the page checks service availability before enabling feedback. The current EXE opens the website feedback page without uploading logs.

## Preview notes

* Published EXEs are unsigned and updates are manual. Checksums identify bytes; they do not prove publisher identity or provide executable signing.

* Local automated tests cover supported rules and failure paths. Live Steam achievement delivery and representative long-session reliability are not certified by those tests.

* Current maintenance guidance is to save and fully restart both apps at least every 12 hours, or sooner for memory growth or reduced performance. Older EXEs may show a six-hour reminder. Unattended stability is not guaranteed.

Release uploads contain only the product EXE. Pairing keys, installed companion copies, private records, game saves, proprietary game source, logs and diagnostic test executables are excluded.
