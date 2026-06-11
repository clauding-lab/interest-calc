# InCalc BD — Native iOS App: Design Spec

**Date:** 2026-06-12
**Status:** Approved direction; pending implementation plan
**Owner:** Adnan Rashid (vibe-coded; AI agents implement)
**Reference implementation:** `clauding-lab/interest-calc` web app at tag `v1.0.0` (the verified JS engine is the source of truth for all financial math)

---

## 1. Goal & positioning

Ship InCalc as a **fully native SwiftUI iOS app on the App Store**. The primary goal is **credibility with colleagues and clients** — an App Store listing a banker can point people at. Not monetization (free, no IAP, no ads), not mass discovery.

- **App Store name:** `InCalc BD` (subtitle: `EMI, DSCR & Settlement IRR`)
- **All other branding** (home-screen display name, in-app, icon): **InCalc**
- **Why "BD":** the math is Bangladesh-specific (NBR excise slabs, PSR source tax, lakh/crore, BD DSCR practice). The geographic qualifier is honest scope *and* the defense against App Review guideline 4.3(b) ("indistinguishable from other calculators"). Fully native construction eliminates the 4.2 minimum-functionality risk entirely.

## 2. Top-level decisions (all confirmed with owner)

| Decision | Choice |
|---|---|
| Packaging | Fully native SwiftUI (no webview, no JS engine) |
| Scope | All five calculators: Deposit, Loan, DSCR/DBR, Settlement IRR, Compare |
| Math | Rewritten in Swift; **golden-vector cross-verification** against the JS engine is mandatory |
| Repo | New separate repo `incalc-ios` (mirrors the clauge/clauge-ios pattern) |
| Platform | iOS 17.0+, iPhone (runs scaled on iPad); light + dark via system setting |
| Currency | **BDT only** in v1 (the web FX toggle uses a stale hardcoded rate — a credibility liability; a user-set FX rate is a v1.1 candidate) |
| PDF export | **Not in v1** (v1.1 candidate via ShareLink + rendered PDF) |
| Price | Free; Finance category |

## 3. Architecture (`incalc-ios` repo)

```
InCalc/
├── App/            # InCalcApp.swift, RootTabView (TabView, 5 tabs, SF Symbols)
├── Engine/         # PURE Swift, no UI imports — the golden-vector-locked layer
│   ├── Config.swift        # sourceTax (PSR 10% / no-proof 15%), procFeeRate 1% — FY-labelled
│   ├── ExciseDuty.swift    # getED FY2025-26 slab table — FY-labelled comment, single table
│   ├── Deposit.swift       # FD/DPS/WDS/MBS/custom projections incl. year rows, ED/tax application
│   ├── Loan.swift          # EMI (shared annuity fn), amortization, prepayment, EAR effective rate
│   ├── DSCR.swift          # DSCR/DBR, PMT, monthly-IRR (Newton, NaN on empty), FV, full-tenor cashflows
│   ├── Settlement.swift    # XIRR (Newton, /365 day count), collection-for-IRR rule (excise/legal exclusion)
│   └── Money.swift         # lakh/crore formatting (mirror of web fmt/fmtS/grp, BDT only)
├── Features/       # one folder per tab: View + small ViewModel, Engine-only dependencies
│   ├── Deposit/  Loan/  DSCR/  Settlement/  Compare/
├── ExcelImport/    # SettlementSheetParser + fileImporter glue
├── Shared/         # GaugeShape (Circle().trim half-doughnut), chart helpers, About/disclaimer
├── Resources/      # bundled clean sample workbook (the SAME synthetic file as the web; NEVER from a real file)
└── Tests/
    ├── GoldenVectorTests.swift   # asserts Swift engine == golden-vectors.json
    ├── ExcelParserTests.swift    # fixture workbooks parse identically to the JS parser
    ├── MoneyFormatTests.swift    # lakh/crore grouping
    └── Fixtures/                 # golden-vectors.json + 4 fixture .xlsx files
Vendor/CoreXLSX/    # vendored fork (see §5)
```

Behavioral parity rule: each Engine function mirrors a named web function (`getED`, `emiFormula`, `buildSchedule`, `calcEffectiveRate`, `dscrPMT`, `dscrIRR`, `dscrFV`, `xirr`, collection-for-IRR logic in `settleUpdateTotals`/`calcSettlement`, deposit loops in `calcDeposit`). Where the web has documented quirks (e.g., full-period interest credited to mid-period contributions), **the Swift port replicates the quirk** — parity first; behavior changes happen web-first, then re-port.

## 4. The five tabs (native treatment)

Input paradigm: the web's sliders become **BDT-formatted text fields** (decimal keypad) with quick-pick chips where the web had them (FD/WDS tenor chips, advance-EMI counts). Each tab persists its last inputs (`@AppStorage`/UserDefaults). All validation guards from the web port 1:1.

- **Deposit** — segmented preset control (FD/DPS/WDS/MBS/Custom) driving the web's field show/hide logic; ED + source-tax toggles; PSR picker ("Return filed (PSR) — 10%" / "No return proof — 15%"); metric cards (future value, interest, invested, EAY, ED, tax, net receivable); 3-series growth chart (net/gross/invested — Swift Charts line+area); year-by-year table; plain-language summary **including the Bangla heading** as on the web.
- **Loan** — amount/rate/tenure; prepayment section with savings badge; advance-EMI + cash-security section with **EAR** card (labelled "Effective annual rate — compounded (EAR)"); stacked-bar + line payoff chart; amortization table.
- **DSCR/DBR** — income-statement form; short/long-term obligations as editable native lists (swipe-to-delete; confirm only when the row holds data — same rule as web); proposed loan (tenor capped 1–480, rate min 0); FDR cost-savings; metrics incl. "Effective Rate (IRR×12)"; obligation doughnut (SectorMark), **custom half-doughnut gauge** (Circle().trim shape — SectorMark cannot do half-circles), monthly funds-vs-obligations bars; expandable IRR cash-flow schedule (full tenor, never capped).
- **Settlement IRR** — three-screen flow: (import .xlsx | start blank) → edit (client info, receivables/waivers list with clamping, payment schedule) → results (XIRR, collection metrics, waiver breakdown, charts). Guards: loan amount + disbursement date + **settlement date required**; warn on rows excluded from IRR (no date, zero/negative amount); BDT-locked formatting. Bundled sample workbook shareable from the import screen. `.xls` files get a "please re-save as .xlsx" message.
- **Compare** — two scenario cards (deposit/loan pickers); winner decided on **numeric** totals; dual-line projection chart.

Charts: 8 of 9 are native Swift Charts (verified); only the gauge is custom. Chart curve shapes need not be pixel-identical to Chart.js — parity is asserted on data, not geometry.

## 5. Excel import

- **Library:** CoreXLSX 0.14.2, **vendored as a fork** in `Vendor/` (upstream dormant since 2023). Apply the known ~10-line `Relationship.SchemaType` catch-all patch (unknown relationship types in third-party files currently throw before any cell is readable; open upstream PRs #188/#193/#194 confirm the failure mode).
- **Proven feasible:** during research, CoreXLSX was built on this Mac and parsed the actual InCalc sample — cell values by reference, **cell formulas** (`Cell.formula` returned `"H14"` for the settlement row), and serial dates all work.
- **Parser parity (mirrors web `parseSettlementSheet`):** D2 client, D3 account, D4 loan amount, C9 disbursement date; G3:I11 receivables (waiver = max(0, recv − adj)); payment rows from row 10 (cap 300), settlement row detected by formula matching `/H1[45]/` **or** a "negotiat…" label in column E (the label fallback also covers CoreXLSX's shared-formula gap); tolerate up to 5 consecutive blank rows; keep amounts signed; comma/accounting-negative tolerant number parsing; clear any stale settlement date when the new file has no settlement row.
- **Date gotcha (load-bearing):** Excel serials convert via epoch 1899-12-30; format with a **local-timezone** DateFormatter (`yyyy-MM-dd`) — UTC round-trips shift BD dates by a day. Handle the rare ISO-string date cell (`t="d"`) with a string fallback.
- **Intake:** SwiftUI `.fileImporter`, UTType `org.openxmlformats.spreadsheetml.sheet`, with `startAccessingSecurityScopedResource()` (required on device for Files/iCloud picks).
- **Plan B** (if real bank files break CoreXLSX): hand-rolled ZIPFoundation + XMLParser reader for the small element subset needed (~300–500 lines). Decision trigger: any IDLC working file that fails to parse during testing.

## 6. Verification (the release gate)

1. **Golden vectors.** New file in the web repo: `tools/generate-golden-vectors.mjs` — extracts the live engine functions from `index.html` (the session-proven extraction technique) and emits `golden-vectors.json`:
   - `getED`: all 14 slab boundary values (300000/300001 … 50000000/50000001).
   - Deposit: presets × rates × tenors (incl. fractional 0.25/0.5) × compounding (12/4/2/1) × ED/tax toggles × PSR — asserting **year-by-year rows** (open, contrib, gross/net interest, ED, tax, closes), not just finals. ~200+ cases.
   - Loan: EMI/schedule/totals across amount/rate/tenure; prepayment savings; advance-EMI + cash-security EAR cases.
   - DSCR: tenors 36/60/61/84/120; advance installments (incl. = tenor and > tenor); zero-loan/zero-EMI (expect null IRR); FDR savings credit in final active month.
   - Settlement: XIRR incl. the Microsoft reference case (37.336253%); collection-for-IRR exclusion rules; excluded-row scenarios.
   - Compare: winner verdicts incl. the historical string-compare trap case (6% vs 7% on ৳6,00,000/5y).
2. **Tolerances:** integers/slabs exact; floats relative 1e-9; currency strings tested separately in `MoneyFormatTests` (lakh/crore grouping, negative, sub-1000).
3. **Excel fixtures:** the clean sample + 3 synthetic workbooks (no settlement row; scattered blanks; comma-text/negative cells). Expected parse outputs included in the vectors file (generated by running the web parser logic under Node + SheetJS).
4. **Run:** `xcodebuild test` locally (documented in AGENTS.md). No CI in v1.
5. **Release gate:** all tests green → TestFlight build → manual smoke checklist on owner's iPhone (each tab, an Excel import of a real working file, dark mode, offline) → submit.

## 7. App Store mechanics

- **First implementation step:** create the App Store Connect app record to lock the name `InCalc BD` (availability is probabilistic until reserved; fallback qualifier if rejected: `InCalc Banking Suite` — brand word stays).
- Bundle id `com.claudinglab.incalc` (or matching Clauge's prefix convention on the account); version 1.0.0 (build 1).
- `ITSAppUsesNonExemptEncryption=false` (zero networking, no custom crypto). No permission prompts at all (fileImporter needs none).
- **Privacy:** label "Data Not Collected" (truthful — no network calls); policy URL = new static `privacy.html` on the web repo's GitHub Pages site.
- **EU DSA:** declare non-trader status (or EU storefronts withheld).
- **Metadata = 4.3(b) defense:** description and screenshots lead with the BD story (NBR excise duty FY2025-26, PSR source tax, DSCR/DBR for credit memos, settlement XIRR from the working Excel). Screenshot sets: 6.9" and 6.5", mixed light/dark, captioned.
- **In-app About screen:** "Built for Bangladesh banking practice — rates per FY2025-26 Finance Act" + "Estimates only — verify against official figures" + version + link to web app.
- **Pipeline:** `xcodebuild archive → -exportArchive (app-store-connect) → upload` — the exact CLI flow that shipped Clauge from this Mac.

## 8. Cross-repo governance

- **Both** AGENTS.md files get the paired landmine: *regulatory values change web-first → regenerate `golden-vectors.json` → port the table to Swift → `xcodebuild test` green → ship both.* (Same pattern as Clauge's schema-version landmine #37.)
- Known upcoming instance: FY2026-27 Finance Act (effective ~1 Jul 2026) proposes the ED exemption rising to Tk 4 lakh — when enacted, this runbook gets its first real exercise, web v1.0.x and iOS 1.0.x together.
- `incalc-ios` is scaffolded with the standard trio: AGENTS.md, VISION.md, AGENT_LEARNINGS.md.

## 9. Out of scope for v1 (parked, not rejected)

PDF/share export; user-set FX rate (USD display); widgets; iPad-optimized layout; localization beyond the existing bilingual summary; mid-period compounding rule change (pending owner decision **web-first**, then re-port).

## 10. Risks

| Risk | Mitigation |
|---|---|
| Name "InCalc BD" taken at record creation | Reserve first; fallback `InCalc Banking Suite` |
| 4.3(b) spam query in review | BD-specific metadata; native build; honest review notes |
| CoreXLSX dormant / chokes on a real bank file | Vendored fork + SchemaType patch; label fallback; Plan-B hand-rolled parser (trigger: any real file failing) |
| Swift/JS math drift over time | Golden vectors are the contract; regenerate-and-test runbook in both AGENTS.md |
| BD date shift (+6 timezone) | Local-timezone date formatting; explicit parser tests with date fixtures |
| Review asks "is this financial services?" (2.1 query) | Honest answer scripted: offline calculator, no transactions, no advice; in-app disclaimer preempts |
