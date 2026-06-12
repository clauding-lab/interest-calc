# InCalc BD iOS — Plan 4a: Deposit tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **All work happens in `~/Projects/incalc-ios` on a new branch `feat/plan4a-deposit`** (branch off `main`, which already has Plan 3 merged @ `c453606`). Commit per task; push + open PR only at the end.

**Goal:** The **Deposit tab**, fully working end-to-end — preset selector (FD/DPS/WDS/MBS/Custom) driving input show/hide, ED + source-tax toggles, PSR picker, 8 metric cards, a 3-series Swift Charts growth chart, the year-by-year table, and the plain-language summary (Bengali heading + English body) — wired onto the already-golden `InCalcEngine.Deposit`.

**Architecture:** Same MVVM-lite as Loan. A `@Observable` `DepositViewModel` (injected `UserDefaults`) holds inputs, applies preset defaults on preset change, exposes computed show/hide flags + formatted results from `Deposit.project(_:)`; `DepositView` renders, composing the existing design system plus three new reusable controls. Engine-only math dependency. Verified by `DepositViewModelTests` (wiring + preset logic + parity) and a simulator run.

**Tech Stack:** Swift 6.3 / Xcode 26.5, SwiftUI (iOS 17), Swift Charts (AreaMark + LineMark), `@Observable`, XcodeGen, `xcodebuild`/`xcrun simctl` on the iPhone 17 / iOS 26.5 sim. No new dependencies.

**Spec:** master `docs/superpowers/specs/2026-06-12-incalc-ios-design.md` §4 (Deposit). Web parity source: `~/Projects/InCalc/index.html` — `calcDeposit` (~1280–1668), `setPreset` (~1283), config/formatters (~1140–1229).

**Decisions (inherited from Plan 3 + Deposit-specific, baked in — flag on PR if you disagree):**
1. **Web-faithful inputs:** sliders for amounts/rate, the **`Chip` component for tenure on FD/WDS** (fractional 3m/6m/…), a years slider for Custom/DPS/MBS. Native fonts (SF Mono figures / New York titles / SF Pro body), `@Observable`+UserDefaults persistence, reuse `DesignSystem/`.
2. **Preset = a segmented-style selector** (5 presets). Built as a new reusable `PresetSelector` (horizontal `Chip` row — `.segmented` Picker truncates "Custom" on iPhone width).
3. **Bangla = heading only** (`আপনার জন্য এর মানে কী`) + the 3 English summary lines, 1:1 with web. Do NOT invent Bengali bodies.
4. **Yearly table only** (the engine exposes `[YearRow]`, not weekly rows). The web's weekly-view toggle is dropped.

**Parity landmines (wrong numbers = worst defect):**
- **Source tax is deducted DURING compounding** (on each interest credit, reducing the compounding base); **ED is deducted ONCE at year-end** on the net balance. The engine already does this — the ViewModel must NOT re-apply or reorder.
- **MBS is a separate path** (simple interest, principal flat) and its "Effective annual yield" card shows the **nominal rate**, not the compound EAY. The engine returns `effectiveAnnualYieldPct = rate` for MBS — display it as-is.
- **Preset switch hard-resets inputs to that preset's defaults** (web `setPreset`). Persist within a preset; reset on preset change.
- **EAY** = `(1+rate/100/n)^n − 1` (compound) — the engine computes it; never derive a different yield for the EAY card.
- All numbers come from `InCalcEngine.Deposit`; the view re-derives nothing.

---

## File structure (new, under `~/Projects/incalc-ios`)
```
DesignSystem/
  LabeledToggle.swift        # label-left + Toggle-right (ED / source-tax)        [Task 1]
  LabeledPicker.swift        # label-left + Menu-right (PSR / compounding / freq)  [Task 1]
  PresetSelector.swift       # horizontal Chip row for mutually-exclusive presets  [Task 1]
Features/Deposit/
  DepositViewModel.swift     # @Observable inputs → Deposit.project → results       [Task 2]
  DepositView.swift          # the screen (+ growth chart + table + summary)        [Task 3]
Tests/AppTests/
  DepositViewModelTests.swift                                                       [Task 2]
App/RootTabView.swift        # Deposit placeholder → DepositView()                  [Task 3]
```

**Engine API (verified — `Sources/InCalcEngine/Deposit.swift`):**
```swift
Deposit.Preset: enum { fd, dps, wds, mbs, custom }
Deposit.ContributionFrequency: enum { monthly, weekly }
Deposit.Input(preset:, principal:Double, contribution:Double, weeklyAmount:Double,
              contributionFrequency:, annualRatePct:Double, compoundingPerYear:Int,
              years:Double, exciseDutyOn:Bool, sourceTaxOn:Bool, hasReturnProof:Bool)
Deposit.project(_ c: Input) -> Result
//   Result(futureGross, totalGrossInterest, totalInvested, totalED, totalTax,
//          netReceivable, effectiveAnnualYieldPct, rows:[YearRow], monthlyPayout)
//   YearRow(year, openNet, contribution, grossInterest, netInterest, exciseDuty, tax, grossClose, netClose)
Money.fmt(_:) -> String     // ৳ lakh/crore grouped, rounded
```

**Preset contract (defaults + visibility — from the web `setPreset`):**
| Preset | principal | contribution | weekly | compounding(n) | contribFreq | rate | years | visible inputs |
|---|---|---|---|---|---|---|---|---|
| **custom** (default) | 100000 | 5000 | — | 12 | monthly | 8.5 | 15 | principal, contribution, contribFreq, compounding, rate, years-slider |
| **fd** | 100000 | 0 (hidden) | — | 4 | monthly | 9.5 | 1.0 | principal, rate, **tenure-chips [0.25,0.5,1,2,3]** |
| **dps** | 0 (hidden) | 5000 (label "Monthly instalment") | — | 12 | monthly | 11 | 5 | contribution, rate, years-slider |
| **wds** | 0 (hidden) | — | 500 | 12 | weekly | 10.5 | 1.0 | weekly, rate, **tenure-chips [0.25,0.5,0.75,1]**; +Annual-deposit metric |
| **mbs** | 500000 | 0 (hidden) | — | 12 | monthly | 10 | 3 | principal, rate, years-slider; +Monthly-payout metric |

Input ranges (sliders): principal 10,000–5,000,000 step 10,000; contribution 0–200,000 step 1,000; weekly 100–50,000 step 100; rate 1–20 step 0.25; years 1–40 step 1. ED toggle + source-tax toggle default ON. PSR default = return-filed (10%).

---

### Task 1: Design-system controls — LabeledToggle, LabeledPicker, PresetSelector

**Files:** Create `DesignSystem/LabeledToggle.swift`, `LabeledPicker.swift`, `PresetSelector.swift`. These are reused by DSCR/Compare/Settlement too. Each gets a `#Preview`. (Standard model.)

- [ ] **Step 1: `LabeledToggle.swift`**
```swift
import SwiftUI

/// A label-left, Toggle-right row matching LabeledSlider's visual language. Used for ED / source-tax.
struct LabeledToggle: View {
    let label: String
    @Binding var isOn: Bool
    var body: some View {
        Toggle(isOn: $isOn) {
            Text(label).font(Theme.Fonts.sans(13)).foregroundStyle(Theme.Colors.muted)
        }
        .tint(Theme.Colors.accent)
    }
}

#Preview {
    @Previewable @State var on = true
    LabeledToggle(label: "Excise duty (ED)", isOn: $on).padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 2: `LabeledPicker.swift`** (generic over a `Hashable` option)
```swift
import SwiftUI

/// A label-left, Menu-right picker matching the input language. Used for PSR, compounding, contribution-frequency.
struct LabeledPicker<Option: Hashable>: View {
    let label: String
    @Binding var selection: Option
    let options: [(value: Option, title: String)]
    var body: some View {
        HStack {
            Text(label).font(Theme.Fonts.sans(13)).foregroundStyle(Theme.Colors.muted)
            Spacer()
            Picker("", selection: $selection) {
                ForEach(options, id: \.value) { Text($0.title).tag($0.value) }
            }
            .pickerStyle(.menu).labelsHidden().tint(Theme.Colors.accent)
        }
    }
}

#Preview {
    @Previewable @State var sel = 12
    LabeledPicker(label: "Compounding", selection: $sel,
                  options: [(12, "Monthly"), (4, "Quarterly"), (2, "Semi-annually"), (1, "Annually")])
        .padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 3: `PresetSelector.swift`** (horizontal `Chip` row; reuses the existing `Chip`)
```swift
import SwiftUI

/// Mutually-exclusive preset picker as a horizontal Chip row. Generic over a Hashable preset value.
struct PresetSelector<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.sm) {
                ForEach(options, id: \.value) { opt in
                    Chip(title: opt.title, isSelected: selection == opt.value) { selection = opt.value }
                }
            }
        }
    }
}

#Preview {
    @Previewable @State var p = "custom"
    PresetSelector(selection: $p, options: [("fd","FD"),("dps","DPS"),("wds","WDS"),("mbs","MBS"),("custom","Custom")])
        .padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 4: Build + commit**
```bash
cd ~/Projects/incalc-ios && xcodegen generate >/dev/null
xcodebuild build -project InCalcBD.xcodeproj -scheme InCalcBD -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -3
git add DesignSystem && git commit -m "feat(ios): design-system controls — LabeledToggle, LabeledPicker, PresetSelector"
```
(Reminder: app sources compile ONLY via the XcodeGen project — SourceKit "cannot find Theme" errors are false positives; `xcodebuild` is authoritative.)

---

### Task 2: `DepositViewModel` + tests (preset state machine + engine wiring — parity-critical)

**Files:** Create `Features/Deposit/DepositViewModel.swift`, `Tests/AppTests/DepositViewModelTests.swift`. **Most capable model.** TDD.

- [ ] **Step 1: Failing tests**
```swift
import XCTest
import InCalcEngine
@testable import InCalcBD

@MainActor
final class DepositViewModelTests: XCTestCase {
    private func vm(_ s: String = #function) -> DepositViewModel {
        let d = UserDefaults(suiteName: s)!; d.removePersistentDomain(forName: s)
        return DepositViewModel(defaults: d)
    }
    private func project(_ m: DepositViewModel) -> Deposit.Result { Deposit.project(m.engineInput) }

    // Default = Custom; outputs match the engine fed the VM's own input.
    func test_customDefaults_matchEngine() {
        let m = vm()
        XCTAssertEqual(m.preset, .custom)
        let r = project(m)
        XCTAssertEqual(m.netReceivableText, Money.fmt(r.netReceivable))
        XCTAssertEqual(m.futureGrossText, Money.fmt(r.futureGross))
        XCTAssertEqual(m.eayText, String(format: "%.3f%%", r.effectiveAnnualYieldPct))
    }

    // Switching preset applies that preset's defaults + visibility.
    func test_presetSwitch_appliesDefaultsAndVisibility() {
        let m = vm()
        m.preset = .fd
        XCTAssertEqual(m.principal, 100_000); XCTAssertEqual(m.annualRatePct, 9.5)
        XCTAssertEqual(m.compoundingPerYear, 4); XCTAssertEqual(m.contribution, 0)
        XCTAssertTrue(m.showsPrincipal); XCTAssertFalse(m.showsContribution)
        XCTAssertTrue(m.showsTenureChips); XCTAssertFalse(m.showsYearsSlider)
        XCTAssertFalse(m.showsCompounding)

        m.preset = .dps
        XCTAssertEqual(m.contribution, 5_000); XCTAssertEqual(m.annualRatePct, 11)
        XCTAssertFalse(m.showsPrincipal); XCTAssertTrue(m.showsContribution)
        XCTAssertEqual(m.contributionLabel, "Monthly instalment")

        m.preset = .wds
        XCTAssertEqual(m.weeklyAmount, 500); XCTAssertTrue(m.showsWeekly)
        XCTAssertTrue(m.showsAnnualDeposit); XCTAssertEqual(m.annualDepositText, Money.fmt(500 * 52))
    }

    // MBS: separate path — EAY shows the NOMINAL rate, monthly payout shown.
    func test_mbs_nominalEAYAndPayout() {
        let m = vm(); m.preset = .mbs
        let r = project(m)
        XCTAssertEqual(r.monthlyPayout, (500_000 * 10 / 100) / 12, accuracy: 1e-9)
        XCTAssertEqual(m.eayText, String(format: "%.3f%%", 10.0))   // nominal, not compound
        XCTAssertTrue(m.showsMonthlyPayout)
        XCTAssertEqual(m.monthlyPayoutText, Money.fmt(r.monthlyPayout))
    }

    // PSR gates the tax rate (10% filed / 15% no-proof) and the sub-label.
    func test_psrGatesTaxRate() {
        let m = vm()
        m.hasReturnProof = true;  let filed = project(m).totalTax
        m.hasReturnProof = false; let noProof = project(m).totalTax
        XCTAssertGreaterThan(noProof, filed)
        XCTAssertEqual(m.taxSubLabel, "15% on interest")
    }

    // ED / source-tax toggles zero out their deductions.
    func test_togglesOff() {
        let m = vm(); m.exciseDutyOn = false; m.sourceTaxOn = false
        let r = project(m)
        XCTAssertEqual(r.totalED, 0); XCTAssertEqual(r.totalTax, 0)
    }

    func test_persistsPresetAndInputs() {
        let s = #function; let d = UserDefaults(suiteName: s)!; d.removePersistentDomain(forName: s)
        let a = DepositViewModel(defaults: d); a.preset = .mbs; a.principal = 700_000
        let b = DepositViewModel(defaults: d)
        XCTAssertEqual(b.preset, .mbs); XCTAssertEqual(b.principal, 700_000)
    }
}
```

- [ ] **Step 2: Run — FAIL** (`xcodebuild test ... -only-testing:AppTests/DepositViewModelTests`).

- [ ] **Step 3: Implement `DepositViewModel`** — `@Observable`, injected UserDefaults, preset-default application in `preset.didSet`, computed visibility + engine input + formatted outputs. Public surface (keep stable for Task 3):
  - Inputs (persisted): `preset: Deposit.Preset`, `principal/contribution/weeklyAmount/annualRatePct: Double`, `compoundingPerYear: Int`, `contributionFrequency: Deposit.ContributionFrequency`, `years: Double`, `exciseDutyOn/sourceTaxOn/hasReturnProof: Bool`.
  - Ranges: `principalRange/contributionRange/weeklyRange/rateRange: ClosedRange<Double>`, `yearsRange: ClosedRange<Int>`.
  - Visibility (computed): `showsPrincipal/showsContribution/showsWeekly/showsContribFreq/showsCompounding/showsYearsSlider/showsTenureChips/showsMonthlyPayout/showsAnnualDeposit: Bool`; `tenureChips: [(value: Double, title: String)]`; `contributionLabel: String`.
  - `engineInput: Deposit.Input` (builds the Input from current state — used by tests + internally).
  - Results (formatted): `futureGrossText/totalInterestText/totalInvestedText/totalEDText/totalTaxText/netReceivableText/monthlyPayoutText/annualDepositText: String`, `eayText: String`, `taxSubLabel: String`.
  - Breakdown: `principalPct/interestPct: Int`; `grossReturnText/netReturnText/yieldLossText: String` (the GVN row, `%.2f%%`).
  - `chartPoints: [DepositPoint]` (`year:Int, net/gross/invested: Double`, Identifiable) and `tableRows: [Deposit.YearRow]` + `tableColumns: [String]` (compound vs MBS header set).
  - `summaryHeading: String` (= "What this means for you · আপনার জন্য এর মানে কী") and `summaryLines: [String]` (the 3 English templates; compound vs MBS variant from the recon).

  Use the verified preset-default application:
```swift
private func applyPresetDefaults(_ p: Deposit.Preset) {
    switch p {
    case .custom: principal = 100_000; contribution = 5_000; compoundingPerYear = 12
                  contributionFrequency = .monthly; annualRatePct = 8.5; years = 15
    case .fd:     principal = 100_000; contribution = 0; compoundingPerYear = 4
                  contributionFrequency = .monthly; annualRatePct = 9.5; years = 1
    case .dps:    principal = 0; contribution = 5_000; compoundingPerYear = 12
                  contributionFrequency = .monthly; annualRatePct = 11; years = 5
    case .wds:    principal = 0; weeklyAmount = 500; compoundingPerYear = 12
                  contributionFrequency = .weekly; annualRatePct = 10.5; years = 1
    case .mbs:    principal = 500_000; contribution = 0; compoundingPerYear = 12
                  contributionFrequency = .monthly; annualRatePct = 10; years = 3
    }
}
```
  Call `applyPresetDefaults` in `preset.didSet` (NOT in init — init restores persisted values). Visibility per the contract table. `engineInput` maps directly to `Deposit.Input`. `taxSubLabel = "\(Int((hasReturnProof ? 10 : 15)))% on interest"`. `annualDepositText = Money.fmt(weeklyAmount * 52)`. EAY/payout/etc. read `Deposit.project(engineInput)` (memoize it: recompute the `Result` in any input `didSet`, like the Loan VM memoized its schedule). Summary lines per the recon templates (compound: depositing-amount / after-ED-tax-net / net-yield; MBS variant). `chartPoints` from `result.rows` — net=`netClose`, gross=`grossClose`, invested = running `principal + Σ contribution` (start at `principal`, add each row's `contribution`).

- [ ] **Step 4: Run — PASS.** If a number differs, the VM wiring is wrong (engine is golden) — fix the VM, never the engine.

- [ ] **Step 5: Commit**
```bash
git add Features/Deposit/DepositViewModel.swift Tests/AppTests/DepositViewModelTests.swift
git commit -m "feat(ios): DepositViewModel — preset state machine + engine wiring + tests"
```

---

### Task 3: `DepositView` + growth chart + table + summary + tab wire-in

**Files:** Create `Features/Deposit/DepositView.swift`; Modify `App/RootTabView.swift` (Deposit tab → `DepositView()`, keep the `chart.line.uptrend.xyaxis` `.tabItem`). **Most capable model.**

Compose: `PresetSelector` (presets) → a `SurfaceCard` of inputs gated by the VM's `shows*` flags (principal/contribution/weekly `LabeledSlider`s; `contributionFrequency` + `compoundingPerYear` `LabeledPicker`s when shown; rate `LabeledSlider`; years `LabeledSlider` when `showsYearsSlider` else a `PresetSelector`/`Chip` row over `tenureChips`; ED + source-tax `LabeledToggle`s; PSR `LabeledPicker`) → metric cards grid (Future value, Interest earned, Total invested, EAY, Total ED [warn], Source tax [warn]; conditional Monthly-payout / Annual-deposit cards; a full-width **Net receivable** card, accent2) → breakdown bar + GVN row (gross/net/yield-loss) → the 3-series growth chart → the year table → the summary (heading + 3 lines).

- [ ] **Step 1: Growth chart** — a Swift Charts view over `vm.chartPoints`: Net (`AreaMark` filled, accent), Gross (`LineMark` dashed, accent), Invested (`LineMark` dashed, dim). Style via `ChartStyle`/`Theme`. Mirror the Loan chart's structure (BarMark→here AreaMark/LineMark), legend bottom, `Money`-aware Y axis. Height `ChartStyle.height`.

- [ ] **Step 2: Implement `DepositView`** composing the above (follow the LoanView structure: `NavigationStack { ScrollView { VStack { … } } }`, `@State private var vm = DepositViewModel()`, a scoped `@Bindable var vm = vm` for the bound controls). Every number/string comes from `vm`. The table headers come from `vm.tableColumns`; rows from `vm.tableRows` (render Year/Opening/Contrib/Interest/ED/Tax/NetClose for compound; the MBS header set when `vm.preset == .mbs`). The summary: `Text(vm.summaryHeading)` in `serifItalic` + the 3 `vm.summaryLines`.

- [ ] **Step 3: Wire the tab** — in `RootTabView.swift` replace the Deposit `PlaceholderTab` with `DepositView()`, KEEP `.tabItem { Label("Deposit", systemImage: "chart.line.uptrend.xyaxis") }`. Leave the other three placeholders (DSCR/Compare/Settlement) unchanged.

- [ ] **Step 4: Build + full test suite**
```bash
xcodegen generate >/dev/null
xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -6
```
Expect BUILD + TEST SUCCEEDED (DepositViewModelTests + LoanViewModelTests all green). Fix SwiftUI compile issues minimally (the `@Bindable` pattern, Chart API, `LabeledPicker` generic inference) without changing the VM API or any number.

- [ ] **Step 5: Light/dark screenshots** — boot iPhone 17 sim, install, launch, switch to the Deposit tab, capture `/tmp/deposit-light.png` + `/tmp/deposit-dark.png` (same simctl flow as Plan 3 Task 4). Read the PNGs; confirm the preset row, inputs, metric cards (sensible Custom-default figures), chart, table, and summary render in both themes; switch a preset (e.g. tap MBS) and confirm the inputs/metrics reshape. Report what you see.

- [ ] **Step 6: Commit**
```bash
git add Features/Deposit/DepositView.swift App/RootTabView.swift
git commit -m "feat(ios): Deposit tab — presets, toggles, growth chart, table, summary"
```

---

### Task 4: Polish, governance, gate, PR

**Files:** Modify `AGENTS.md` (note the new DesignSystem controls + that Deposit reuses them), `AGENT_LEARNINGS.md` (any incident), `README.md` if needed. (Standard model.)

- [ ] **Step 1:** Confirm the remaining placeholders (DSCR/Compare/Settlement) still render + navigate; Deposit + Loan both work.
- [ ] **Step 2:** `AGENTS.md` — add `LabeledToggle`/`LabeledPicker`/`PresetSelector` to the design-system inventory; reinforce the design-drift landmine (Compare/DSCR/Settlement reuse these). Note the Deposit preset-default-on-switch pattern.
- [ ] **Step 3:** `AGENT_LEARNINGS.md` — append any incident caught this plan (Trigger/What went wrong/Lesson/Prevention/Hotfix). If clean, one-line note.
- [ ] **Step 4: Full gate**
```bash
xcodegen generate >/dev/null
xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -4
swift test 2>&1 | tail -3
```
Expect app tests green; `swift test` still all green (engine/import untouched).
- [ ] **Step 5:** Commit docs (`docs(ios): design-system controls + Deposit notes`).
- [ ] **Step 6 (controller, after final review):** push + open PR:
```bash
git push -u origin feat/plan4a-deposit
gh pr create --title "Plan 4a: Deposit tab (InCalc BD)" --body "<summary of presets/toggles/chart/table/summary; verification: app tests + swift test green; light/dark screenshots; decisions: chips for FD/WDS tenure, Bangla heading only, yearly table only>"
```

---

## Self-review (writing-plans checklist)
- **Spec coverage (§4 Deposit):** presets + show/hide (Task 2 VM + Task 3 view), ED/tax toggles + PSR (Tasks 1–3), metric cards incl. conditional payout/annual-deposit + net receivable (Task 3), 3-series growth chart (Task 3 Step 1), year table (Task 3), bilingual summary heading + English lines (Task 2 `summaryHeading`/`summaryLines` → Task 3). MBS separate-path + nominal-EAY, WDS weekly + annual-deposit metric, FD/WDS tenure chips — all in the preset contract + tests. Dropped (noted): weekly table view (no engine weekly rows).
- **Type consistency:** `DepositViewModel` public surface used by tests (`engineInput`, `netReceivableText`, `eayText`, `shows*`, `contributionLabel`, `annualDepositText`, `taxSubLabel`, `monthlyPayoutText`) == surface consumed by `DepositView`. Engine calls use the exact `Deposit.Input(...)`/`Deposit.project(_:)` signature from the source. New controls `LabeledToggle`/`LabeledPicker`/`PresetSelector` consumed by `DepositView` with the signatures defined in Task 1.
- **No placeholders:** the parity-critical VM + tests + new controls carry full code; the view is a structured composition brief over the established LoanView pattern + the new controls (the implementer composes, then verifies on the simulator).

## Open items to confirm while executing
- **Preset selector width** on iPhone — the `PresetSelector` Chip row is horizontally scrollable; confirm all 5 presets are reachable + the selected chip is obvious.
- **Memoize `Deposit.project`** in the VM (recompute on input `didSet`) like the Loan VM, so the 8 cards + chart + table + summary don't each re-run the projection.
- **MBS table headers** differ (Principal/Payout/ED/Tax/Net Value) from the compound set (Opening/Contrib/Interest/ED/Tax/Net Close) — `tableColumns` must switch on `preset == .mbs`.
