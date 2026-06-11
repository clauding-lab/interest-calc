# Agent Learning Rulebook — InCalc

A running log of lessons learned the hard way while shipping InCalc.

Different from `AGENTS.md` — that file documents **stable conventions and landmines** (the codebase is structured this way; don't break it). This file documents **incidents and lessons** (this is what went wrong, and here's how to prevent recurrence).

**Author:** AI agents under Adnan's direction. Appended on every incident; entries are point-in-time observations that may go stale but the lesson stays.

## How to add an entry

When something ships broken, when a methodology gap is exposed, or when a smoke test catches a real bug:

1. Write the entry below using the template.
2. If the lesson generalizes across Adnan's other projects, also append to the global rulebook at `~/.claude/AGENT_LEARNINGS.md`.
3. Save to AI auto-memory at `~/.claude/projects/<project-slug>/memory/` so future Claude sessions inherit.
4. If the lesson is a stable codebase rule, distill into a numbered `AGENTS.md` landmine.

## Entry template

```markdown
## YYYY-MM-DD — vX.Y.Z | Short title

**Trigger:** what surfaced the issue.

**What went wrong:** root cause in plain English; cite file:line if useful.

**Lesson:** the generalizable rule in one sentence.

**Prevention:** concrete steps (validator, smoke checklist, CI gate).

**Hotfix:** what shipped to resolve.

**Cross-references:** AGENTS.md landmine, auto-memory key, global rulebook entry.
```

---

## Entries (most recent first)

## 2026-06-11 — main | Service worker cache purge nearly wiped a sibling app — GitHub Pages project sites share one origin

**Trigger:** Pre-deploy adversarial review of the v2 cache bump caught it before shipping. `sw.js`'s activate handler deleted *every* Cache Storage entry not named `incalc-v2` — but `clauding-lab.github.io` hosts multiple project sites (this app at `/interest-calc/`, SME-360 at `/SME-360/`), and Cache Storage is **origin**-scoped, not path-scoped. Deploying the bump would have deleted SME-360's `sme360-v2` cache in every returning browser, breaking its offline mode with no self-heal (its SW never re-caches at runtime).

**What went wrong:** The `caches.keys().filter(k => k !== CACHE_NAME)` purge pattern (copied everywhere on the web) silently assumes the app owns the whole origin. On `<user>.github.io` project sites, it never does.

**Lesson:** On a shared origin, every service worker must namespace its caches and purge only its own prefix — `keys.filter(k => k.startsWith('incalc-') && k !== CACHE_NAME)`.

**Prevention:** Any SW change in any repo deployed to `clauding-lab.github.io` must use a unique cache prefix and a prefix-scoped purge. Note: **SME-360's own sw.js has the identical delete-all bug** and will wipe InCalc's cache on its next bump — fix it there too (InCalc partially self-heals via runtime re-puts; the precached CDN assets don't).

**Hotfix:** Prefix-scoped filter shipped in the same commit as the v2 bump (`81cedf7`), alongside SheetJS precaching so Settlement IRR works offline.

**Cross-references:** Global rulebook entry 2026-06-11 (shared-origin collisions); SME-360 repo follow-up.

## 2026-06-11 — main | Real borrower data shipped inside the embedded "sample" workbook, public for ~3 months

**Trigger:** A full-repo multi-agent review decoded the `SETTLE_SAMPLE_B64` blob (`index.html`, the Settlement IRR tab's downloadable sample) and found confidential data inside. The repo was public on GitHub with the app live on GitHub Pages.

**What went wrong:** The sample workbook was created by editing a real working file from a live settlement case instead of building one from scratch. An .xlsx is a zip archive — beyond the visible cells (which themselves still held a real client name and loan account number), the zip carried external-link relationship paths exposing a second borrower's name and internal folder structure, document metadata naming the author, and internal appraisal-model sheet names. It shipped in the commit that added the sample-download feature (2026-03-18) and stayed public until 2026-06-11.

**Lesson:** Never derive a public sample/template from a real working file — office documents are zip archives that carry hidden payloads (external links, metadata, shared strings, comments) far beyond the cells you can see and edit.

**Prevention:** (1) Generate samples programmatically (openpyxl/SheetJS) with obviously fake data, never by editing real files. (2) Before embedding or publishing any binary/base64 artifact, decode it and grep every *decompressed* member for names, account-number patterns, file paths, and creator metadata — a raw grep on the compressed bytes finds nothing. (3) Before any repo goes public, sweep binaries and base64 blobs, not just source text. (4) Verify the regenerated sample through the app's actual parser before shipping it.

**Hotfix:** Repo made private and the GitHub Pages site deleted within minutes of confirmation (public URL verified 404). A clean dummy workbook was generated with openpyxl, verified cell-by-cell through the app's own parse logic with the same SheetJS build, and swapped in. `git filter-repo` rewrote all history so every commit carries only the clean blob; force-pushed after explicit owner sign-off. A fresh clone of the remote was then decoded commit-by-commit: zero confidential strings across all 21 commits. Residual: pre-rewrite commits remain fetchable by SHA as dangling objects on GitHub's servers (harmless while private; purge via GitHub Support or repo re-creation before going public).

**Cross-references:** Global rulebook entry 2026-06-11 (office-file PII surfaces); auto-memory `reference_incalc_pii_scrub`.
