# AGENTS.md — InCalc

Operational rules for AI coding agents (Claude Code, Cursor, Codex CLI, etc.) working in this repo. Read this in full before making any code change.

## What this project is

InCalc is a single-file, offline-capable web app of banking calculators for Bangladesh banking practice (deposit interest with NBR excise duty + source tax, loan EMI, DSCR/DBR, settlement XIRR, scenario compare). It ships as static files on GitHub Pages at `clauding-lab.github.io/interest-calc/`. Stack: plain HTML/CSS/JS in one `index.html`, a service worker, a manifest, two pinned CDN libraries (Chart.js, SheetJS). No build step, no framework, no backend.

Owner: solo dev (Adnan, Bangladesh, UTC+6). Vibe-coded — Adnan directs AI agents, does not hand-write code. All explanations and summaries should be in **plain English with technical terms briefly explained**; never assume Adnan reads code. **Wrong financial output is the worst possible defect** — flag any change that alters a displayed number.

## Repository structure

```
index.html      # the entire app: inline markup + CSS + JS (~2,700 lines)
sw.js           # service worker — network-first page, cache-first assets
manifest.json   # PWA manifest
icon-192.png    # PWA icons
icon-512.png
README.md  LICENSE  AGENTS.md  VISION.md  AGENT_LEARNINGS.md
```

## Build, Test, Run

| Goal | Command |
|---|---|
| Serve locally (SW needs http, not file://) | `ruby -run -ehttpd . --port=8080` or `python3 -m http.server 8080` |
| "Test" the calc functions | extract a function from the `<script>` block and run it under `node` (see existing session test harnesses) |
| Parse-check the inline script | `node -e "const h=require('fs').readFileSync('index.html','utf8');const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];new (require('vm').Script)(s);console.log('OK')"` |
| Deploy | commit to `main`; GitHub Pages publishes automatically |

There is no unit-test suite checked in. Financial changes are verified by extracting the function and recomputing concrete examples under `node`, plus (for UI) Playwright screenshots at 320/768/1440.

## Landmines

1. **Never derive the embedded sample workbook (`SETTLE_SAMPLE_B64`) from a real file.** Office files are zip archives that retain hidden data (external links, metadata, shared strings) no visible-cell edit removes. Generate samples programmatically with fake data and verify them through `parseSettlementSheet` before embedding. (See `AGENT_LEARNINGS.md` 2026-06-11.)
2. **Regulatory values change every budget.** Source-tax rates, processing fee, and display FX live in the `CONFIG` block near the top of the script; excise-duty slabs live in `getED()` with a fiscal-year comment. Edit there only, and cite the fiscal year. Don't scatter rate literals back into the code.
3. **All calculations run in BDT; the currency toggle converts only at the display layer** (`toDisp()` inside `fmt`/`fmtS`). Never push the FX rate into calculation logic.
4. **Shared origin.** `clauding-lab.github.io` hosts other apps. The service worker's cache purge MUST stay scoped to the `incalc-` prefix, and `CACHE_NAME` MUST keep a unique prefix. Bump `CACHE_NAME` on every deploy that changes `index.html` or `sw.js`. (See `AGENT_LEARNINGS.md` 2026-06-11.)
5. **CDN scripts are SRI-pinned.** If you change the Chart.js or SheetJS version, recompute the `integrity` hash (`curl … | openssl dgst -sha384 -binary | openssl base64 -A`) or the script silently won't load.
6. **Escape everything from Excel/user input** into `innerHTML` via the existing `escH()`. The Settlement tab parses files received from third parties.
7. **Keep it one file.** Do not split `index.html` into modules or introduce a bundler — the no-build, single-file shape is intentional.

## Cross-cutting rules

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Times in BDT (UTC+6). No force-push to `main` without explicit sign-off. Never bypass hooks.
- No destructive ops (history rewrite, repo delete, Pages takedown) without explicit, named sign-off.
- After an incident or a caught bug, append to `AGENT_LEARNINGS.md`.
