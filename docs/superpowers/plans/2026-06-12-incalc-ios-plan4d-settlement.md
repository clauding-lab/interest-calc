# InCalc BD iOS — Plan 4d: Settlement IRR tab (the last tab)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. **Work in `~/Projects/incalc-ios` on `feat/plan4d-settlement`** (off `main` @ `df30a90`, Plans 3+4a-c merged). Commit per task; push + PR at the end.

**Goal:** The **Settlement IRR tab** — a THREE-screen flow (1. import .xlsx / start blank, 2. edit, 3. results) that imports a settlement workbook (or starts blank), lets the banker edit client info + receivables/waivers + the payment schedule, and computes the settlement **XIRR** + collection metrics + a waiver breakdown — wiring the Plan-2 `InCalcExcelImport` (`SettlementSheetParser` + `SettlementCalculator`) on-device via `.fileImporter`.

**Architecture:** A `@Observable` `SettlementViewModel` holds the screen state + editable model (client/loan/dates, receivable rows, payment rows), populated by `startBlank()` or `loadFromImport(_:)`; `compute()` runs `SettlementCalculator.compute(...)` and advances to results. `SettlementView` drives the three screens; the import screen's `.fileImporter` opens the picked `.xlsx` (security-scoped) → `XLSXSheet(path:)` → `SettlementSheetParser.parse` → `vm.loadFromImport`. Math is the golden-tested engine; the VM does only the trivial summary arithmetic + the waiver clamp.

**Tech Stack:** Swift 6.3 / Xcode 26.5, SwiftUI (iOS 17), `.fileImporter` + `UTType` + security-scoped resource, CoreXLSX (vendored, via `InCalcExcelImport`), Swift Charts, `@Observable`, XcodeGen.

**Spec:** master §4 (Settlement) + §5 (Excel import). Web parity: `~/Projects/InCalc/index.html` `calcSettlement`/`parseSettlementSheet`/`settleShowScreen`/`renderSettleRecv`/`settleUpdateTotals` (~2196–2702).

**Decisions (baked in — flag on PR if you disagree):**
- BDT-only (Money.fmt everywhere — the app is BDT-only).
- **Restrict the file picker to `.xlsx`** (`UTType` for `org.openxmlformats.spreadsheetml.sheet`); a `.xls` pick shows "Please re-save as .xlsx" (master spec; the web has no such guard — this is a deliberate iOS addition).
- **Bundle a synthetic sample workbook** in the app (copy the Plan-2 synthetic `clean.xlsx` fixture) and offer it via `ShareLink` on the import screen (the web "downloads" a sample). NEVER derive a sample from a real file (project landmine #1).
- Editable model state is NOT persisted (a settlement is a per-case scratchpad; the web doesn't persist it either).

**Parity landmines (wrong numbers = worst defect):**
- **Three required fields gate the IRR:** `loanAmount > 0`, disbursement date, settlement date. `SettlementCalculator.compute` already enforces this (returns `irr: nil` otherwise) — the VM's `canCalculate` mirrors it for the button + the warning.
- **Waiver clamp:** `waiver ∈ [0, receivable]`; `adjustment = max(0, receivable − waiver)` (derived, NOT stored).
- **Collection-for-IRR exclusion** (engine `Settlement.collectionForIRR`): non-excise/legal rows contribute their *adjustment*; excise-duty & legal-fee rows *subtract their waiver*. Match by case-insensitive substring `"excise"`/`"legal"` in the row NAME.
- **Collection for Settlement (proposed payment) = Σ adjustments** (ALL rows, no exclusion) — DIFFERENT from collection-for-IRR.
- **Excluded payments:** a payment enters the XIRR only with a date AND amount > 0; `SettlementCalculator.Result.excludedPayments` counts rows that have a non-zero amount but no usable date / non-positive amount — surface a warning. Excluded payments STILL sum into "Total Payment Till Date".
- **IRR** displayed `(irr*100)` to 2dp, or **"N/A"** when nil.

---

## File structure (new, under `~/Projects/incalc-ios`)
```
App/Resources/SettlementSample.xlsx        # synthetic sample (copy of Plan-2 clean.xlsx)   [Task 2; project.yml resource]
Features/Settlement/SettlementViewModel.swift                                                [Task 1]
Features/Settlement/SettlementView.swift   # 3-screen flow + fileImporter                    [Task 3-4]
Tests/AppTests/SettlementViewModelTests.swift                                                [Task 1]
App/RootTabView.swift                       # Settlement placeholder → SettlementView()       [Task 3]
```

**Import/engine API (verified — `Sources/InCalcExcelImport/`):**
```swift
XLSXSheet(path: String) throws                       // opens the first worksheet of an .xlsx
SettlementSheetParser.parse(_ s: XLSXSheet) -> SettlementSheetParser.Import
//   Import(client, account, loanAmountRaw:String, disbursementDate:String, settlementDate:String,
//          receivables:[Receivable(name, receivable, waiver)], payments:[Payment(date, amount)])
SettlementCalculator.compute(loanAmount:Double, disbursementDate:String, settlementDate:String,
                             receivables:[SettlementSheetParser.Receivable],
                             payments:[SettlementSheetParser.Payment]) -> SettlementCalculator.Result
//   Result(irr:Double?, collectionForIRR:Double, cashflowCount:Int, excludedPayments:Int)
InCalcEngine.Settlement.collectionForIRR([Settlement.Receivable]) -> Double   // (compute already uses it)
CellParse.number(_:String) -> Double?                // parse loanAmountRaw → Double
Money.fmt(_:) -> String
```
Default receivable names (`SettlementSheetParser.defaultReceivables`, also re-declare in the VM): URPA, Principal Overdue, Interest Overdue, Deferment Interest, Late Payment Interest (LPI), Excise Duty, Others Receivable, Supervision Fees, Legal Fee. Dates are `"yyyy-MM-dd"` strings throughout (parser emits them; compute consumes them).

---

### Task 1: `SettlementViewModel` + tests

**Files:** Create `Features/Settlement/SettlementViewModel.swift`, `Tests/AppTests/SettlementViewModelTests.swift`. **Most capable model.** TDD.

**Public surface:**
- `enum Screen { upload, edit, results }`; `var screen: Screen = .upload`.
- Editable model (`@Observable`, NOT persisted): `client/account: String`; `loanAmount: Double`; `disbursementDate/settlementDate: String` ("yyyy-MM-dd" or ""); `receivables: [Row]`, `payments: [PayRow]` where
  `struct Row: Identifiable { let id = UUID(); var name: String; var receivable: Double; var waiver: Double }` and
  `struct PayRow: Identifiable { let id = UUID(); var date: String; var amount: Double }`.
- `func startBlank()` — receivables = the 9 defaults (receivable 0, waiver 0), payments = [], clear client/account/loanAmount/dates, `screen = .edit`.
- `func loadFromImport(_ imp: SettlementSheetParser.Import)` — client/account = imp.*; loanAmount = `CellParse.number(imp.loanAmountRaw) ?? 0`; disbursementDate/settlementDate = imp.*; receivables = imp.receivables.map(Row); payments = imp.payments.map(PayRow); `screen = .edit`.
- `func importWorkbook(path: String) throws` — `let sheet = try XLSXSheet(path: path); loadFromImport(SettlementSheetParser.parse(sheet))`. (The View provides the security-scoped file path.)
- Receivable editing: clamp on write — expose `func setWaiver(_ value: Double, at: Int)` clamping `min(max(0, value), receivables[at].receivable)`; `func adjustment(_ r: Row) -> Double` = `max(0, r.receivable - r.waiver)`. Add/delete: `addReceivable()/deleteReceivable(at:)`, `addPayment()/deletePayment(at:)`.
- Derived totals: `totalReceivable`, `totalAdjustment` (Σ adjustment), `totalWaiver`, `collectionForSettlement` (= totalAdjustment), `totalPaid` (Σ payments.amount), and `collectionForIRR` (= `Settlement.collectionForIRR(receivables.map { Settlement.Receivable(name:receivable:waiver:) })`).
- `var canCalculate: Bool` = `loanAmount > 0 && !disbursementDate.isEmpty && !settlementDate.isEmpty`.
- `private(set) var result: SettlementCalculator.Result?` ; `func calculate()` — guard `canCalculate`; `result = SettlementCalculator.compute(loanAmount:, disbursementDate:, settlementDate:, receivables: receivables.map{...}, payments: payments.map{...})`; `screen = .results`.
- Result-screen derived (computed from `result` + the model): `irrText` (result?.irr nil → "N/A" else "%.2f%%" of irr*100), `collectionForIRRText`, `collectionForSettlementText`, `totalPaidText`, `proposedPaymentText` (= collectionForSettlement), `totalPaidWillBe` (= totalPaid + collectionForSettlement) + `…Text`, `excess` (= totalPaidWillBe − loanAmount) + `…Text`, `totalReceivableText`, `totalWaiverText`. `excludedPayments: Int` (= result?.excludedPayments ?? 0). `waiverBreakdown: [(name: String, waiver: Double)]` = receivables filter `waiver > 0.01`.
- `func editInputs()` → `screen = .edit`; `func backToUpload()` → `screen = .upload` (no clear); `func reset()` → clear all + `screen = .upload`.

- [ ] **Step 1: Failing tests** `Tests/AppTests/SettlementViewModelTests.swift` (import `InCalcEngine`, `InCalcExcelImport`):
```swift
import XCTest
import InCalcEngine
import InCalcExcelImport
@testable import InCalcBD

@MainActor
final class SettlementViewModelTests: XCTestCase {
    func test_startBlankSeedsDefaults() {
        let m = SettlementViewModel()
        m.startBlank()
        XCTAssertEqual(m.screen, .edit)
        XCTAssertEqual(m.receivables.count, 9)
        XCTAssertEqual(m.receivables.first?.name, "URPA")
        XCTAssertTrue(m.payments.isEmpty)
    }
    func test_waiverClamp() {
        let m = SettlementViewModel(); m.startBlank()
        m.receivables[0].receivable = 1000
        m.setWaiver(5000, at: 0)              // > receivable → clamp to 1000
        XCTAssertEqual(m.receivables[0].waiver, 1000)
        m.setWaiver(-50, at: 0)               // < 0 → clamp to 0
        XCTAssertEqual(m.receivables[0].waiver, 0)
        m.receivables[0].waiver = 400
        XCTAssertEqual(m.adjustment(m.receivables[0]), 600)   // max(0, 1000-400)
    }
    func test_canCalculateGate() {
        let m = SettlementViewModel(); m.startBlank()
        XCTAssertFalse(m.canCalculate)                        // no loan/dates
        m.loanAmount = 1_000_000; m.disbursementDate = "2024-01-15"; m.settlementDate = "2024-06-30"
        XCTAssertTrue(m.canCalculate)
    }
    // Collection-for-IRR excludes excise/legal per the engine rule.
    func test_collectionForIRRExclusion() {
        let m = SettlementViewModel(); m.startBlank()
        m.receivables = [
            .init(name: "Principal Overdue", receivable: 100_000, waiver: 0),   // adj 100000 → +100000
            .init(name: "Excise Duty", receivable: 3_000, waiver: 3_000),       // excise → subtract waiver 3000
        ]
        let eng = Settlement.collectionForIRR([
            .init(name: "Principal Overdue", receivable: 100_000, waiver: 0),
            .init(name: "Excise Duty", receivable: 3_000, waiver: 3_000)])
        XCTAssertEqual(m.collectionForIRR, eng, accuracy: 1e-6)
    }
    // Importing a settlement workbook populates the edit model + advances.
    func test_importWorkbook() throws {
        // Bundle the same synthetic fixture the InCalcExcelImport tests use, or pass its path.
        let path = try XCTUnwrap(Bundle(for: Self.self).path(forResource: "clean", ofType: "xlsx")
                                 ?? Bundle.module.path(forResource: "clean", ofType: "xlsx"))
        let m = SettlementViewModel()
        try m.importWorkbook(path: path)
        XCTAssertEqual(m.screen, .edit)
        XCTAssertFalse(m.receivables.isEmpty)
        XCTAssertEqual(m.client, "Test Client Ltd")          // clean.xlsx client
    }
    // Calculate wires the engine; N/A when gates unmet.
    func test_calculate() {
        let m = SettlementViewModel(); m.startBlank()
        m.loanAmount = 1_000_000; m.disbursementDate = "2024-01-15"; m.settlementDate = "2024-06-30"
        m.receivables[1].receivable = 600_000   // Principal Overdue, adj 600000 → positive collection
        m.payments = [.init(date: "2024-02-15", amount: 30_000)]
        m.calculate()
        XCTAssertEqual(m.screen, .results)
        XCTAssertNotNil(m.result)
    }
}
```
> Note for the implementer: the `test_importWorkbook` fixture (`clean.xlsx`) needs to be reachable from the AppTests bundle. Add `clean.xlsx` to the `AppTests` target resources (copy from `Tests/InCalcExcelImportTests/Fixtures/clean.xlsx`) via `project.yml`, OR if that's awkward, skip the file-based test and instead hand-build a `SettlementSheetParser.Import` and test `loadFromImport(_:)` directly. Either proves the wiring; pick the cleaner one and note it.

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the VM per the surface. `@MainActor @Observable`, `import Foundation`/`Observation`/`InCalcEngine`/`InCalcExcelImport` (NO SwiftUI). Memoization isn't needed (results compute on the explicit `calculate()`), but the live `collectionForIRR`/totals are cheap computed properties. Re-declare the 9 default receivable names.
- [ ] **Step 4: Run — PASS.** Fix the VM if a number's off (engine is golden).
- [ ] **Step 5: Commit** — `git add Features/Settlement Tests/AppTests/SettlementViewModelTests.swift [project.yml if fixture added] && git commit -m "feat(ios): SettlementViewModel — 3-screen state, editable model, import + compute wiring + tests"`

---

### Task 2: Sample workbook bundling + the `.fileImporter` intake plumbing

**Files:** Add `App/Resources/SettlementSample.xlsx`; modify `project.yml` (bundle the resource). Create a small `Features/Settlement/SettlementImport.swift` helper (the security-scoped open) if it keeps `SettlementView` clean.

- [ ] **Step 1:** Copy the synthetic sample into the app: `cp ~/Projects/InCalc/tools/parse-fixtures/clean.xlsx ~/Projects/incalc-ios/App/Resources/SettlementSample.xlsx` (synthetic, fake data — never a real file). In `project.yml`, add the resource to the `InCalcBD` target (e.g. a `sources` entry for `App/Resources` with `buildPhase: resources`, or `settings`/`info` as appropriate for XcodeGen — verify it lands in the app bundle, not compiled).
- [ ] **Step 2:** A security-scoped open helper:
```swift
// Features/Settlement/SettlementImport.swift
import Foundation
import InCalcExcelImport

enum SettlementImport {
    enum ImportError: Error { case notXLSX, unreadable }
    /// Opens a security-scoped picked .xlsx URL and parses it. Caller passes the fileImporter URL.
    static func parse(_ url: URL) throws -> SettlementSheetParser.Import {
        guard url.pathExtension.lowercased() == "xlsx" else { throw ImportError.notXLSX }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        // CoreXLSX reads from a filesystem path; copy to a temp file to guarantee read access.
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".xlsx")
        try FileManager.default.copyItem(at: url, to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let sheet = try XLSXSheet(path: tmp.path)
        return SettlementSheetParser.parse(sheet)
    }
}
```
- [ ] **Step 3:** Build + a quick `XCTest` (or reuse Task 1's) that `XLSXSheet(path:)` works on the bundled `SettlementSample.xlsx` path (`Bundle.main.path(forResource:"SettlementSample", ofType:"xlsx")`). Confirm the parse yields the synthetic client. Commit.
```bash
git add App/Resources project.yml Features/Settlement/SettlementImport.swift Tests/AppTests/*
git commit -m "feat(ios): bundle synthetic Settlement sample + security-scoped .xlsx import helper"
```

---

### Task 3: `SettlementView` — the three screens + tab wire-in

**Files:** Create `Features/Settlement/SettlementView.swift`; modify `App/RootTabView.swift`. **Most capable model.** Follow the house style; `@State private var vm = SettlementViewModel()`, scoped `@Bindable`. Switch the body on `vm.screen`.

- [ ] **Step 1: Upload screen** (`vm.screen == .upload`): a drop/import card with an "Import .xlsx" `Button` opening a `.fileImporter(isPresented:, allowedContentTypes: [UTType(filenameExtension: "xlsx") ?? .spreadsheet], onCompletion:)`; on success → `try SettlementImport.parse(url)` → `vm.loadFromImport(imp)` (show an `.alert` on `ImportError.notXLSX` = "Please re-save the file as .xlsx"); a "Start blank" `Button` → `vm.startBlank()`; a "Sample format" `ShareLink(item: Bundle.main.url(forResource:"SettlementSample", withExtension:"xlsx")!)` so the banker can see the template.
- [ ] **Step 2: Edit screen** (`vm.screen == .edit`): client name/account `TextField`s; loan amount `BDTField` (required — visually flag); disbursement date + settlement date `DatePicker`s (bind a `Date` ↔ the "yyyy-MM-dd" string via a helper). The **receivables list** (`SurfaceCard`): header (Particulars · Receivable · Adjustment · Waiver), `ForEach($vm.receivables)` rows — name `TextField`, receivable number field, `Text(Money.fmt(vm.adjustment(row)))` (read-only), waiver number field whose set goes through `vm.setWaiver(_, at:)` (clamp), delete (confirm when row holds data); `+ Add Row`; totals (receivable/adjustment/waiver via `vm.total*`). The **payment schedule** (`SurfaceCard`): `ForEach($vm.payments)` rows — SL index, date `DatePicker`, amount number field, delete; `+ Add Payment`. A **settlement-entry** row: settlement date `DatePicker` + a live "Collection for IRR" = `Money.fmt(vm.collectionForIRR)`. A **"Calculate IRR"** primary `Button` (disabled unless `vm.canCalculate`) → `vm.calculate()`; a "Back" button → `vm.backToUpload()`. If `!vm.canCalculate`, show inline guidance (loan + both dates required).
- [ ] **Step 3: Wire** `RootTabView` Settlement tab → `SettlementView()`, keep `.tabItem { Label("Settlement", systemImage: "doc.text.magnifyingglass") }`. (All five tabs now real.) A top "Reset" affordance (shown off-upload) → `vm.reset()`.
- [ ] **Step 4: Build + full test suite** (`xcodebuild test` — all green). Fix SwiftUI/`.fileImporter`/`DatePicker`-string-binding compile issues minimally without changing the VM API or any number.
- [ ] **Step 5: Commit** — `git add Features/Settlement/SettlementView.swift App/RootTabView.swift && git commit -m "feat(ios): Settlement tab — upload + edit screens, fileImporter intake, tab wire-in"`

---

### Task 4: Results screen + charts + governance + gate + PR

**Files:** Modify `Features/Settlement/SettlementView.swift` (add the results screen), `AGENTS.md`, `AGENT_LEARNINGS.md`. **Most capable model.**

- [ ] **Step 1: Results screen** (`vm.screen == .results`): a metrics grid — **Settlement IRR** (`vm.irrText`, accent, sub "Annualized return"), Collection for IRR (`vm.collectionForIRRText`, sub "Excl. legal & excise waiver"), Collection for Settlement (`vm.collectionForSettlementText`, sub "Sum of all adjustments"), Total Payment Till Date (`vm.totalPaidText`), Proposed Payment (`vm.proposedPaymentText`), Total Paid Will Be (`vm.totalPaidWillBeText`), Excess over Disbursed (`vm.excessText`). A **Collection Summary** card (disbursed/paid/proposed/total/excess/present-receivables). A **Waiver Breakdown** card listing `vm.waiverBreakdown` (name + `Money.fmt(waiver)`) + Total Waiver. If `vm.excludedPayments > 0`, a warning banner ("N payment row(s) excluded from the IRR — missing date or non-positive amount"). Charts (optional but nice): a waiver bar (receivable vs waiver per row) + a collection doughnut (per-row adjustments) via Swift Charts. An **"Edit Inputs"** button → `vm.editInputs()`.
- [ ] **Step 2: Build + full test suite + screenshots** — `xcodebuild test` all green. Drive to the Settlement tab (5th tab; temporary uncommitted selection), exercise: tap "Start blank" → edit screen → set loan amount + both dates + a receivable + a payment → "Calculate IRR" → results; ALSO tap "Import .xlsx" path isn't drivable headlessly, so at minimum screenshot the upload + edit + results screens (use the blank flow). Revert the hack (verify clean). Read the PNGs; confirm all three screens render in light + dark and the IRR/collection figures are sane vs the engine. Report what you see.
- [ ] **Step 3: AGENTS.md** — add `Features/Settlement/` + `App/Resources/SettlementSample.xlsx`; note the **3-screen flow + `.fileImporter` + security-scoped + the .xlsx-only guard + BDT-lock**, and the **collection-for-IRR exclusion (excise/legal by name substring) vs collection-for-settlement (all adjustments)** distinction. Mark **all five tabs complete**.
- [ ] **Step 4: `AGENT_LEARNINGS.md`** — append any incident (esp. CoreXLSX-on-device / security-scoped-resource / fileImporter gotchas, or a date-string-binding issue). If clean, one line.
- [ ] **Step 5: Full gate** — `xcodebuild test` (all app) + `swift test` (26 green, untouched).
- [ ] **Step 6: Commit** — `git add Features/Settlement/SettlementView.swift AGENTS.md AGENT_LEARNINGS.md && git commit -m "feat(ios): Settlement results screen + charts; docs — all five tabs complete"`
- [ ] **Step 7 (controller, after final review):** push + PR (`Plan 4d: Settlement tab — all five tabs complete`).

---

## Self-review (writing-plans checklist)
- **Spec coverage (§4 Settlement + §5 import):** 3-screen flow (Task 1 `screen` + Task 3/4 views), import .xlsx via fileImporter + security-scoped + .xlsx-only guard + sample (Task 2 + Task 3 Step 1), start-blank seeds 9 defaults (Task 1), edit: client/loan/dates + editable receivables (waiver clamp + derived adjustment) + payment schedule + settlement date + live collection-for-IRR (Task 1 + Task 3 Step 2), required-field guard (Task 1 `canCalculate`), results: IRR + all collection metrics + summary + waiver breakdown + excluded-payment warning (Task 1 derived + Task 4 Step 1), BDT-lock (Money.fmt). Charts: Task 4 (optional). Decisions: bundled synthetic sample, .xlsx-only, not persisted.
- **Type consistency:** VM surface used by tests (`startBlank`, `setWaiver`, `adjustment`, `canCalculate`, `collectionForIRR`, `importWorkbook`, `calculate`, `result`) == surface consumed by the View. Engine/import calls use the exact `XLSXSheet(path:)` / `SettlementSheetParser.parse` / `SettlementCalculator.compute(...)` / `Settlement.collectionForIRR(...)` signatures.

## Open items to confirm while executing
- **CoreXLSX on the app target / device:** `XLSXSheet(path:)` is golden-tested against fixture paths in `InCalcExcelImportTests`; confirm it also works on a security-scoped picked URL copied to a temp path (Task 2). If CoreXLSX chokes on a real bank file during owner testing, the Plan-B hand-rolled parser (master spec §5) is the fallback — out of scope here.
- **`project.yml` resource bundling** for `App/Resources/SettlementSample.xlsx` — verify it lands in the bundle (not compiled as a source). Check `Bundle.main.url(forResource:"SettlementSample", withExtension:"xlsx")` resolves at runtime.
- **DatePicker ↔ "yyyy-MM-dd" string binding** — a small `Binding<Date>` adapter over the VM's string dates; confirm round-trip in the local timezone (matches `SettlementCalculator`'s `.current`-tz parsing).
