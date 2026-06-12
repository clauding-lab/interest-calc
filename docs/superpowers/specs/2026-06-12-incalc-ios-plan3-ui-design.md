# InCalc BD iOS — Plan 3 Design: App foundation + Loan reference tab

**Date:** 2026-06-12
**Status:** Approved direction (brainstormed); pending implementation plan
**Parent spec:** `2026-06-12-incalc-ios-design.md` (this refines §3–§4 with the UI-build decisions that spec left open)
**Builds on:** `InCalcEngine` (Plan 1) + `InCalcExcelImport` (Plan 2), both shipped in `clauding-lab/incalc-ios`

---

## 1. Goal & scope

Plan 3 delivers a **runnable iOS app** on the simulator: the Xcode app project, a real design system, the five-tab shell, and **one complete tab — Loan** — built end-to-end (inputs → engine → metric cards + chart + amortization table). The other four tabs ship as tidy placeholder screens. This is the foundation every later tab snaps into.

- **Plan 3 (this):** app project + design system + `RootTabView` shell + the **Loan** tab, fully working. Runnable, light+dark.
- **Plan 4 (later):** the remaining four tabs — Deposit, DSCR, Compare, and Settlement (wiring in the Plan-2 import) — each reusing Plan 3's components.
- **Plan 5 (later):** App Store release (TestFlight, screenshots, metadata, submission).

**Out of scope for Plan 3:** the other four tabs; the Settlement Excel-import UI; any App Store / release mechanics.

## 2. Decisions locked in brainstorming

| Decision | Choice | Why |
|---|---|---|
| Slice | Foundation + **Loan** reference tab first | Loan is the canonical calculator (money inputs, metric cards, a chart, a table, an EAR sub-section) — it forges every reusable component without Deposit's preset-switching or DSCR's custom gauge. Hardest tabs wait for Plan 4, once the components exist. |
| Xcode project | **XcodeGen** (`project.yml` → generated `.xcodeproj`) | The project is one small, diffable YAML file an AI agent can safely edit; the `.xcodeproj` is generated and gitignored. Xcode project files are huge and merge-hostile to hand-edit. |
| Per-tab structure | **View + ViewModel** (MVVM-lite) | ViewModel holds inputs (`@AppStorage`), calls the engine, exposes formatted results; View renders. Engine/import are the only dependencies — no business logic in views. |
| Visual bar | **Polished native, faithful to the web app** | Mirror the web brand/colour language so colleagues recognise it; an opinionated design system (type scale, spacing, metric cards, chart styling), not a default `Form` look. Not flashy. |
| Verification | **ViewModel unit tests + run-on-simulator** | UI has no golden-vector oracle; the ViewModel wiring is unit-tested against the already-golden engine, and the View is verified by launching it on the simulator and confirming rendered figures match the engine. |

## 3. Architecture

The app target lives in the **`incalc-ios`** repo and depends on the two local SPM packages already built: `InCalcEngine` (math) and `InCalcExcelImport` (Settlement parser — used in Plan 4).

```
incalc-ios/
├── project.yml                     # XcodeGen definition (the source of truth; .xcodeproj is generated)
├── App/
│   ├── InCalcApp.swift             # @main App; injects Theme; sets up RootTabView
│   └── RootTabView.swift           # TabView shell, 5 tabs (SF Symbols), Loan live + 4 placeholders
├── DesignSystem/
│   ├── Theme.swift                 # colour, type scale, spacing, radii tokens (mirrors the web palette)
│   ├── BDTField.swift              # ৳ decimal-keypad money input (formats via InCalcEngine.Money)
│   ├── MetricCard.swift            # labelled value card (the result tiles)
│   ├── SurfaceCard.swift           # elevated container surface
│   ├── Chip.swift  SegmentedControl.swift   # quick-pick chips, preset/segment control
│   └── ChartStyle.swift            # shared Swift Charts styling helpers
├── Features/
│   └── Loan/
│       ├── LoanView.swift          # the screen
│       └── LoanViewModel.swift     # inputs (@AppStorage) → InCalcEngine.Loan → formatted results
├── Shared/Placeholder/
│   └── PlaceholderTab.swift        # "Coming soon" screen for the 4 not-yet-built tabs
└── Tests/AppTests/
    └── LoanViewModelTests.swift    # inputs → exact engine numbers (engine math already golden-tested)
```

- **Engine-only dependency rule:** ViewModels import `InCalcEngine`; Views import only the design system + their ViewModel. No view touches CoreXLSX or raw math.
- **Persistence:** each tab's inputs persist via `@AppStorage` (UserDefaults) so the app reopens where the user left off.
- **Theme injection:** `Theme` provided via the SwiftUI environment; light+dark resolved from the system setting (no manual toggle in v1).
- **`.gitignore`:** Plan 1 already ignores `*.xcodeproj` — keep it ignored (XcodeGen regenerates the project from YAML) and **commit `project.yml`** as the single source of truth. Build flow: `xcodegen generate` → `xcodebuild` / open in Xcode.

## 4. The Loan tab (the reference build)

Ports the web Loan tab (parent spec §4) using native idioms. Inputs are **`BDTField`s** (decimal keypad) with quick-pick **chips** where the web had slider presets:

- **Inputs:** loan amount, annual rate, tenure (years); a **prepayment** section (extra monthly payment) with a savings badge; an **advance-EMI + cash-security** section that surfaces the **EAR card** (labelled "Effective annual rate — compounded (EAR)").
- **Results:** metric cards (EMI, total interest, total paid, total months) driven by `InCalcEngine.Loan.buildSchedule` / `.effectiveRate`.
- **Chart:** the payoff chart — stacked bars (principal vs interest per year) plus a remaining-balance line — via Swift Charts, styled by `ChartStyle` (mirrors the web Loan chart). Geometry need not match Chart.js; parity is on the numbers (engine-guaranteed).
- **Table:** the year-by-year amortization table (`Schedule.rows`).
- **All web validation guards** port 1:1 (min/max, rate ≥ 0, etc.); the EAR card shows only when the gate conditions hold (advance EMIs or cash security present) — matching the web caller's gate, not the raw engine.

## 5. Verification (the Plan 3 gate)

1. `xcodegen generate` produces a buildable project; `xcodebuild build` for an iOS-17 simulator succeeds.
2. **`LoanViewModelTests`** assert that representative inputs produce the exact EMI / total-interest / EAR numbers the engine returns (which are already golden-tested against the web in Plan 1) — so the *wiring* is proven, not re-deriving the math.
3. **Run on the iOS simulator** (`xcodebuild test` or a launched simulator): drive the Loan tab, confirm it renders and the displayed figures match the engine; capture light + dark screenshots; no console errors.
4. The 4 placeholder tabs render without crashing; the tab bar navigates.

## 6. Risks

| Risk | Mitigation |
|---|---|
| XcodeGen not installed / project won't generate | First plan task installs `xcodegen` (brew) and verifies `xcodegen generate` + a clean build before any UI code. If it can't be made to work, fall back to a committed `.xcodeproj` (documented). |
| UI "looks like a default template" | The design system (Theme + components) is built and reviewed *first*; the Loan tab composes those, not raw `Form` rows. |
| Simulator/`xcodebuild` unavailable in the dev environment | The ViewModel unit tests (headless, `swift test`-style) cover the wiring; the visual run is owner-verifiable on the Mac if CI can't render. |
| Design drift across the later tabs | Loan establishes every component + the Theme; Plan 4 tabs *must* reuse them (an AGENTS landmine), not re-style. |
