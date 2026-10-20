# SlendyStuffClicker release reference

SlendyStuffClicker is distributed as one portable Windows EXE through versioned GitHub releases. The current public preview is [v0.5.3.1](https://github.com/SlendermanHG/slendystuff.com/releases/tag/v0.5.3.1); earlier previews remain available.

## Published downloads

| Version | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 0.5.3.1 | SlendyStuffClicker.exe | 1,262,592 | 6c26784a93066f5dc0f747935fb51fa611a4203778e6c370e6b122afe97f1891 |
| 0.5.2.8 | SlendyStuffClicker.exe | 1,228,800 | 2cd07301aff15112c702b1b202d89d95059f62e8ebf02a5a0a3ec7f7afec4cbb |
| 0.5.2.7 | SlendyStuffClicker.exe | 1,228,288 | b7b426ecf2072176ccd82d99e5029304ac12639410ec55667b7ef5a5f7da7b7b |
| 0.5.2.5 | SlendyStuffClicker.exe | 1,135,104 | f0af39b2cb11b82a65ea0012afce0c0ed81e674f0af7fd94ae930dd4233c0e14 |
| 0.5.2.0 | SlendyStuffClicker.exe | 1,103,360 | b18a24248dc61e3dcbaa62613303679d9eddd182643d7eefb884832b11a68755 |
| 0.5.1.0 | SlendyStuffClicker.exe | 1,007,616 | eb5770592c6a5c2a2c1c6044775e5b5db1e8a8942663c7fac226ae7a8d540dd5 |

Release tags use `v` followed by the EXE's exact four-part internal/file/product/assembly version. Notes are stored beside each version in `ops/releases/`. The GitHub release asset is the complete EXE. Historical publication fragments are not additional files required by users.

## Publication checks

The version-bound publisher requires a release authorization manifest and verifies the binary hash, byte size and Windows metadata. An existing release asset cannot be replaced. The public website enables its download only when GitHub's asset identity matches `public/slendystuffclicker/product.json` and the generated stats are current.

Binary publication and release-note editing are separate operations. Editorial changes do not replace EXEs, create versions or publish drafts. Portable update checks remain independent of release-note editing.

The app checks public GitHub release metadata. In v0.5.2.7 and later, users can review the notes and approve a portable update in the app. Expected repository URL, size, SHA-256 and embedded versions are verified before replacement. The previous EXE is retained for recovery, and the updated app starts stopped. Earlier releases require manual EXE replacement. No update installs without approval.

## Download counts and announcements

The live download endpoint refreshes verified GitHub asset counts with a five-minute cache. Site deployment also generates a static fallback through `ops/refresh-clicker-stats.cjs`. Counts include repeats and updates, not unique people. API failures are shown as unavailable; stale data cannot enable a download.

Announcements use `public/slendystuffclicker/news.json`. The public reporting endpoint is `reports.slendystuff.com`; the page checks service availability before enabling feedback. The current EXE opens the website feedback page without uploading logs.

## Preview notes

* Published EXEs are unsigned and updates require approval. Checksums identify bytes; they do not prove publisher identity or provide executable signing.

* Local automated tests cover supported rules and failure paths. Live Steam achievement delivery and representative long-session reliability are not certified by those tests.

* Current maintenance guidance is to save and fully restart both apps at least every 12 hours, or sooner for memory growth or reduced performance. Older EXEs may show a six-hour reminder. Unattended stability is not guaranteed.

Release uploads contain only the product EXE. Pairing keys, installed companion copies, private records, game saves, proprietary game source, logs and diagnostic test executables are excluded.
