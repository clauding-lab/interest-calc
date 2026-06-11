# Vision

InCalc is a fast, offline, single-file calculator suite for day-to-day Bangladesh banking work. It should keep being trustworthy with numbers, instant to open, private (no backend, no tracking), and simple enough to maintain by editing one HTML file — never drifting into a framework, a build step, or a server.

The rules below scope what AI agents and contributors can ship without explicit sign-off.

## Merge by Default

- Bug fixes with a clear cause and bounded blast radius (especially calculation-correctness fixes, with a recomputed example as evidence).
- Documentation, README, and code-comment fixes.
- Accessibility, contrast, focus-state, and responsive/mobile fixes that don't change calculations.
- Small UI/UX tweaks that don't change layout, copy, or financial behavior materially.
- Service-worker reliability fixes that keep the `incalc-` cache prefix and bump `CACHE_NAME`.
- Internal refactors confined to the script that keep every displayed number identical (verified).

## Needs Sign-Off

- **Any change that alters a displayed financial number** — new conventions, rounding, compounding rules, or default rates. State the before/after number and the reason.
- **Updating regulatory values** (excise-duty slabs, tax rates) — confirm the fiscal year and source first.
- **New features / new calculators** — anything beyond a bug fix to user-visible behavior.
- **Adding/replacing a dependency** or bumping the Chart.js / SheetJS version (also recompute SRI).
- **Architectural changes** — introducing a build step, a framework, modules, or a backend (default answer: no).
- **Anything outward-facing or destructive** — making the repo public/private, GitHub Pages config, rewriting git history, deleting the repo.
- **The embedded sample workbook** (`SETTLE_SAMPLE_B64`) — only ever regenerate from synthetic data; never from a real file.

## When in doubt

If a change could conceivably surprise the user — especially by moving a number a banker might quote — ask first. The cost of one extra question is far below the cost of one wrong figure in a credit memo.
