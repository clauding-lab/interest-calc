# InCalc BD iOS — Plan 4c: Compare tab

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. **Work in `~/Projects/incalc-ios` on `feat/plan4c-compare`** (off `main` @ `b7a1cb2`, Plans 3+4a+4b merged). Commit per task; push + PR at the end.

**Goal:** The **Compare tab** — two scenario cards (each Deposit or Loan: amount/rate/years sliders), per-scenario metric cards, a numeric winner badge (with the Mixed-mode no-winner case), and a dual-line projection chart — on `InCalcEngine.Compare`. The lightest tab; it composes the shared engine.

**Architecture:** MVVM-lite. `@Observable` `CompareViewModel` (injected UserDefaults) holds the two scenarios' inputs, calls `Compare.scenario(...)` for each (memoized), exposes formatted per-scenario metrics + the winner badge + chart points. `CompareView` renders two cards + the chart, reusing the design system.

**Spec:** master §4 (Compare). Web parity: `~/Projects/InCalc/index.html` `calcCompare`/`scenarioCalc` (~1821–1894).

**Parity landmines (wrong numbers = worst defect):**
- **Three winner cases:** deposit-vs-deposit → higher `finalValue` wins; loan-vs-loan → **lower** `totalInterest` wins; **mixed (one deposit, one loan) → "Mixed comparison", NO winner** (do not pick A/B). Badge text: deposit "A/B yields more", loan "A/B costs less", mixed "Mixed comparison".
- **Tie → B** (strict `>`/`<`; the engine's `Compare.winner` already does this — do NOT change `<` to `<=`).
- Compare uses its OWN simplified `scenarioCalc` (the engine's `Compare.scenario`) — NOT the Deposit (tax/excise) or Loan (effective-rate) engines. Numbers differ from those tabs by design.
- Chart Y-series differ by type (deposit = rising balance, loan = falling principal); the shorter series stops at its own final year (nil-pad, no span).

---

## File structure
```
Features/Compare/CompareViewModel.swift   [Task 1]
Features/Compare/CompareView.swift        [Task 2]
Tests/AppTests/CompareViewModelTests.swift [Task 1]
App/RootTabView.swift                     [Task 2: Compare placeholder → CompareView()]
```

**Engine API (verified — `Sources/InCalcEngine/Compare.swift`):**
```swift
Compare.ScenarioType { deposit, loan }
Compare.scenario(type:, amount:Double, ratePct:Double, years:Int) -> Compare.Scenario
//   Scenario(type, yearEndValues:[Double], finalValue:Double, totalInterest:Double?, emi:Double?)
Compare.winner(a:Scenario, b:Scenario) -> String   // "A"|"B" (loan-loan: lower totalInterest; else: higher finalValue; tie→B). Caller handles Mixed.
Money.fmt(_:) -> String
```

**Input contract:** per scenario — type (Deposit/Loan picker), amount (50_000…10_000_000 step 50_000), rate (1…25 step 0.25), years (1…30 step 1). Defaults: both type deposit, both amount 500_000, both years 10; **rate A=8, B=12**.

**Per-scenario metrics:**
- deposit: Final value `fmt(finalValue)`, Interest earned `fmt(finalValue−amount)`, Total invested `fmt(amount)`, Eff. annual yield `"%.3f%%"` of `((1+rate/100/12)^12−1)*100`.
- loan: Monthly EMI `fmt(emi!)`, Total interest `fmt(totalInterest!)`, Total paid `fmt(emi!*years*12)`, Interest ratio `"%.1f%%"` of `totalInterest!/amount*100`.

---

### Task 1: `CompareViewModel` + tests

**Files:** Create `Features/Compare/CompareViewModel.swift`, `Tests/AppTests/CompareViewModelTests.swift`. **Standard model.** TDD.

**Public surface:**
- Scenario A (persisted): `aType: Compare.ScenarioType`, `aAmount: Double`, `aRate: Double`, `aYears: Int`. Scenario B: `bType/bAmount/bRate/bYears`.
- Ranges: `amountRange: 50_000...10_000_000`, `rateRange: 1...25` (Double); `yearsRange: 1...30` (Int).
- Memoized `aScenario`/`bScenario: Compare.Scenario` (recompute on input `didSet`).
- `isMixed: Bool` = `aType != bType`.
- `winner: String?` = `isMixed ? nil : Compare.winner(a: aScenario, b: bScenario)`.
- `winnerIsA: Bool` = `winner == "A"`.
- `winnerBadgeText: String` = isMixed ? "Mixed comparison" : (aType == .deposit ? "\(winner!) yields more" : "\(winner!) costs less").
- `aMetrics`/`bMetrics: [(label: String, value: String)]` — per the metrics table above, switched on the scenario's type.
- `amountLabel(for: Compare.ScenarioType) -> String` = type == .deposit ? "Deposit amount" : "Loan amount".
- Chart: `struct ComparePoint: Identifiable { let id = UUID(); let year: Int; let aValue: Double?; let bValue: Double? }`; `chartPoints: [ComparePoint]` over `1...max(aYears, bYears)`: aValue = year <= aYears ? aScenario.yearEndValues[year-1] : nil; bValue likewise.

- [ ] **Step 1: Failing tests** `Tests/AppTests/CompareViewModelTests.swift`:
```swift
import XCTest
import InCalcEngine
@testable import InCalcBD

@MainActor
final class CompareViewModelTests: XCTestCase {
    private func vm(_ s: String = #function) -> CompareViewModel {
        let d = UserDefaults(suiteName: s)!; d.removePersistentDomain(forName: s); return CompareViewModel(defaults: d)
    }
    // Default: deposit 8% vs deposit 12% → B yields more.
    func test_defaultWinnerIsB() {
        let m = vm()
        XCTAssertFalse(m.isMixed)
        XCTAssertEqual(m.winner, "B")
        XCTAssertEqual(m.winnerBadgeText, "B yields more")
        XCTAssertEqual(m.aMetrics.first?.value, Money.fmt(Compare.scenario(type: .deposit, amount: 500_000, ratePct: 8, years: 10).finalValue))
    }
    // Loan vs loan → lower total interest wins; badge "costs less".
    func test_loanLoanWinner() {
        let m = vm(); m.aType = .loan; m.bType = .loan; m.aRate = 9; m.bRate = 15
        let a = Compare.scenario(type: .loan, amount: m.aAmount, ratePct: 9, years: m.aYears)
        let b = Compare.scenario(type: .loan, amount: m.bAmount, ratePct: 15, years: m.bYears)
        XCTAssertEqual(m.winner, a.totalInterest! < b.totalInterest! ? "A" : "B")
        XCTAssertTrue(m.winnerBadgeText.contains("costs less"))
    }
    // Mixed → no winner.
    func test_mixed() {
        let m = vm(); m.aType = .deposit; m.bType = .loan
        XCTAssertTrue(m.isMixed); XCTAssertNil(m.winner)
        XCTAssertEqual(m.winnerBadgeText, "Mixed comparison")
    }
    // Tie → B.
    func test_tieResolvesToB() {
        let m = vm(); m.aRate = 10; m.bRate = 10   // identical deposit scenarios
        XCTAssertEqual(m.winner, "B")
    }
    // Chart pads the shorter series with nil.
    func test_chartPadding() {
        let m = vm(); m.aYears = 5; m.bYears = 10
        XCTAssertEqual(m.chartPoints.count, 10)
        XCTAssertNil(m.chartPoints.last?.aValue)        // A only goes to year 5
        XCTAssertNotNil(m.chartPoints.last?.bValue)
    }
    func test_persists() {
        let s = #function; let d = UserDefaults(suiteName: s)!; d.removePersistentDomain(forName: s)
        let a = CompareViewModel(defaults: d); a.aType = .loan; a.bRate = 20
        let b = CompareViewModel(defaults: d)
        XCTAssertEqual(b.aType, .loan); XCTAssertEqual(b.bRate, 20)
    }
}
```
- [ ] **Step 2: Run — FAIL** (`xcodebuild test ... -only-testing:AppTests/CompareViewModelTests`).
- [ ] **Step 3: Implement** the VM per the surface. `@MainActor @Observable`, `import Foundation`/`Observation`/`InCalcEngine` (NO SwiftUI — winner colour is the View's job via `winnerIsA`). Scalars + enum types persist (enum via a stored "deposit"/"loan" string). Memoize `aScenario`/`bScenario` via `recompute()` in every input `didSet`. EAY for deposit metrics uses `((1 + rate/100/12) `pow` 12) - 1) * 100`.
- [ ] **Step 4: Run — PASS.** Fix the VM if a number's off (engine is golden).
- [ ] **Step 5: Commit** — `git add Features/Compare Tests/AppTests/CompareViewModelTests.swift && git commit -m "feat(ios): CompareViewModel — two scenarios, numeric winner, mixed-mode, chart + tests"`

---

### Task 2: `CompareView` + tab + governance + gate + PR

**Files:** Create `Features/Compare/CompareView.swift`; Modify `App/RootTabView.swift`, `AGENTS.md`. **Standard model.**

- [ ] **Step 1: `CompareView`** (follow LoanView/DepositView structure; `@State` VM + scoped `@Bindable`). Compose:
  - A **winner badge** at top: `Text(vm.winnerBadgeText)` in a pill, tinted `vm.isMixed ? Theme.Colors.muted : (vm.winnerIsA ? Theme.Colors.accent : Theme.Colors.accent2)`, white-on-accent.
  - **Two scenario `SurfaceCard`s** (A then B), each: a `LabeledPicker("Scenario type", binding, [(.deposit,"Deposit"),(.loan,"Loan")])`; `LabeledSlider(vm.amountLabel(for: type), $amount, vm.amountRange, step 50_000, Money.fmt)`; `LabeledSlider("Annual rate", $rate, vm.rateRange, step 0.25, "%.2f%%")`; `LabeledSlider("Years", Int↔Double binding, 1...30, step 1, "\(Int)y")`. Tint card A accent, card B accent2 (e.g. the picker/slider tint or a small coloured `scenarioDot`).
  - **Two result `MetricCard` grids** (or stacked rows) from `vm.aMetrics`/`vm.bMetrics` (each `(label,value)`).
  - A **dual-line chart** `SurfaceCard`: `Chart { ForEach(vm.chartPoints) { p in if let a = p.aValue { LineMark(x:.value("Yr",p.year), y:.value("A",a), series:.value("S","A")).foregroundStyle(Theme.Colors.accent).interpolationMethod(.catmullRom) } ; if let b = p.bValue { LineMark(... series "B" ...).foregroundStyle(Theme.Colors.accent2) } } }` + AreaMark fills optional; a manual 2-dot legend (A=accent, B=accent2); `accessibilityLabel`.
- [ ] **Step 2: Wire** `RootTabView` Compare tab → `CompareView()`, keep `.tabItem { Label("Compare", systemImage: "arrow.left.arrow.right") }`; leave Settlement placeholder.
- [ ] **Step 3: Build + full test suite** (`xcodebuild test` — Compare + DSCR + Deposit + Loan green). Fix SwiftUI compile issues minimally (the enum `LabeledPicker`, Int↔Double years binding, the conditional LineMarks) without changing the VM API or any number.
- [ ] **Step 4: Light/dark screenshots** — drive to the Compare tab (4th tab; temporary uncommitted selection, capture `/tmp/compare-light.png` + `/tmp/compare-dark.png`, revert + verify clean). Confirm both scenario cards, the winner badge ("B yields more" at defaults), the metrics, and the dual-line chart render in both themes. Sanity-check the winner vs the engine. Report what you see.
- [ ] **Step 5: AGENTS.md** — add `Features/Compare/` + note Compare uses the simplified `Compare.scenario` (NOT the Deposit/Loan tab engines) + the 3-case winner (mixed = no winner, tie→B). Update tab counts (1 placeholder left: Settlement).
- [ ] **Step 6: Full gate** — `xcodebuild test` (all app) + `swift test` (26 green, untouched).
- [ ] **Step 7: Commit** — `git add Features/Compare/CompareView.swift App/RootTabView.swift AGENTS.md && git commit -m "feat(ios): Compare tab — two scenarios, winner badge, dual-line chart"`
- [ ] **Step 8 (controller, after final review):** push + PR (`Plan 4c: Compare tab`).

---

## Self-review
- **Spec coverage (§4 Compare):** two scenario cards with type pickers + sliders (Task 2), per-scenario metrics (Task 1 `aMetrics`/`bMetrics` → Task 2), numeric winner incl. **mixed = no winner** + tie→B (Task 1 `winner`/`winnerBadgeText`, tested), dual-line chart with shorter-series-stops (Task 1 `chartPoints` nil-pad + Task 2 conditional LineMarks). Decision: Compare uses `Compare.scenario`, not the other tabs' engines (landmine).
- **Type consistency:** VM surface used by tests == consumed by the View (`isMixed`, `winner`, `winnerBadgeText`, `winnerIsA`, `aMetrics`/`bMetrics`, `chartPoints`, `amountLabel`). Engine calls use `Compare.scenario(type:amount:ratePct:years:)` / `Compare.winner(a:b:)`.
