# Visual Full review

The independent Visual Full workflow publishes a full trace bundle and a smaller
`web-visual-review-*` artifact containing first-attempt `actual` and `diff` PNGs.
Compare those images with the committed snapshots before changing page layout or
approving a baseline. A clean debt ratchet only means no new failures; strict
acceptance still requires the entire Playwright suite to pass.
