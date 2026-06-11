# InCalc

Single-file PWA of banking calculators for Bangladesh (deposit interest with excise duty + source tax, loan EMI, DSCR/DBR, settlement IRR via Excel upload, scenario compare). Owner is a banker, not a developer — wrong financial numbers are the worst possible defect class; flag any calculation change loudly.

## Architecture

- `index.html` — the entire app: markup, CSS, and JS inline. No build step, no framework. Keep it that way; do not split into modules or add tooling.
- `sw.js` — service worker (cache-first). Bump `CACHE_NAME` on every deploy that changes `index.html`.
- `manifest.json`, `icon-*.png` — PWA shell.
- Only external dependencies: Chart.js and SheetJS, loaded from CDNs in `<head>`.

## Landmines

1. **Never derive the embedded sample workbook (`SETTLE_SAMPLE_B64`) from a real working file.** Office files are zip archives that retain hidden data (external links, metadata, shared strings) no visible-cell edit removes. Generate samples programmatically with fake data and verify them through `parseSettlementSheet` before embedding. See `AGENT_LEARNINGS.md` (2026-06-11).
2. Regulatory values (excise-duty slabs, source-tax rates) change with each Bangladesh budget — when touching them, cite the fiscal year in a comment.

## Dev server

`ruby -run -ehttpd . --port=8080` (see `.claude/launch.json`), or any static server. The service worker needs http(s), not `file://`.
