# InCalc BD iOS — Plan 4b: DSCR / DBR tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). **Work in `~/Projects/incalc-ios` on a new branch `feat/plan4b-dscr`** (off `main` @ `0b8dcec`, which has Plans 3 + 4a merged). Commit per task; push + PR only at the end.

**Goal:** The **DSCR/DBR tab**, fully working: an income-statement form, two **editable obligation lists** (short-term + long-term, add / swipe-to-delete with confirm-when-populated), proposed-loan + FDR + advance inputs, the metric cards (DSCR, DBR before/after, Effective Rate IRR×12, EMI, EBITDA + a monthly summary + the IRR pair), a **custom half-doughnut gauge**, an obligation-mix doughnut, a funds-vs-obligations bar, and the collapsible **full-tenor IRR cash-flow schedule** — wired onto `InCalcEngine.DSCR`.

**Architecture:** MVVM-lite. A `@Observable` `DSCRViewModel` (injected UserDefaults for scalars; obligation lists seeded fresh per launch, web parity) holds the income statement + obligation arrays + proposed-loan/FDR/advance inputs, calls `DSCR.proposedLoan(...)` for the EMI/FV/IRR/cashflows, and computes the **DSCR/DBR ratios + EBITDA + obligation totals in-VM** (simple web formulas, unit-tested) since the engine deliberately exposes only the IRR segment. `DSCRView` renders. Engine handles the parity-prone math (round-up EMI, FV, Newton IRR); the VM does trivial ratio arithmetic.

**Tech Stack:** Swift 6.3 / Xcode 26.5, SwiftUI (iOS 17), Swift Charts (SectorMark doughnut + BarMark), a custom `Shape`/`trim` gauge, `@Observable`, XcodeGen, `xcodebuild`/`simctl` on the iPhone 17 / iOS 26.5 sim.

**Spec:** master `…incalc-ios-design.md` §4 (DSCR). Web parity: `~/Projects/InCalc/index.html` `calcDSCR` (~1973–2189), obligation render/add/del (~1900–1934, 2436–2445), gauge (~2156–2169).

**Decisions (inherited + DSCR-specific, baked in — flag on PR if you disagree):**
1. Inherited: native fonts, `@Observable`+UserDefaults (scalars), reuse ALL `DesignSystem/` components (Theme/SurfaceCard/MetricCard/LabeledSlider/LabeledToggle/LabeledPicker/Chip/PresetSelector/ChartStyle). For DSCR's free-number inputs (sales/cogs/loan amount — large, exact figures), use `BDTField` (typed ৳ entry), NOT sliders — the web uses raw number fields here, and a slider can't span 50,000,000.
2. **Obligation lists are seeded fresh each launch** (web re-seeds demo rows; not persisted). Scalars (income statement, proposed loan, FDR, advance) persist.
3. **VM computes the DSCR/DBR ratios** (engine has only `proposedLoan`); unit-tested against the web formulas below.
4. **BDT-only** (ignore the web USD toggle).

**Parity landmines (wrong numbers = worst defect):**
- **EMI rounds UP to the nearest 10** — the engine does `((emi+4.999)/10).rounded()*10`. Use the engine's `emi`; never recompute.
- **Effective Rate = monthly IRR × 12 (nominal), NOT EAR.** The engine already returns `irr*12`. Display `irrWithSaveAnnual * 100`; show **"N/A"** when nil.
- **Short-term burden = `amount*(rate/100)*(util/100)`** (interest on the utilised portion); **long-term burden = `emi*12`** (the long-term `amount` column is decorative — does NOT feed the total). Easy to wrongly treat both as EMIs.
- **Delete-confirm only when the row holds data:** short-term if `amount>0 || !bank.isEmpty`; long-term if `emi>0 || amount>0 || !bank.isEmpty`. Empty scratch rows delete silently.
- **Gauge:** value = DSCR; arc clamped to [0,3]; the centre label shows the **unclamped** value. Colour zones: `<1.0` red, `1.0–1.5` amber, `≥1.5` green (`#6aab20`).
- **Daily-sales ratio uses `/360`** (banker's year). **Cost-savings credited in the FINAL active month only** (`m == activeTenor`, never month 0). **`activeTenor = tenor − advInst`**; advInst ≥ tenor or netDisburse ≤ 0 → IRR N/A.

---

## File structure (new, under `~/Projects/incalc-ios`)
```
DesignSystem/
  GaugeView.swift            # custom half-doughnut (Circle().trim) + green `good` token  [Task 1]
Features/DSCR/
  DSCRViewModel.swift        # income + obligations + proposedLoan wiring + ratios        [Task 2]
  DSCRView.swift             # the screen (editable lists, gauge, charts, IRR schedule)    [Task 3]
Tests/AppTests/
  DSCRViewModelTests.swift                                                                 [Task 2]
App/RootTabView.swift        # DSCR placeholder → DSCRView()                               [Task 3]
```

**Engine API (verified — `Sources/InCalcEngine/DSCR.swift`):**
```swift
DSCR.proposedLoan(amount:Double, tenorMonths:Int, annualRatePct:Double, advanceInstallments:Int,
                  fdrAmount:Double, fdrRatePct:Double, poolRatePct:Double) -> DSCR.ProposedLoan
//   ProposedLoan(emi, fvFdr, fvPool, costSavings, netDisburse, activeTenor,
//                cashflowsNoSave:[Double], cashflowsWithSave:[Double],
//                irrNoSaveAnnual:Double?, irrWithSaveAnnual:Double?)   // annuals already ×12; nil = N/A
Money.fmt(_:) -> String
```

**VM-computed ratio formulas (port the web `calcDSCR` exactly):**
```
ebitda        = (sales - cogs - ga) + depr
stTotal       = Σ st.amount * (st.rate/100) * (st.utilization/100)
ltTotal       = Σ lt.emi * 12
existingTotal = stTotal + ltTotal
proposedBurden= proposedLoan.emi * 12
totalObligation = existingTotal + proposedBurden
dscr          = totalObligation>0 ? ebitda/totalObligation : 0          // "2.34x"
dbrAfter      = ebitda>0 ? totalObligation/ebitda : 0                   // "%.1f%%" of ×100
dbrBefore     = ebitda>0 ? existingTotal/ebitda : 0                     // teal
monthlyFunds  = ebitda/12 ;  monthlyOblig = totalObligation/12 ;  prevMonthly = existingTotal/12
dailySalesX   = (sales>0 && monthlyOblig>0) ? (sales/360)/monthlyOblig : 0    // bare 3dp, no ৳
pctIncrease   = prevMonthly>0 ? proposedLoan.emi/prevMonthly*100 : 0    // "%.1f%%"
procFee       = loanAmt*0.01 ;  loanDeposit = proposedLoan.emi*advInst   // display only
effectiveRate = proposedLoan.irrWithSaveAnnual.map { $0*100 }            // nil → "N/A", else "%.2f%%"
irrNoSave     = proposedLoan.irrNoSaveAnnual.map { $0*100 }              // nil → "N/A"
```

**Input defaults / guards (web):** sales 50,000,000 · cogs 45,000,000 · ga 2,500,000 · depr 50,000 (free ৳ fields). Loan amount 1,000,000 · tenor 36 (1–480, soft) · rate 19 (≥0, step .01). Advance installments 0 (no clamp). FDR amount 200,000 · fdrRate 7 · poolRate 10. Seed obligations: short-term `[("Prime Bank", 1_000_000, 16, 80)]`, long-term `[("BRAC Bank", amount 1_000_000, emi 36_000)]`.

---

### Task 1: `GaugeView` (custom half-doughnut) + a green token

**Files:** Create `DesignSystem/GaugeView.swift`; add a `good` colour to `Theme`.

- [ ] **Step 1:** In `DesignSystem/Theme.swift`, add to `Theme.Colors`: `static let good = Color.dynamic(Color(hex: "6aab20"), Color(hex: "8fd03a"))` (green for the healthy DSCR zone — web uses `#6aab20`; dark variant lightened).

- [ ] **Step 2:** Create `DesignSystem/GaugeView.swift` — a 180° half-doughnut. Value clamped to `[0, maxValue]` for the arc; the caller passes the colour. Use a trimmed `Circle` rotated so the arc spans the top half (or bottom semicircle, matching the web's left-start 180° sweep). Skeleton:
```swift
import SwiftUI

/// A half-doughnut gauge (180° sweep). `value` drives the arc length (clamped to 0...maxValue) and
/// the centre label is supplied pre-formatted (web shows the UNCLAMPED value). `tint` is the zone colour.
struct GaugeView: View {
    let value: Double
    let maxValue: Double
    let label: String
    let tint: Color
    var body: some View {
        let frac = min(max(value, 0), maxValue) / maxValue   // 0...1 over the half circle
        ZStack {
            // track (full half)
            Circle().trim(from: 0, to: 0.5)
                .stroke(Theme.Colors.surface2, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                .rotationEffect(.degrees(180))
            // value arc
            Circle().trim(from: 0, to: 0.5 * frac)
                .stroke(tint, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                .rotationEffect(.degrees(180))
            Text(label).font(Theme.Fonts.mono(24, .semibold)).foregroundStyle(tint)
                .offset(y: 8)
        }
        .frame(height: 110)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("DSCR gauge: \(label)")
    }
}

#Preview {
    VStack { GaugeView(value: 2.1, maxValue: 3, label: "2.10x", tint: Theme.Colors.good) }
        .padding().background(Theme.Colors.bg)
}
```
(The `trim(from:0,to:0.5)` + `rotationEffect(180°)` gives a bottom semicircle; adjust the rotation if the preview shows it on the wrong half — the contract is a 180° arc that fills left→right as `value` rises. Verify visually in the preview / Task 3 screenshot.)

- [ ] **Step 3:** Build + commit.
```bash
cd ~/Projects/incalc-ios && xcodegen generate >/dev/null
xcodebuild build -project InCalcBD.xcodeproj -scheme InCalcBD -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -3
git add DesignSystem && git commit -m "feat(ios): half-doughnut GaugeView + good (green) Theme token"
```

---

### Task 2: `DSCRViewModel` + tests (the heaviest VM — obligation lists + ratios + IRR)

**Files:** Create `Features/DSCR/DSCRViewModel.swift`, `Tests/AppTests/DSCRViewModelTests.swift`. **Most capable model.** TDD.

**Public surface (keep stable for Task 3):**
- Income (persisted, `BDTField`-bound Doubles): `sales/cogs/ga/depreciation`.
- Proposed loan (persisted): `loanAmount: Double`, `tenorMonths: Int`, `interestRatePct: Double`, `advanceInstallments: Int`.
- FDR (persisted): `fdrAmount/fdrRatePct/poolRatePct: Double`.
- Obligation lists (NOT persisted; seeded): `shortTerm: [ShortTermObligation]`, `longTerm: [LongTermObligation]` where
  `struct ShortTermObligation: Identifiable { id; var bank:String; var amount, rate, utilization: Double }`,
  `struct LongTermObligation: Identifiable { id; var bank:String; var amount, emi: Double }`.
  - `addShortTerm()` / `addLongTerm()` append a zeroed row.
  - `deleteShortTerm(at:)` / `deleteLongTerm(at:)` remove by index.
  - `shortTermNeedsConfirm(at:) -> Bool` = `amount>0 || !bank.isEmpty`; `longTermNeedsConfirm(at:)` = `emi>0 || amount>0 || !bank.isEmpty`.
  - `shortTermBurden(_:) -> Double` = `amount*(rate/100)*(utilization/100)`; `longTermBurden(_:) = emi*12`.
- Derived (computed; memoize the `DSCR.ProposedLoan` via `recompute()` on input `didSet`, like the other VMs — note list mutations also recompute):
  - `ebitda`, `stTotal`, `ltTotal`, `existingTotal`, `proposedBurden`, `totalObligation`, `dscr`, `dbrAfter`, `dbrBefore`, `monthlyFunds`, `monthlyOblig`, `prevMonthly`, `dailySalesX`, `pctIncrease`, `procFee`, `loanDeposit` (all per the formulas above).
  - Formatted strings: `dscrText` ("%.2fx"), `dbrAfterText`/`dbrBeforeText` ("%.1f%%"), `effectiveRateText`/`irrNoSaveText` (nil → "N/A" else "%.2f%%"), `emiText`, `ebitdaText`, `procFeeText`, `loanDepositText`, `fvFdrText`, `fvPoolText`, `costSavingsText`, `monthlyFundsText`, `monthlyObligText`, `prevObligText`, `dailySalesXText` ("%.3f"), `pctIncreaseText` ("%.1f%%") — ৳ ones via `Money.fmt`.
  - Gauge: `gaugeValue = dscr`, `gaugeLabel = dscrText`, `gaugeTint` (`dscr<1 ? warn : dscr<1.5 ? amber : good`).
  - Doughnut: `obligationSegments: [(label:String, value:Double, color:Color)]` = [("Short-Term", stTotal, accent), ("Long-Term", ltTotal, accent2), ("Proposed", proposedBurden, amber)].
  - Bars: `monthlyBars: [(label:String, value:Double, color:Color)]` = [("Available Funds", monthlyFunds, accent2), ("Obligations", monthlyOblig, warn)].
  - IRR schedule: `cashflowRows: [CashflowRow]` (`struct CashflowRow: Identifiable { id; month:Int; cashFlow:Double; savingsAdj:Double; withSavings:Double }`) from the engine's `cashflowsNoSave`/`cashflowsWithSave`: month m → cashFlow=cfNoSave[m], savingsAdj = (m == activeTenor && m>0) ? costSavings : 0, withSavings=cfWithSave[m]. NEVER capped.

- [ ] **Step 1: Failing tests** — assert the engine wiring + the ratio formulas + the list/gauge logic. Include at minimum:
```swift
import XCTest
import InCalcEngine
@testable import InCalcBD

@MainActor
final class DSCRViewModelTests: XCTestCase {
    private func vm(_ s: String = #function) -> DSCRViewModel {
        let d = UserDefaults(suiteName: s)!; d.removePersistentDomain(forName: s); return DSCRViewModel(defaults: d)
    }
    // EBITDA + DSCR/DBR from defaults match the web formulas.
    func test_defaultRatios() {
        let m = vm()  // sales 5e7, cogs 4.5e7, ga 2.5e6, depr 5e4
        XCTAssertEqual(m.ebitda, (50_000_000 - 45_000_000 - 2_500_000) + 50_000, accuracy: 1e-6)
        let eng = DSCR.proposedLoan(amount: m.loanAmount, tenorMonths: m.tenorMonths, annualRatePct: m.interestRatePct,
                                    advanceInstallments: m.advanceInstallments, fdrAmount: m.fdrAmount,
                                    fdrRatePct: m.fdrRatePct, poolRatePct: m.poolRatePct)
        let stTotal = 1_000_000 * 0.16 * 0.80          // seed short-term burden
        let ltTotal = 36_000.0 * 12                    // seed long-term burden
        let total = stTotal + ltTotal + eng.emi * 12
        XCTAssertEqual(m.dscr, m.ebitda / total, accuracy: 1e-9)
        XCTAssertEqual(m.emiText, Money.fmt(eng.emi))
    }
    // Short-term burden = amount*rate*util; long-term = emi*12 (amount decorative).
    func test_burdenFormulas() {
        let m = vm()
        XCTAssertEqual(m.shortTermBurden(m.shortTerm[0]), 1_000_000 * 0.16 * 0.80, accuracy: 1e-6)
        XCTAssertEqual(m.longTermBurden(m.longTerm[0]), 36_000 * 12, accuracy: 1e-6)
    }
    // Delete-confirm gate.
    func test_deleteConfirmGate() {
        let m = vm()
        XCTAssertTrue(m.shortTermNeedsConfirm(at: 0))          // seeded Prime Bank row holds data
        m.addShortTerm()
        XCTAssertFalse(m.shortTermNeedsConfirm(at: 1))         // fresh zero row
    }
    // Gauge zones.
    func test_gaugeZones() {
        let m = vm()
        m.sales = 0; m.cogs = 0; m.ga = 0; m.depreciation = 0   // ebitda 0 → dscr 0 → red
        XCTAssertEqual(m.gaugeTint, Theme.Colors.warn)
    }
    // Effective Rate is IRR×12 and N/A when advInst >= tenor.
    func test_effectiveRateAndNA() {
        let m = vm()
        XCTAssertNotEqual(m.effectiveRateText, "N/A")           // valid default
        m.advanceInstallments = m.tenorMonths                   // activeTenor 0 → N/A
        XCTAssertEqual(m.effectiveRateText, "N/A")
    }
    // IRR schedule runs the full active tenor; savings only in the final active month.
    func test_cashflowSchedule() {
        let m = vm()
        let eng = DSCR.proposedLoan(amount: m.loanAmount, tenorMonths: m.tenorMonths, annualRatePct: m.interestRatePct,
                                    advanceInstallments: m.advanceInstallments, fdrAmount: m.fdrAmount,
                                    fdrRatePct: m.fdrRatePct, poolRatePct: m.poolRatePct)
        XCTAssertEqual(m.cashflowRows.count, eng.cashflowsNoSave.count)
        XCTAssertEqual(m.cashflowRows.last?.savingsAdj ?? 0, eng.costSavings, accuracy: 1e-6)
    }
    func test_persistsScalars() {
        let s = #function; let d = UserDefaults(suiteName: s)!; d.removePersistentDomain(forName: s)
        let a = DSCRViewModel(defaults: d); a.loanAmount = 2_500_000; a.tenorMonths = 60
        let b = DSCRViewModel(defaults: d)
        XCTAssertEqual(b.loanAmount, 2_500_000); XCTAssertEqual(b.tenorMonths, 60)
    }
}
```

- [ ] **Step 2: Run — FAIL.** `xcodebuild test ... -only-testing:AppTests/DSCRViewModelTests`.
- [ ] **Step 3: Implement** the VM per the surface above. `@MainActor @Observable`; scalars load in `init`/persist in `didSet`; obligation arrays seeded in `init` (not persisted) — array mutations call `recompute()`. Memoize `engine = DSCR.proposedLoan(...)`. All ratios per the formulas. `gaugeTint`/`obligationSegments`/`monthlyBars` reference `Theme.Colors`. (Importing Theme from the VM is fine — it's in the app module.)
- [ ] **Step 4: Run — PASS.** Fix the VM if a number's off (engine is golden); never the engine.
- [ ] **Step 5: Commit** — `git add Features/DSCR Tests/AppTests/DSCRViewModelTests.swift && git commit -m "feat(ios): DSCRViewModel — income, editable obligations, ratios, IRR wiring + tests"`

---

### Task 3: `DSCRView` (editable lists, gauge, charts, IRR schedule) + tab

**Files:** Create `Features/DSCR/DSCRView.swift`; Modify `App/RootTabView.swift` (DSCR tab → `DSCRView()`, keep `gauge.with.dots.needle.50percent`). **Most capable model.** Follow LoanView/DepositView structure (`@State` VM + scoped `@Bindable`).

Compose, in order:
1. **Income statement** `SurfaceCard`: `BDTField`s for sales/cogs/ga/depreciation + read-only derived rows (Gross profit, NOP, EBITDA) shown as muted lines.
2. **Short-term obligations** `SurfaceCard`: a header row (Bank · Amt · Rate · Util · Burden), then `ForEach($vm.shortTerm)` rows — each row: a small `TextField` (bank), `BDTField`/number fields (amount), number fields (rate, utilization), the computed burden (`Money.fmt(vm.shortTermBurden(row))`), and **swipe-to-delete** (`.swipeActions` or a trailing `×` button) that, when `vm.shortTermNeedsConfirm(at:)`, shows a confirmation `.alert` before `vm.deleteShortTerm(at:)`; empty rows delete immediately. A "+ Add Short-Term" button → `vm.addShortTerm()`. Total row = `Money.fmt(vm.stTotal)`.
3. **Long-term obligations** `SurfaceCard`: same pattern (Bank · Amt · EMI · Burden), burden = `Money.fmt(vm.longTermBurden(row))`, total `vm.ltTotal`, confirm via `vm.longTermNeedsConfirm`.
4. **Proposed loan + FDR + advance** `SurfaceCard`(s): `BDTField` loan amount; number fields/`LabeledSlider` for tenor (1–480) + rate; advance installments (number/stepper); FDR amount/rate/pool-rate. Show EMI (`vm.emiText`), processing fee (`vm.procFeeText`), loan deposit (`vm.loanDepositText`), FV FDR/pool + cost savings.
5. **Metric cards** grid: DSCR (`vm.dscrText`), DBR After (`vm.dbrAfterText`, warn), DBR Before (`vm.dbrBeforeText`, teal/accent2), Effective Rate IRR×12 (`vm.effectiveRateText`, warn), Monthly Installment (`vm.emiText`), EBITDA (`vm.ebitdaText`, accent2). Plus a monthly-summary block (daily-sales ×, monthly funds/obligations/previous, % increase) and the IRR pair (no-save / with-save).
6. **Gauge** in a `SurfaceCard`: `GaugeView(value: vm.gaugeValue, maxValue: 3, label: vm.gaugeLabel, tint: vm.gaugeTint)` + the static scale ticks (0 · 1.0 · 1.5 · 3.0+).
7. **Charts**: an obligation-mix doughnut (Swift Charts `SectorMark(angle:, innerRadius: .ratio(0.62))` over `vm.obligationSegments`, `.foregroundStyle` per segment) + a funds-vs-obligations bar (`BarMark` over `vm.monthlyBars`). Manual legends as needed. `accessibilityLabel`s.
8. **IRR cash-flow schedule** in a collapsible `DisclosureGroup` ("Cash-flow schedule"): header Month · Cash Flow · Savings Adj. · CF (with Savings); `ForEach(vm.cashflowRows)` rows via `Money.fmt`, the `—` for zero savingsAdj. Full tenor (scrollable; do NOT cap).

- [ ] **Step 1:** Implement `DSCRView` per the brief, reusing the design system + `GaugeView`. Every number/string from `vm`.
- [ ] **Step 2:** Wire `RootTabView` DSCR tab → `DSCRView()`, keep the `gauge.with.dots.needle.50percent` `.tabItem`; leave Compare/Settlement placeholders.
- [ ] **Step 3: Build + full test suite** (`xcodebuild test` — DSCR + Deposit + Loan green). Fix SwiftUI compile issues minimally (the editable `ForEach($vm.shortTerm)` bindings, swipe-to-delete + alert, SectorMark, the gauge) without changing the VM API or any number.
- [ ] **Step 4: Light/dark screenshots** — boot iPhone 17, install, launch, drive to the DSCR tab (3rd tab; if you can't tap headlessly, use a temporary uncommitted `selection` default, capture `/tmp/dscr-light.png` + `/tmp/dscr-dark.png`, REVERT the hack, verify clean). Read the PNGs; confirm the income form, obligation lists, gauge (correct zone colour), cards, charts, and IRR schedule render in both themes; **sanity-check the DSCR value + gauge colour against the engine** (default inputs → DSCR ≈ ebitda/totalObligation). Report what you see.
- [ ] **Step 5: Commit** — `git add Features/DSCR/DSCRView.swift App/RootTabView.swift && git commit -m "feat(ios): DSCR tab — income, editable obligations, gauge, charts, IRR schedule"`

---

### Task 4: Polish, governance, gate, PR

- [ ] **Step 1:** Placeholder sanity (Compare/Settlement still placeholders; Loan/Deposit/DSCR work).
- [ ] **Step 2:** `AGENTS.md` — add `GaugeView` + `Theme.Colors.good` to the inventory; note the **editable-list pattern** (seeded-not-persisted arrays, `*NeedsConfirm` swipe-delete gate, in-VM ratio math with engine `proposedLoan` for the IRR/EMI/FV). Reinforce design-drift (Compare/Settlement reuse all of this).
- [ ] **Step 3:** `AGENT_LEARNINGS.md` — append any incident (e.g. the gauge trim/rotation direction, or an IRR-N/A edge). If clean, one line.
- [ ] **Step 4: Full gate** — `xcodebuild test` (all app tests) + `swift test` (engine/import untouched, 26 green).
- [ ] **Step 5:** Commit docs (`docs(ios): GaugeView + DSCR editable-list notes`).
- [ ] **Step 6 (controller, after final review):** push + PR (`Plan 4b: DSCR tab`).

---

## Self-review (writing-plans checklist)
- **Spec coverage (§4 DSCR):** income statement (Task 3 #1), editable obligation lists + delete-confirm + swipe (Task 2 surface + Task 3 #2-3), proposed loan/FDR/advance (Task 3 #4), metrics incl. Effective Rate IRR×12 + EBITDA + monthly summary + IRR pair (Task 2 formulas → Task 3 #5), custom half-doughnut gauge (Task 1 + Task 3 #6), obligation doughnut + funds/obligations bars (Task 3 #7), full-tenor IRR schedule never capped (Task 2 `cashflowRows` + Task 3 #8). Decisions: BDTField for free-number inputs, lists seeded-not-persisted, VM-computed ratios.
- **Type consistency:** `DSCRViewModel` surface used by tests (`ebitda`, `dscr`, `emiText`, `shortTermBurden`, `*NeedsConfirm`, `gaugeTint`, `cashflowRows`, `effectiveRateText`) == surface consumed by `DSCRView`. Engine call uses the exact `DSCR.proposedLoan(...)` signature. `GaugeView(value:maxValue:label:tint:)` consumed by the view.
- **No placeholders:** parity-critical VM contract + formulas + tests + gauge carry full detail; the view is a structured brief over the established LoanView/DepositView pattern + the new `GaugeView`/editable-list (the implementer composes, then verifies on the simulator).

## Open items to confirm while executing
- **Gauge arc direction:** verify the `trim`+`rotationEffect` produces a left→right-filling 180° arc (adjust rotation in Task 1 against the preview / Task 3 screenshot).
- **Editable `ForEach($vm.shortTerm)`** needs `ShortTermObligation: Identifiable` + the array as a `@Bindable` binding; confirm row-field edits recompute totals live.
- **VM-computed ratios are unit-tested but not golden-vector'd** — if any ratio is suspect, cross-check the exact web `calcDSCR` line; the hard math (EMI round-up, IRR, FV) stays engine-side and golden-tested.
