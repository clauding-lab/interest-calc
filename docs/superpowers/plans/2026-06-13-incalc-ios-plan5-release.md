# InCalc BD iOS — Plan 5: App Store release (prep + runbook)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The **buildable prep** (Tasks A–C) runs in `~/Projects/incalc-ios` on `feat/plan5-release-prep` (off `main` @ `88f9209`, all 5 tabs merged). Tasks D–E run in the **web repo** `~/Projects/InCalc` (`clauding-lab/interest-calc`, GitHub Pages from `main`/root). Commit per task; push + PR at the end (iOS) / per the web repo's docs-merge convention (web). The **interactive runbook** (§Release) is owner-driven on the Mac — agents prepare, owner submits.

**Goal:** Close the only remaining phase. The app code is complete (44 app + 26 package tests green, `main` @ `88f9209`). This plan ships the missing *release artifacts* — none of which need the App Store console — plus the custom-domain wiring, then hands the owner a clean, unblocked submission runbook.

**Why now / what's missing (verified 2026-06-13):**
| Artifact | Current state | Owner of fix |
|---|---|---|
| App icon | ❌ none (only the vendored CoreXLSX *example* icon exists) — hard blocker for archive/upload | Task B |
| `ITSAppUsesNonExemptEncryption` | ❌ not set → every TestFlight build nags for export compliance | Task A |
| In-app About / disclaimer screen | ❌ absent — spec §7 requires it (also the 4.3(b)/2.1 review defense) | Task C |
| `privacy.html` | ❌ not in web repo — the required App Store privacy-policy URL | Task D |
| Custom domain `incalc.clauding-lab.com` | ❌ not wired (repo `cname: null`); App Store URLs should use it | Task E + owner DNS |
| Bundle id | ✅ already `com.claudinglab.incalcbd` in `project.yml` (lowercase, conventional) — **no change**, confirm only | Task A |
| Version 1.0.0 / build 1, portrait-only, iPhone-only, display name "InCalc BD" | ✅ already correct | — |

**Spec:** master §7 (App Store mechanics) + §8 (governance) + §10 (risks). **Public web app + privacy host: `https://incalc.clauding-lab.com/`** (custom domain — see §Domain wiring; falls back to `https://clauding-lab.github.io/interest-calc/` until the CNAME is live, but all baked URLs use the custom domain since the app ships after it's wired).

**Decisions (baked in — flag on PR if you disagree):**
- **Bundle id stays `com.claudinglab.incalcbd`** (lowercase, Apple reverse-DNS convention; already set; permanent once submitted).
- **About screen = a `.sheet`**, opened from a `topBarTrailing` `info.circle` toolbar button on **every** tab, wired via one reusable `aboutToolbar()` ViewModifier in the DesignSystem (DRY; disclaimer always one tap away on any tab — review-friendly). Static content, **no ViewModel** (nothing to compute → keeps the framework-free-VM rule trivially).
- **App icon source = the web PWA mark** (`icon-512.png`). Produce a crisp **1024×1024** single-size `AppIcon`. Source is only 512px → **faithful 2× upscale to 1024 (opaque, no alpha)** is the default (a flat glyph 2×-scales cleanly and avoids brand drift); redraw as vector ONLY if the upscale shows visible softness AND the mark reproduces exactly. **Do not invent a new mark.** Flatten any transparency onto the brand background as the PWA's apple-touch-icon presents it (web `background_color #f5f5f0`). Single-size appiconset (Xcode ≥14 derives the rest). Owner eyeballs the 1024 before push.
- **privacy.html** mirrors `index.html`'s look (same fonts/palette/`--theme-color`), states **"Data Not Collected"** truthfully (zero network calls, no analytics, no accounts; all computation on-device), names the FY2025-26 basis, links back to the app. No tracking, no third-party embeds.
- **Custom domain mirrors econdelta/yieldscope** (verified precedent): Cloudflare CNAME `incalc → clauding-lab.github.io`, **DNS-only (grey cloud, proxy OFF)**, GitHub-issued Let's Encrypt cert, Enforce HTTPS. Add the DNS record **before** the repo CNAME lands to avoid the ~13h cert lag.
- iOS prep (A–C) ships as ONE branch + PR (`feat/plan5-release-prep`); web (D–E) follows the repo's docs-merge convention.

**Parity landmines:** none — **this plan touches ZERO calculation code.** Engine, golden vectors, all five ViewModels and the Excel parser are byte-untouched. Any diff that alters a number is out of scope and must be rejected on review. (Project rule: wrong financial numbers are the worst defect class.)

---

## File structure
```
# iOS — feat/plan5-release-prep (~/Projects/incalc-ios)
project.yml                                              # +ITSAppUsesNonExemptEncryption=NO; confirm bundle id   [Task A]
App/Resources/Assets.xcassets/AppIcon.appiconset/
    Contents.json                                        # single-size 1024 appiconset                            [Task B]
    icon-1024.png                                        # crisp 1024 from the web mark                           [Task B]
DesignSystem/AboutToolbar.swift                          # reusable ViewModifier: info.circle button → About sheet [Task C]
Features/About/AboutView.swift                           # static disclaimer + version + links                    [Task C]
Features/{Loan,Deposit,DSCR,Compare,Settlement}/*View.swift  # apply .aboutToolbar() on each NavigationStack     [Task C]
Tests/AppTests/AboutTests.swift                          # version string + content render smoke                  [Task C]

# Web — docs-merge (~/Projects/InCalc)
privacy.html                                             # GitHub Pages privacy policy                            [Task D]
CNAME                                                    # "incalc.clauding-lab.com" (sets Pages custom domain)   [Task E]
docs/superpowers/plans/2026-06-13-incalc-ios-plan5-release.md   # this doc                                       [done]
```

---

## Tasks (subagent-driven; each independent, build-verified)

### Task A — Export-compliance flag + bundle-id confirm  *(project.yml; trivial)*
- Add to the `InCalcBD` target `settings.base`: `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO`.
- Confirm `PRODUCT_BUNDLE_IDENTIFIER: com.claudinglab.incalcbd` is unchanged.
- `xcodegen generate` → `xcodebuild test … -scheme InCalcBD` green; grep the generated Info.plist (in derived data) to confirm `ITSAppUsesNonExemptEncryption=false`.
- **Verify:** build green; key present in the built Info.plist.

### Task B — App icon
- Read `~/Projects/InCalc/icon-512.png`. Default: `sips`-upscale 512→1024, flatten any alpha onto the brand background (opaque). Redraw as a 1024 vector ONLY if the upscale is visibly soft AND the mark reproduces exactly — never invent a new mark. Report which path was taken + the background colour used.
- Create `App/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json` (single 1024 "ios-marketing" / universal entry) + `icon-1024.png`. Confirm `ASSETCATALOG_COMPILER_APPICON_NAME=AppIcon` (Xcode default) resolves; `App/` is already a target source dir so the catalog is compiled in.
- **Verify:** `xcodebuild` build succeeds with the catalog; no "missing icon"/alpha warnings. Save the final `icon-1024.png` path for owner review.

### Task C — In-app About screen + toolbar wiring
- `AboutView` (static, no VM). Content per spec §7, exact strings:
  - Title "InCalc BD"; one line: **"Built for Bangladesh banking practice — rates per FY2025-26 Finance Act."**
  - **"Estimates only — verify against official figures."**
  - App version read live from `Bundle.main` (`CFBundleShortVersionString` "1.0.0" + `CFBundleVersion` "1") — never hard-code.
  - Link to the web app **`https://incalc.clauding-lab.com/`** and a "Privacy" link to **`https://incalc.clauding-lab.com/privacy.html`**.
- `AboutToolbar` ViewModifier in DesignSystem: owns `@State showAbout`, adds the `topBarTrailing` `info.circle` button + `.sheet { AboutView() }`. Expose `func aboutToolbar() -> some View`.
- Apply `.aboutToolbar()` to each of the 5 tab roots inside their existing `NavigationStack`. **Settlement** already has a `.toolbar` — add the item there (don't double-wrap) or compose cleanly so both coexist.
- `AboutTests`: assert the rendered version equals the bundle version; assert the two disclaimer strings are present.
- **Verify:** build + all tests green (expect 44 → ~46); visual gate — About sheet screenshot in **light + dark**, text not truncated; info button visible on every tab.

### Task D — privacy.html (web repo)
- New `privacy.html` at repo root, styled to match `index.html` (reuse its CSS variables/fonts inline; respects light/dark `theme_color`). Sections: what's collected (**nothing** — on-device only, no network, no analytics, no accounts, no third parties), data retention (n/a), contact, effective date, link back to the app.
- **Verify:** opens standalone in a browser at the privacy URL; valid HTML; no external network calls (CSP-clean, no trackers). After domain wiring, confirm `https://incalc.clauding-lab.com/privacy.html` resolves 200.

### Task E — Custom domain `incalc.clauding-lab.com`  *(repo side; DNS is owner-driven)*
- Add repo-root `CNAME` file containing exactly `incalc.clauding-lab.com` (this sets the Pages custom domain on the next build of `main`).
- **Owner manual step (Cloudflare dashboard — API token is locked/invalid):** add DNS record **CNAME `incalc` → `clauding-lab.github.io`, Proxy: DNS only (grey cloud), TTL Auto** — identical to the `yieldscope`/`econdelta` records. Do this **before** the CNAME file merges to `main`.
- After merge + DNS live: set Pages config via `gh api -X PUT repos/clauding-lab/interest-calc/pages -f cname='incalc.clauding-lab.com'` (idempotent with the CNAME file), confirm GitHub provisions the cert, ensure `https_enforced: true`.
- **Verify:** `dig +short @8.8.8.8 incalc.clauding-lab.com` resolves to `clauding-lab.github.io` / Pages IPs; `curl -sI https://incalc.clauding-lab.com/` → 200 with a valid cert; `gh api …/pages` shows `cname: incalc.clauding-lab.com`, `https_enforced: true`.

---

## Verification (the prep release-gate, before handing to §Release)
1. `cd ~/Projects/incalc-ios && xcodegen generate && xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode` → green.
2. `swift test` (engine/import) → 26 green (must be untouched — proves no math drift).
3. Built Info.plist contains `ITSAppUsesNonExemptEncryption=false`; bundle id `com.claudinglab.incalcbd`.
4. App icon renders (1024 PNG reviewed; catalog compiles clean).
5. About sheet reachable from all 5 tabs; light+dark screenshots; version matches `1.0.0 (1)`; links point at `incalc.clauding-lab.com`.
6. `privacy.html` valid + truthful; resolves at `https://incalc.clauding-lab.com/privacy.html` once the domain is live (github.io path works in the interim).
7. `git diff` shows **no change** under `Sources/InCalcEngine`, `Sources/InCalcExcelImport`, any `*ViewModel.swift`, or `golden-vectors.json`.

---

## Release runbook (owner-driven, after prep merges — Mac + ASC console)
Agents can DRAFT (metadata copy, screenshot capture, the CLI commands); the owner does the console + signing + submit.

1. **Reserve the name first** — create the App Store Connect app record: name **"InCalc BD"** (fallback "InCalc Banking Suite"), subtitle "EMI, DSCR & Settlement IRR", bundle `com.claudinglab.incalcbd`, primary language English, SKU. *(Open question: is "InCalc BD" free at creation? Probabilistic until reserved.)*
2. **Signing** — Automatic, select the team; first archive provisions the App Store profile.
3. **Screenshots** — 6.9" + 6.5", mixed light/dark, BD-story captions (NBR excise FY2025-26, PSR source tax, DSCR/DBR credit memo, settlement XIRR from Excel). Agent captures via `simctl`; owner reviews/uploads.
4. **Privacy** — "Data Not Collected"; policy URL `https://incalc.clauding-lab.com/privacy.html`.
5. **EU DSA** — declare non-trader status (or withhold EU storefronts).
6. **Metadata = 4.3(b) defense** — description leads with the BD story; honest review notes ("offline calculator, no transactions, no advice, in-app disclaimer"). Agent drafts; owner edits.
7. **Pipeline** — `xcodebuild archive → -exportArchive (app-store-connect) → upload` (the Clauge CLI flow from this Mac) → TestFlight → submit for review.

---

## Out of scope (parked)
PDF/share export, USD FX display, widgets, iPad layout, deeper localization, mid-period compounding rule (owner decision, **web-first**), the post-merge housekeeping trio (PlaceholderTab delete, SettlementView split, global framework-free-VM lesson) — none block release.
