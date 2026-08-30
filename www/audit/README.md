# Homepage review — 2026-08-30

## Scope

Combined UX and accessibility review of the KKTerm product homepage, followed by an implementation pass in `www/`. The user goal is to understand the product quickly, see credible in-app evidence, and reach the download or repository action without guessing what KKTerm ships.

## Evidence and health

1. `01-live-homepage-before.png` — **Needs work.** The hero had a large labelled placeholder, every downstream product-media slot was empty, and off-screen reveal elements made an automated full-page capture look blank until visited. The hierarchy and primary calls to action were otherwise clear.
2. `07-maelstrom-demo-terminal.png` — **Healthy source capture.** A privacy-safe Demo Workspace terminal shows the Maelstrom dynamic background and realistic operations output. The capture was made from the live KKTerm app on this Mac.
3. `04-local-homepage-hero.png` — **Healthy.** The real muted looping capture fits the existing hero, has a poster fallback, identifies itself as a real capture, and keeps the download action dominant.
4. `05-local-homepage-operations.png` — **Healthy.** IT Ops and Screenshots now have concrete visual evidence and concise descriptions. Git/Compare, Custom Modules, local secrets/backups, and localization are represented immediately below.
5. `06-local-homepage-mobile.png` — **Healthy.** The hero reflows without horizontal clipping, the calls to action remain large enough to tap, and desktop navigation collapses to the existing menu control.
6. `08-homepage-before-after.png` — **Healthy comparison.** The same desktop hero viewport is shown before and after: layout and conversion hierarchy are preserved while the empty preview is replaced by the Maelstrom terminal capture and Operations becomes discoverable in navigation.

## Highest-impact changes

- Replaced every placeholder with a real KKTerm screenshot or video.
- Added missing shipped-product coverage for IT Ops, Screenshots/video capture, Git/Compare, Custom Modules, local backups/secrets, and 14 interface languages.
- Added a real Maelstrom terminal video to the hero with muted autoplay, inline playback, a poster, and a reduced-motion fallback.
- Added intrinsic image dimensions, descriptive alternative text, lazy loading, and asynchronous decoding for downstream screenshots.

## Evidence limits

The screenshot pass confirms visible hierarchy, responsive reflow, media loading, and accessible names. It does not prove keyboard focus order, screen-reader announcements, color-contrast ratios, bandwidth behavior, or autoplay policy in every browser. Those require dedicated runtime and assistive-technology testing.
