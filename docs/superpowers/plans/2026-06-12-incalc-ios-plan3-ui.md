# InCalc BD iOS — Plan 3: App foundation + Loan reference tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All work happens in `~/Projects/incalc-ios` on the branch `feat/plan3-ui-loan`** (already created off `main` @ `d05a52d`). Commit per task; do NOT push until the final task. The web repo (`~/Projects/InCalc`) is read-only here, consulted only for Loan-tab parity.

**Goal:** A runnable iOS app on the simulator — the XcodeGen app project, a native design system, a five-tab shell, and ONE fully-working tab (Loan: sliders → engine → metric cards + Swift Charts payoff chart + amortization table + EAR card). The other four tabs ship as placeholders.

**Architecture:** A SwiftUI iOS app target (`InCalcBD`) is added to the existing `incalc-ios` SwiftPM package via **XcodeGen** (`project.yml` committed; `.xcodeproj` generated + gitignored). The app depends on the two local package products `InCalcEngine` (golden-tested math) and `InCalcExcelImport` (Plan-2 parser, used in Plan 4). MVVM-lite: an `@Observable` `LoanViewModel` holds inputs (persisted to an injectable `UserDefaults`), calls `InCalcEngine.Loan`, and exposes formatted results; `LoanView` renders. The engine is the ONLY math dependency — no view re-derives a number. Verification is two-layered: `LoanViewModelTests` prove the wiring against the already-golden engine, and a simulator run proves the render.

**Tech Stack:** Swift 6.3 / Xcode 26.5, SwiftUI (iOS 17 deploy target), Swift Charts, the iOS-17 Observation framework (`@Observable`), XcodeGen 2.45.4, `xcodebuild`/`xcrun simctl` against the installed iOS 26.5 simulator (iPhone 17). No new SwiftPM dependencies; no font bundling.

**Spec:** `docs/superpowers/specs/2026-06-12-incalc-ios-plan3-ui-design.md` (Plan-3 design) refining `…incalc-ios-design.md` §3–§4. Web source of truth for Loan parity: `~/Projects/InCalc/index.html` — functions `calcLoan` (~:1720), `buildSchedule` (~:1670), `emiFormula` (~:1229), `calcEffectiveRate` (~:1689), and the `:root` / `html.dark-mode` CSS token blocks (~:23–38).

**Owner decisions locked this session (override the spec where they differ):**
1. **Loan inputs are all sliders + one advance-EMI picker** — web-faithful. The spec §4's "BDTField + chips" premise was mistaken (the web Loan tab has no chips/presets). BDTField + Chip are still built in the design system for Plan-4 reuse, but the Loan tab does NOT consume them.
2. **Native Apple typography** — SF Mono for every figure, New York (serif) italic for titles, SF Pro for body. No Google-font bundling. (Web used DM Mono/Fraunces/DM Sans; we substitute the system equivalents.)
3. **ViewModel persistence = `@Observable` class + injected `UserDefaults`** (NOT `@AppStorage` — it cannot live in a non-View type and does not bridge into `@Observable`). This is the correct realization of the spec's "@AppStorage" intent.

**Parity landmines (wrong financial output is the worst defect — flag any number change):**
- EMI is **displayed rounded but computed unrounded**; the raw `base.emi` feeds the schedule AND the EAR solver. Never round before computing.
- **Cash-security slider max is dynamic** = `round(principal * 0.5)`, capped at 5,000,000; raising principal can silently shrink a set CS amount (snap-down).
- **EAR is two-gated:** show only when `(advanceEMIs > 0 || cashSecurity > 0)` AND `Loan.effectiveRate(...)` returns non-nil with `effectiveRate > 0`. The engine returns nil when `netDisbursement <= 0`.
- **Tenure is in YEARS** (1–30, integer). The engine multiplies by 12 internally.
- Metric cards mirror the web: **EMI, Total interest, Total repayment, Interest ratio** — NOT "total months" (that lives in the prepay savings badge only).

---

## File structure (created by this plan, all under `~/Projects/incalc-ios`)

```
project.yml                              # XcodeGen — app + test target (Task 1)
.gitignore                               # + .build-xcode/  (Task 1)
App/
  InCalcApp.swift                        # @main App (Task 1)
  RootTabView.swift                      # 5-tab shell; Loan placeholder→real in Task 4 (Task 1)
DesignSystem/
  Theme.swift                            # color/type/space/radius tokens (light+dark) + Color(hex:) (Task 2)
  SurfaceCard.swift  MetricCard.swift    # elevated surface + result tile (Task 2)
  LabeledSlider.swift                    # the Loan input primitive: label + slider + formatted readout (Task 2)
  BDTField.swift  Chip.swift             # typed-money field + quick-pick chip — for Plan-4 reuse (Task 2)
  ChartStyle.swift                       # shared Swift Charts styling (Task 2)
Features/Loan/
  LoanViewModel.swift                    # @Observable inputs → InCalcEngine.Loan → formatted results (Task 3)
  LoanView.swift                         # the screen (Task 4)
Shared/Placeholder/
  PlaceholderTab.swift                   # "Coming soon" for the 4 not-yet-built tabs (Task 1)
Tests/AppTests/
  LoanViewModelTests.swift               # inputs → exact engine numbers + gating + persistence (Task 3)
```

**Engine API the ViewModel calls (verified against `Sources/InCalcEngine/Loan.swift` + `Money.swift` — use these EXACT signatures):**
```swift
Loan.emi(pv: Double, monthlyRate: Double, months: Int) -> Double
Loan.buildSchedule(principal: Double, annualRatePct: Double, years: Int, extraMonthly: Double) -> Loan.Schedule
//   Schedule(emi, rows: [YearRow(year, open, principal, interest, close)], totalPaid, totalInterest, totalMonths)
Loan.effectiveRate(principal: Double, nominalRatePct: Double, years: Int, emi: Double,
                   advanceEMIs: Int, cashSecurity: Double, csAnnualRatePct: Double) -> Loan.EffectiveRate?
//   EffectiveRate(effectiveRate, netDisbursement, csInterest, rateMarkup)
Money.fmt(_ n: Double) -> String   // ৳ lakh/crore grouped, rounded int
Money.grp(_ n: Double) -> String   // grouped 2dp, no symbol
```

**Loan input contract (verified from the web — defaults / range / step):**
| Input | Default | Min…Max | Step | Readout format |
|---|---|---|---|---|
| principal (৳) | 1,000,000 | 50,000…50,000,000 | 50,000 | `Money.fmt` |
| annualRatePct | 9 | 1…25 | 0.25 | `%.2f%%` |
| termYears | 10 | 1…30 | 1 | `"N year(s)"` |
| extraMonthly (৳) | 0 | 0…100,000 | 500 | `Money.fmt` |
| advanceEMIs | 0 | 0…12 | 1 (picker) | `"N EMI(s)"` / `"0"` |
| cashSecurity (৳) | 0 | 0…`min(5,000,000, round(P·0.5))` | 10,000 | `Money.fmt` |
| csRatePct | 0 | 0…15 | 0.25 | `%.2f%%` |

---

### Task 1: App scaffold — XcodeGen project + runnable 5-tab shell (all placeholders)

**Files:** Create `project.yml`, `App/InCalcApp.swift`, `App/RootTabView.swift`, `Shared/Placeholder/PlaceholderTab.swift`; Modify `.gitignore`.

This task is foundational and integration-heavy — **dispatch with the most capable model.** Goal: `xcodegen generate` → `xcodebuild build` → app launches on the iPhone 17 simulator showing a 5-tab bar.

- [ ] **Step 1: Write `project.yml`** (verified XcodeGen 2.45.x syntax; local package at repo root, two products, app + test target, shared scheme)

```yaml
name: InCalcBD

options:
  bundleIdPrefix: com.claudinglab
  deploymentTarget:
    iOS: "17.0"
  createIntermediateGroups: true

packages:
  InCalcEngine:
    path: .                      # local SwiftPM package at the repo root (same dir as project.yml)

settings:
  base:
    SWIFT_VERSION: "6.0"
    CODE_SIGN_STYLE: Automatic

targets:
  InCalcBD:
    type: application
    platform: iOS
    deploymentTarget: "17.0"
    sources: [App, DesignSystem, Features, Shared]
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
        PRODUCT_BUNDLE_IDENTIFIER: com.claudinglab.incalcbd
        INFOPLIST_KEY_CFBundleDisplayName: "InCalc BD"
        INFOPLIST_KEY_UILaunchScreen_Generation: YES
        INFOPLIST_KEY_UISupportedInterfaceOrientations: "UIInterfaceOrientationPortrait"
        MARKETING_VERSION: "1.0.0"
        CURRENT_PROJECT_VERSION: "1"
        TARGETED_DEVICE_FAMILY: "1"
    dependencies:
      - package: InCalcEngine
        product: InCalcEngine
      - package: InCalcEngine
        product: InCalcExcelImport

  AppTests:
    type: bundle.unit-test
    platform: iOS
    deploymentTarget: "17.0"
    sources: [Tests/AppTests]
    dependencies:
      - target: InCalcBD
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
        PRODUCT_BUNDLE_IDENTIFIER: com.claudinglab.incalcbd.tests

schemes:
  InCalcBD:
    build:
      targets: { InCalcBD: all }
    test:
      gatherCoverageData: true
      targets: [AppTests]
```

- [ ] **Step 2: `.gitignore`** — append `.build-xcode/` (the pinned DerivedData path; keep the existing `*.xcodeproj` ignore).

- [ ] **Step 3: App entry + placeholder tab + shell**

```swift
// App/InCalcApp.swift
import SwiftUI

@main
struct InCalcApp: App {
    var body: some Scene {
        WindowGroup { RootTabView() }
    }
}
```

```swift
// Shared/Placeholder/PlaceholderTab.swift
import SwiftUI

/// "Coming soon" screen for tabs not yet built (Deposit, DSCR, Compare, Settlement — Plan 4).
struct PlaceholderTab: View {
    let title: String
    let systemImage: String
    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label(title, systemImage: systemImage)
            } description: {
                Text("Coming soon")
            }
            .navigationTitle(title)
        }
    }
}
```

```swift
// App/RootTabView.swift
import SwiftUI

/// Five-tab shell. The Loan tab is wired to the real LoanView in Task 4; the other four are placeholders.
struct RootTabView: View {
    var body: some View {
        TabView {
            // Loan — placeholder until Task 4 replaces it with LoanView().
            PlaceholderTab(title: "Loan", systemImage: "banknote")
                .tabItem { Label("Loan", systemImage: "banknote") }
            PlaceholderTab(title: "Deposit", systemImage: "chart.line.uptrend.xyaxis")
                .tabItem { Label("Deposit", systemImage: "chart.line.uptrend.xyaxis") }
            PlaceholderTab(title: "DSCR", systemImage: "gauge.with.dots.needle.50percent")
                .tabItem { Label("DSCR", systemImage: "gauge.with.dots.needle.50percent") }
            PlaceholderTab(title: "Compare", systemImage: "arrow.left.arrow.right")
                .tabItem { Label("Compare", systemImage: "arrow.left.arrow.right") }
            PlaceholderTab(title: "Settlement", systemImage: "doc.text.magnifyingglass")
                .tabItem { Label("Settlement", systemImage: "doc.text.magnifyingglass") }
        }
    }
}
```

- [ ] **Step 4: Generate + build + verify launch** (this is the HARD GATE for Task 1)

```bash
cd ~/Projects/incalc-ios
xcodegen generate                                   # writes InCalcBD.xcodeproj (gitignored)
xcodebuild -showBuildSettings -scheme InCalcBD -project InCalcBD.xcodeproj | grep -i InCalcEngine | head
# ^ MUST show the package products linked. If empty, the `path: .` package didn't resolve — see Gotcha note.
xcodebuild build -project InCalcBD.xcodeproj -scheme InCalcBD \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -3
```
Expected: `** BUILD SUCCEEDED **`. Then launch + screenshot to prove the shell renders:
```bash
UDID=$(xcrun simctl list devices available | grep -m1 "iPhone 17 (" | grep -oE '[0-9A-F-]{36}')
xcrun simctl boot "$UDID" 2>/dev/null || true; xcrun simctl bootstatus "$UDID"
APP=$(find ./.build-xcode/Build/Products -name 'InCalcBD.app' -maxdepth 3 | head -1)
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.claudinglab.incalcbd
xcrun simctl io "$UDID" screenshot /tmp/incalcbd-shell.png && echo "screenshot OK"
```
Expected: app launches, a 5-tab bar (Loan/Deposit/DSCR/Compare/Settlement) is visible, each tab shows "Coming soon".

**Gotcha (record if hit):** if `path: .` fails to resolve the local package (the package dir == the project dir), try `xcodebuild -resolvePackageDependencies -project InCalcBD.xcodeproj -scheme InCalcBD` first; if still failing, the documented fallback is a committed `.xcodeproj` (note it in AGENT_LEARNINGS and proceed). CoreXLSX pulls XMLCoder + ZIPFoundation from GitHub on first resolve — network is needed once.

- [ ] **Step 5: Commit**
```bash
git add project.yml .gitignore App Shared
git commit -m "feat(ios): XcodeGen app project + 5-tab shell (placeholders) for InCalc BD"
```

---

### Task 2: Design system — Theme + surfaces + the Loan input primitive

**Files:** Create `DesignSystem/Theme.swift`, `SurfaceCard.swift`, `MetricCard.swift`, `LabeledSlider.swift`, `BDTField.swift`, `Chip.swift`, `ChartStyle.swift`.

One agent builds the whole system so tokens cohere (standard model; pattern/design work). Every component carries a `#Preview` so the reviewer can see it. **Palette values are verbatim from the web — do not invent colors.**

- [ ] **Step 1: `Theme.swift`** — tokens + dynamic light/dark colors + native fonts

```swift
// DesignSystem/Theme.swift
import SwiftUI

extension Color {
    /// Hex "RRGGBB" → Color (sRGB). No alpha; use .opacity for translucency tokens.
    init(hex: String) {
        let s = Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")))
        var v: UInt64 = 0; s.scanHexInt64(&v)
        self = Color(.sRGB,
                     red: Double((v >> 16) & 0xff) / 255,
                     green: Double((v >> 8) & 0xff) / 255,
                     blue: Double(v & 0xff) / 255)
    }
    /// Resolves light/dark from the system trait at render time (no manual toggle — spec §3).
    static func dynamic(_ light: Color, _ dark: Color) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}

/// Design tokens. Colours mirror the web `:root` (light) / `html.dark-mode` (dark) blocks verbatim.
enum Theme {
    enum Colors {
        static let bg       = Color.dynamic(Color(hex: "f5f5f0"), Color(hex: "1e2024"))
        static let surface  = Color.dynamic(Color(hex: "ffffff"), Color(hex: "282a2e"))
        static let surface2 = Color.dynamic(Color(hex: "eceae5"), Color(hex: "32353a"))
        static let text     = Color.dynamic(Color(hex: "1a1a18"), Color(hex: "edecea"))
        static let muted    = Color.dynamic(Color(hex: "6b6965"), Color(hex: "b2afa8"))
        static let dim      = Color.dynamic(Color(hex: "6b665f"), Color(hex: "a5a098"))
        static let accent   = Color.dynamic(Color(hex: "2060b0"), Color(hex: "60a0f0"))
        static let accent2  = Color.dynamic(Color(hex: "1a6a9a"), Color(hex: "50b8e0")) // teal — Principal
        static let warn     = Color.dynamic(Color(hex: "c04030"), Color(hex: "f07060")) // red — Interest
        static let amber    = Color.dynamic(Color(hex: "955a00"), Color(hex: "f0a040")) // prepay
        static let border   = Color.dynamic(.black.opacity(0.08), .white.opacity(0.07))
        static let border2  = Color.dynamic(.black.opacity(0.15), .white.opacity(0.13))
        static let chartGrid = Color.dynamic(.black.opacity(0.06), .white.opacity(0.04))
    }
    enum Space { static let xs: CGFloat = 4, sm = 8, md = 12, lg = 16, xl = 24, xxl = 32 }
    enum Radius { static let base: CGFloat = 10, lg = 16 }
    enum Fonts {
        /// Every financial figure (web used DM Mono → native SF Mono).
        static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight, design: .monospaced)
        }
        /// Section/card titles (web used Fraunces italic → native New York italic).
        static func serifItalic(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight, design: .serif)
        }
        /// Body / labels (web used DM Sans → native SF Pro).
        static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight)
        }
    }
}
```

- [ ] **Step 2: `SurfaceCard.swift`** — elevated container

```swift
// DesignSystem/SurfaceCard.swift
import SwiftUI

/// Elevated surface used to group inputs and result clusters.
struct SurfaceCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(Theme.Space.lg)
            .background(Theme.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.border, lineWidth: 1))
    }
}

#Preview {
    SurfaceCard { Text("Surface").font(Theme.Fonts.sans(16)) }.padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 3: `MetricCard.swift`** — labelled result tile (the metric/EAR grid cell)

```swift
// DesignSystem/MetricCard.swift
import SwiftUI

/// A labelled value tile. `value` is pre-formatted (e.g. "৳12,34,567" or "9.250%").
/// `accent` tints the value (Principal=teal, Interest=red, etc.); nil = primary text.
struct MetricCard: View {
    let label: String
    let value: String
    var sublabel: String? = nil
    var accent: Color? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(label.uppercased())
                .font(Theme.Fonts.sans(11, .semibold)).foregroundStyle(Theme.Colors.muted)
            Text(value)
                .font(Theme.Fonts.mono(20, .medium)).foregroundStyle(accent ?? Theme.Colors.text)
                .minimumScaleFactor(0.6).lineLimit(1)
            if let sublabel {
                Text(sublabel).font(Theme.Fonts.sans(11)).foregroundStyle(Theme.Colors.dim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Space.md)
        .background(Theme.Colors.surface2)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base, style: .continuous))
    }
}

#Preview {
    HStack {
        MetricCard(label: "Monthly EMI", value: "৳12,668", sublabel: "Standard payment")
        MetricCard(label: "Total interest", value: "৳5,20,160", sublabel: "Cost of borrowing", accent: Theme.Colors.warn)
    }.padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 4: `LabeledSlider.swift`** — the Loan input primitive (label + live formatted readout + slider)

```swift
// DesignSystem/LabeledSlider.swift
import SwiftUI

/// A labelled slider with a formatted readout on the right. The Loan tab's input workhorse.
/// `format` turns the bound value into its readout string (e.g. Money.fmt or "%.2f%%").
struct LabeledSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let format: (Double) -> String
    var tint: Color = Theme.Colors.accent

    var body: some View {
        VStack(spacing: Theme.Space.xs) {
            HStack {
                Text(label).font(Theme.Fonts.sans(13)).foregroundStyle(Theme.Colors.muted)
                Spacer()
                Text(format(value)).font(Theme.Fonts.mono(15, .medium)).foregroundStyle(Theme.Colors.text)
            }
            Slider(value: $value, in: range, step: step).tint(tint)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
        .accessibilityValue(format(value))
    }
}

#Preview {
    @Previewable @State var v = 1_000_000.0
    LabeledSlider(label: "Loan amount", value: $v, range: 50_000...50_000_000, step: 50_000,
                  format: { "৳" + String(Int($0)) })
        .padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 5: `BDTField.swift` + `Chip.swift`** — built for Plan-4 reuse (Settlement/Deposit typed entry). NOT used by Loan; each gets a `#Preview` so it's verified now.

```swift
// DesignSystem/BDTField.swift
import SwiftUI

/// ৳ decimal-keypad money field. Reserved for Plan-4 tabs (Settlement/Deposit) that need typed entry.
/// Parses grouped input leniently; emits a Double via the binding.
struct BDTField: View {
    let label: String
    @Binding var value: Double
    @FocusState private var focused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(label).font(Theme.Fonts.sans(13)).foregroundStyle(Theme.Colors.muted)
            HStack(spacing: Theme.Space.xs) {
                Text("৳").font(Theme.Fonts.mono(17)).foregroundStyle(Theme.Colors.dim)
                TextField("0", value: $value, format: .number)
                    .keyboardType(.decimalPad).focused($focused)
                    .font(Theme.Fonts.mono(17, .medium))
            }
            .padding(Theme.Space.md)
            .background(Theme.Colors.surface2)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base, style: .continuous)
                .stroke(focused ? Theme.Colors.accent : Theme.Colors.border, lineWidth: 1))
        }
    }
}

#Preview {
    @Previewable @State var v = 500_000.0
    BDTField(label: "Amount", value: $v).padding().background(Theme.Colors.bg)
}
```

```swift
// DesignSystem/Chip.swift
import SwiftUI

/// Quick-pick chip. Reserved for Plan-4 preset selection. Selected state uses the accent fill.
struct Chip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.Fonts.mono(13, .medium))
                .padding(.horizontal, Theme.Space.md).padding(.vertical, Theme.Space.sm)
                .background(isSelected ? Theme.Colors.accent : Theme.Colors.surface2)
                .foregroundStyle(isSelected ? Color.white : Theme.Colors.text)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    HStack { Chip(title: "5y", isSelected: false) {}; Chip(title: "10y", isSelected: true) {} }
        .padding().background(Theme.Colors.bg)
}
```

- [ ] **Step 6: `ChartStyle.swift`** — shared Swift Charts styling for the payoff chart

```swift
// DesignSystem/ChartStyle.swift
import SwiftUI

/// Shared styling constants for the Loan payoff chart (and future tab charts), so chart look
/// lives in the design system, not inline in a view.
enum ChartStyle {
    static let principal = Theme.Colors.accent2          // teal bars
    static let interest  = Theme.Colors.warn             // red bars
    static let balance   = Theme.Colors.dim              // grey balance line
    static let prepay    = Theme.Colors.amber            // amber dashed prepay line
    static let height: CGFloat = 260
    static let barColorScale: KeyValuePairs<String, Color> = ["Principal": principal, "Interest": interest]
}
```

- [ ] **Step 7: Build + verify previews compile, then commit**
```bash
xcodebuild build -project InCalcBD.xcodeproj -scheme InCalcBD \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -3
```
Expected: `** BUILD SUCCEEDED **`. (Generated project already includes the new `DesignSystem/` files via the `sources: [DesignSystem]` glob; if a new file isn't picked up, re-run `xcodegen generate`.)
```bash
git add DesignSystem && git commit -m "feat(ios): native design system — Theme, surfaces, LabeledSlider, ChartStyle"
```

---

### Task 3: `LoanViewModel` + tests (the wiring, parity-critical)

**Files:** Create `Features/Loan/LoanViewModel.swift`, `Tests/AppTests/LoanViewModelTests.swift`.

**Most capable model** — this is where web parity is wired and the EAR gate / dynamic CS max / persistence live. TDD: write the test first, watch it fail, implement.

- [ ] **Step 1: Failing tests** — assert the ViewModel reproduces exact engine numbers + correct gating + persistence

```swift
// Tests/AppTests/LoanViewModelTests.swift
import XCTest
import InCalcEngine
@testable import InCalcBD

@MainActor
final class LoanViewModelTests: XCTestCase {
    private func vm(_ suite: String = #function) -> LoanViewModel {
        let d = UserDefaults(suiteName: suite)!; d.removePersistentDomain(forName: suite)
        return LoanViewModel(defaults: d)
    }

    // Wiring: defaults must match the web Loan defaults and the engine's numbers, not re-derived math.
    func test_defaultMetrics_matchEngine() {
        let m = vm()
        let base = Loan.buildSchedule(principal: 1_000_000, annualRatePct: 9, years: 10, extraMonthly: 0)
        XCTAssertEqual(m.emi, base.emi, accuracy: 1e-9)
        XCTAssertEqual(m.totalInterest, base.totalInterest, accuracy: 1e-9)
        XCTAssertEqual(m.totalPaid, base.totalPaid, accuracy: 1e-9)
        XCTAssertEqual(m.emiText, Money.fmt(base.emi))            // displayed rounded via Money.fmt
        XCTAssertEqual(m.interestRatioText, String(format: "%.1f%%", base.totalInterest / 1_000_000 * 100))
    }

    // EAR gate: hidden with no advance EMI / cash security; shown (and correct) once present.
    func test_earGate() {
        let m = vm()
        XCTAssertFalse(m.showsEAR)                                 // advEMI=0, cs=0
        m.advanceEMIs = 2
        XCTAssertTrue(m.showsEAR)
        let base = Loan.buildSchedule(principal: 1_000_000, annualRatePct: 9, years: 10, extraMonthly: 0)
        let eff = Loan.effectiveRate(principal: 1_000_000, nominalRatePct: 9, years: 10, emi: base.emi,
                                     advanceEMIs: 2, cashSecurity: 0, csAnnualRatePct: 0)!
        XCTAssertEqual(m.effectiveRateText, String(format: "%.3f%%", eff.effectiveRate))
    }

    // EAR hides when netDisbursement <= 0 (advance EMIs + CS consume the whole principal).
    func test_earHidesWhenNetDisbNonPositive() {
        let m = vm(); m.advanceEMIs = 12; m.cashSecurity = 50_000_000  // (clamped, but pushes netDisb<=0)
        // With principal 1,000,000 and CS clamped to 500,000 + 12 advance EMIs, netDisb may still be >0;
        // force the degenerate case explicitly:
        m.principal = 50_000; m.advanceEMIs = 12
        XCTAssertFalse(m.showsEAR)
    }

    // Cash-security dynamic max = round(P*0.5), capped 5,000,000; raising P then lowering snaps CS down.
    func test_cashSecurityDynamicMax() {
        let m = vm()
        m.principal = 1_000_000; m.cashSecurity = 900_000
        XCTAssertEqual(m.cashSecurity, 500_000)                    // clamped to round(P*0.5)
        XCTAssertEqual(m.cashSecurityMax, 500_000)
    }

    // Prepay savings compares against the same loan with extra=0.
    func test_prepaySavings() {
        let m = vm(); m.extraMonthly = 5_000
        let base = Loan.buildSchedule(principal: 1_000_000, annualRatePct: 9, years: 10, extraMonthly: 0)
        let wp   = Loan.buildSchedule(principal: 1_000_000, annualRatePct: 9, years: 10, extraMonthly: 5_000)
        XCTAssertTrue(m.showsSavings)
        XCTAssertEqual(m.monthsSaved, base.totalMonths - wp.totalMonths)
        XCTAssertEqual(m.interestSavedText, Money.fmt(base.totalInterest - wp.totalInterest))
    }

    // Persistence: a new VM on the same suite reopens where the user left off.
    func test_persistsAcrossInstances() {
        let suite = #function; let d = UserDefaults(suiteName: suite)!; d.removePersistentDomain(forName: suite)
        let a = LoanViewModel(defaults: d); a.principal = 2_500_000; a.termYears = 7
        let b = LoanViewModel(defaults: d)
        XCTAssertEqual(b.principal, 2_500_000); XCTAssertEqual(b.termYears, 7)
    }
}
```

- [ ] **Step 2: Run — FAIL** (`cannot find 'LoanViewModel'`)
```bash
xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode \
  -only-testing:AppTests/LoanViewModelTests 2>&1 | tail -15
```

- [ ] **Step 3: Implement `LoanViewModel`** — `@Observable`, injected `UserDefaults`, all inputs persisted, all derived values via the engine

```swift
// Features/Loan/LoanViewModel.swift
import Foundation
import Observation
import InCalcEngine

@MainActor
@Observable
final class LoanViewModel {
    @ObservationIgnored private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    // MARK: Persisted inputs (UserDefaults-backed; web defaults).
    var principal: Double {
        get { read(K.principal, 1_000_000) } set { write(K.principal, clampPrincipal(newValue)) ; clampCS() }
    }
    var annualRatePct: Double { get { read(K.rate, 9) }  set { write(K.rate, newValue) } }
    var termYears: Int        { get { Int(read(K.term, 10)) } set { write(K.term, Double(newValue)) } }
    var extraMonthly: Double  { get { read(K.extra, 0) } set { write(K.extra, newValue) } }
    var advanceEMIs: Int      { get { Int(read(K.adv, 0)) } set { write(K.adv, Double(newValue)) } }
    var csRatePct: Double     { get { read(K.csRate, 0) } set { write(K.csRate, newValue) } }
    /// Cash security, clamped to the dynamic max on read AND write (web snaps it down each calc).
    var cashSecurity: Double {
        get { min(read(K.cs, 0), cashSecurityMax) }
        set { write(K.cs, min(newValue, cashSecurityMax)) }
    }

    // MARK: Input bounds (mirror the web sliders).
    let principalRange: ClosedRange<Double> = 50_000...50_000_000
    let rateRange: ClosedRange<Double> = 1...25
    let termRange: ClosedRange<Int> = 1...30
    let extraRange: ClosedRange<Double> = 0...100_000
    let csRateRange: ClosedRange<Double> = 0...15
    /// Dynamic CS max = round(P*0.5), capped at 5,000,000 (web index.html:1804).
    var cashSecurityMax: Double { min(5_000_000, (principal * 0.5).rounded()) }

    // MARK: Derived — the base (no-prepay) schedule and the optional with-prepay schedule.
    private var base: Loan.Schedule { Loan.buildSchedule(principal: principal, annualRatePct: annualRatePct, years: termYears, extraMonthly: 0) }
    private var withPrepay: Loan.Schedule? {
        extraMonthly > 0 ? Loan.buildSchedule(principal: principal, annualRatePct: annualRatePct, years: termYears, extraMonthly: extraMonthly) : nil
    }

    // Raw metric values (for tests / chart / table).
    var emi: Double { base.emi }
    var totalInterest: Double { base.totalInterest }
    var totalPaid: Double { base.totalPaid }
    var interestRatio: Double { principal > 0 ? base.totalInterest / principal * 100 : 0 }

    // Formatted metric strings (for the View).
    var emiText: String { Money.fmt(base.emi) }
    var totalInterestText: String { Money.fmt(base.totalInterest) }
    var totalPaidText: String { Money.fmt(base.totalPaid) }
    var interestRatioText: String { String(format: "%.1f%%", interestRatio) }

    // Principal / interest split for the breakdown bar.
    var principalPct: Int { base.totalPaid > 0 ? Int((principal / base.totalPaid * 100).rounded()) : 0 }
    var interestPct: Int { 100 - principalPct }

    // MARK: Prepay savings (shown only when extraMonthly > 0).
    var showsSavings: Bool { withPrepay != nil }
    var monthsSaved: Int { (withPrepay.map { base.totalMonths - $0.totalMonths }) ?? 0 }
    var interestSavedText: String { Money.fmt((withPrepay.map { base.totalInterest - $0.totalInterest }) ?? 0) }
    var newPayoffText: String {
        guard let wp = withPrepay else { return "" }
        return "\(wp.totalMonths / 12)y \(wp.totalMonths % 12)m"
    }

    // MARK: EAR — two-gated: (advEMI>0 || cs>0) AND engine returns non-nil with rate>0.
    private var ear: Loan.EffectiveRate? {
        guard advanceEMIs > 0 || cashSecurity > 0 else { return nil }
        guard let e = Loan.effectiveRate(principal: principal, nominalRatePct: annualRatePct, years: termYears,
                                         emi: base.emi, advanceEMIs: advanceEMIs, cashSecurity: cashSecurity,
                                         csAnnualRatePct: csRatePct), e.effectiveRate > 0 else { return nil }
        return e
    }
    var showsEAR: Bool { ear != nil }
    var effectiveRateText: String { ear.map { String(format: "%.3f%%", $0.effectiveRate) } ?? "" }
    var netDisbursementText: String { ear.map { Money.fmt($0.netDisbursement) } ?? "" }
    var rateMarkupText: String { ear.map { "+" + String(format: "%.3f%%", $0.rateMarkup) } ?? "" }
    var csInterestText: String { ear.map { Money.fmt($0.csInterest) } ?? "" }

    // MARK: Chart + table data (yearly rows; prepay overlay aligned by year).
    struct YearPoint: Identifiable { let id = UUID(); let year: Int; let principalPaid, interestPaid, balance: Double; let prepayBalance: Double? }
    var chartPoints: [YearPoint] {
        base.rows.map { r in
            YearPoint(year: r.year, principalPaid: r.principal, interestPaid: r.interest, balance: r.close,
                      prepayBalance: withPrepay?.rows.first { $0.year == r.year }?.close)
        }
    }
    struct TableRow: Identifiable { let id = UUID(); let year: Int; let open, principal, interest, close: Double; let prepayDelta: Double? }
    var tableRows: [TableRow] {
        base.rows.map { r in
            let wpRow = withPrepay?.rows.first { $0.year == r.year }
            let delta = wpRow.map { $0.principal - r.principal }.flatMap { $0 > 0 ? $0 : nil }
            return TableRow(year: r.year, open: r.open, principal: r.principal, interest: r.interest, close: r.close, prepayDelta: delta)
        }
    }

    // MARK: Insight (two web templates).
    var insightText: String {
        if let wp = withPrepay {
            return "Adding \(Money.fmt(extraMonthly))/mo saves \(Money.fmt(base.totalInterest - wp.totalInterest)) in interest and cuts \(base.totalMonths - wp.totalMonths) months off your loan."
        }
        let doubling = annualRatePct > 0 ? 72 / annualRatePct : 0
        return "At \(String(format: "%g", annualRatePct))%, debt doubles every ~\(String(format: "%.1f", doubling)) yrs. You pay \(String(format: "%.0f", interestRatio))% of the principal in interest over \(termYears) years."
    }

    // MARK: storage plumbing
    private func clampPrincipal(_ v: Double) -> Double { min(max(v, principalRange.lowerBound), principalRange.upperBound) }
    private func clampCS() { let v = min(read(K.cs, 0), cashSecurityMax); write(K.cs, v) }
    private func read(_ k: String, _ fallback: Double) -> Double {
        access(keyPath: \LoanViewModel.storageTick)
        return defaults.object(forKey: k) as? Double ?? fallback
    }
    private func write(_ k: String, _ v: Double) {
        withMutation(keyPath: \LoanViewModel.storageTick) { defaults.set(v, forKey: k) }
    }
    /// A single observable "tick" so any persisted-input change re-renders the View (all reads access it).
    @ObservationIgnored private var _tick = 0
    private var storageTick: Int { _tick }

    private enum K {
        static let principal = "loan.principal", rate = "loan.rate", term = "loan.term",
                   extra = "loan.extra", adv = "loan.adv", cs = "loan.cs", csRate = "loan.csRate"
    }
}
```

> **Implementer note on Observation:** the `storageTick` keyPath funnels every persisted read/write through one observable property so SwiftUI re-renders on any input change while the values themselves live in `UserDefaults`. If the reviewer prefers per-key `access/withMutation`, that is acceptable too — the test for reactivity is that changing a slider updates the metric cards on the simulator (verified in Task 4). Keep the public property surface identical to what the tests call.

- [ ] **Step 4: Run — PASS**
```bash
xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode \
  -only-testing:AppTests/LoanViewModelTests 2>&1 | tail -8
```
Expected: `Test Suite 'LoanViewModelTests' passed`. If a numeric assert fails, the ViewModel is wrong (engine is golden) — reconcile against the web parity table above, never edit the engine.

- [ ] **Step 5: Commit**
```bash
git add Features/Loan/LoanViewModel.swift Tests/AppTests/LoanViewModelTests.swift
git commit -m "feat(ios): LoanViewModel wiring inputs→engine with EAR gate, dynamic CS max, persistence"
```

---

### Task 4: `LoanView` — the screen (inputs, metric cards, EAR, chart, table) + wire into the tab

**Files:** Create `Features/Loan/LoanView.swift`; Modify `App/RootTabView.swift` (Loan tab → `LoanView()`).

**Most capable model** — composition + design quality + Swift Charts. Compose design-system components (no raw `Form`). Verify by building, testing, AND launching on the simulator with light+dark screenshots.

- [ ] **Step 1: Implement `LoanView`**

```swift
// Features/Loan/LoanView.swift
import SwiftUI
import Charts
import InCalcEngine

struct LoanView: View {
    @State private var vm = LoanViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Space.lg) {
                    inputs
                    metrics
                    breakdownBar
                    if vm.showsSavings { savings }
                    if vm.showsEAR { earGrid }
                    payoffChart
                    amortizationTable
                    insight
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.Colors.bg)
            .navigationTitle("Loan")
        }
    }

    // Sliders (web-faithful) + advance-EMI picker.
    private var inputs: some View {
        SurfaceCard {
            VStack(spacing: Theme.Space.md) {
                LabeledSlider(label: "Loan amount", value: $vm.principal, range: vm.principalRange, step: 50_000, format: Money.fmt)
                LabeledSlider(label: "Annual interest rate", value: $vm.annualRatePct, range: vm.rateRange, step: 0.25, format: { String(format: "%.2f%%", $0) })
                LabeledSlider(label: "Loan tenure", value: Binding(get: { Double(vm.termYears) }, set: { vm.termYears = Int($0) }),
                              range: Double(vm.termRange.lowerBound)...Double(vm.termRange.upperBound), step: 1,
                              format: { "\(Int($0)) year\(Int($0) > 1 ? "s" : "")" })
                LabeledSlider(label: "Extra monthly payment", value: $vm.extraMonthly, range: vm.extraRange, step: 500, format: Money.fmt, tint: Theme.Colors.amber)
                Picker("Advance EMI deposits", selection: $vm.advanceEMIs) {
                    ForEach(0...12, id: \.self) { Text($0 == 0 ? "None" : "\($0) EMI\($0 > 1 ? "s" : "")").tag($0) }
                }.pickerStyle(.menu).font(Theme.Fonts.sans(13))
                LabeledSlider(label: "Cash security amount", value: $vm.cashSecurity, range: 0...vm.cashSecurityMax, step: 10_000, format: Money.fmt)
                LabeledSlider(label: "Cash security rate", value: $vm.csRatePct, range: vm.csRateRange, step: 0.25, format: { String(format: "%.2f%%", $0) })
                HStack {
                    Text("Cash security tenor").font(Theme.Fonts.sans(13)).foregroundStyle(Theme.Colors.muted)
                    Spacer()
                    Text("\(vm.termYears) year\(vm.termYears > 1 ? "s" : "") (auto-matched)").font(Theme.Fonts.mono(13)).foregroundStyle(Theme.Colors.dim)
                }
            }
        }
    }

    private var metrics: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Theme.Space.md) {
            MetricCard(label: "Monthly EMI", value: vm.emiText, sublabel: "Standard payment", accent: Theme.Colors.accent)
            MetricCard(label: "Total interest", value: vm.totalInterestText, sublabel: "Cost of borrowing", accent: Theme.Colors.warn)
            MetricCard(label: "Total repayment", value: vm.totalPaidText, sublabel: "Principal + interest")
            MetricCard(label: "Interest ratio", value: vm.interestRatioText, sublabel: "Interest as % of loan")
        }
    }

    private var breakdownBar: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle().fill(Theme.Colors.accent2).frame(width: geo.size.width * CGFloat(vm.principalPct) / 100)
                    Rectangle().fill(Theme.Colors.warn)
                }
            }.frame(height: 10).clipShape(Capsule())
            HStack {
                Text("Principal \(vm.principalPct)%").font(Theme.Fonts.sans(11)).foregroundStyle(Theme.Colors.accent2)
                Spacer()
                Text("Interest \(vm.interestPct)%").font(Theme.Fonts.sans(11)).foregroundStyle(Theme.Colors.warn)
            }
        }
    }

    private var savings: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Prepayment savings").font(Theme.Fonts.serifItalic(16, .semibold)).foregroundStyle(Theme.Colors.amber)
                HStack {
                    MetricCard(label: "Interest saved", value: vm.interestSavedText, accent: Theme.Colors.amber)
                    MetricCard(label: "Months saved", value: "\(vm.monthsSaved) mo")
                    MetricCard(label: "New payoff", value: vm.newPayoffText)
                }
            }
        }
    }

    private var earGrid: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Effective annual rate").font(Theme.Fonts.serifItalic(16, .semibold)).foregroundStyle(Theme.Colors.accent2)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Theme.Space.md) {
                    MetricCard(label: "Effective annual rate", value: vm.effectiveRateText, sublabel: "Compounded (EAR)", accent: Theme.Colors.warn)
                    MetricCard(label: "Net disbursement", value: vm.netDisbursementText, sublabel: "Actual amount received", accent: Theme.Colors.accent2)
                    MetricCard(label: "Rate markup", value: vm.rateMarkupText, sublabel: "Effective minus nominal", accent: Theme.Colors.warn)
                    MetricCard(label: "CS interest earned", value: vm.csInterestText, sublabel: "On cash security deposit", accent: Theme.Colors.accent2)
                }
            }
        }
    }

    private var payoffChart: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Payoff schedule").font(Theme.Fonts.serifItalic(16, .semibold)).foregroundStyle(Theme.Colors.text)
                Chart {
                    ForEach(vm.chartPoints) { p in
                        BarMark(x: .value("Year", p.year), y: .value("Amount", p.principalPaid))
                            .foregroundStyle(by: .value("Component", "Principal"))
                        BarMark(x: .value("Year", p.year), y: .value("Amount", p.interestPaid))
                            .foregroundStyle(by: .value("Component", "Interest"))
                    }
                    ForEach(vm.chartPoints) { p in
                        LineMark(x: .value("Year", p.year), y: .value("Balance", p.balance), series: .value("Series", "Balance"))
                            .foregroundStyle(ChartStyle.balance).lineStyle(StrokeStyle(lineWidth: 2)).interpolationMethod(.catmullRom)
                    }
                    ForEach(vm.chartPoints.filter { $0.prepayBalance != nil }) { p in
                        LineMark(x: .value("Year", p.year), y: .value("Balance", p.prepayBalance!), series: .value("Series", "With prepay"))
                            .foregroundStyle(ChartStyle.prepay).lineStyle(StrokeStyle(lineWidth: 2, dash: [5, 3])).interpolationMethod(.catmullRom)
                    }
                }
                .chartForegroundStyleScale(ChartStyle.barColorScale)
                .chartXAxis { AxisMarks { v in AxisValueLabel { if let y = v.as(Int.self) { Text("Yr \(y)").font(Theme.Fonts.mono(9)) } } } }
                .chartYAxis { AxisMarks(position: .leading) { _ in AxisGridLine().foregroundStyle(Theme.Colors.chartGrid); AxisValueLabel() } }
                .chartLegend(position: .bottom)
                .frame(height: ChartStyle.height)
            }
        }
    }

    private var amortizationTable: some View {
        SurfaceCard {
            VStack(spacing: 0) {
                tableHeader
                ForEach(vm.tableRows) { r in tableRow(r); Divider().overlay(Theme.Colors.border) }
            }
        }
    }
    private var tableHeader: some View {
        HStack {
            cell("Year", .leading, Theme.Colors.muted); cell("Opening", .trailing, Theme.Colors.muted)
            cell("Principal", .trailing, Theme.Colors.muted); cell("Interest", .trailing, Theme.Colors.muted)
            cell("Closing", .trailing, Theme.Colors.muted)
        }.font(Theme.Fonts.sans(10, .semibold)).padding(.vertical, Theme.Space.xs)
    }
    private func tableRow(_ r: LoanViewModel.TableRow) -> some View {
        HStack {
            cell("\(r.year)", .leading, Theme.Colors.text)
            cell(Money.fmt(r.open), .trailing, Theme.Colors.text)
            VStack(alignment: .trailing, spacing: 0) {
                Text(Money.fmt(r.principal)).foregroundStyle(Theme.Colors.accent2)
                if let d = r.prepayDelta { Text("+\(Money.fmt(d))").font(Theme.Fonts.mono(9)).foregroundStyle(Theme.Colors.amber) }
            }.frame(maxWidth: .infinity, alignment: .trailing)
            cell(Money.fmt(r.interest), .trailing, Theme.Colors.warn)
            cell(Money.fmt(r.close), .trailing, Theme.Colors.text)
        }.font(Theme.Fonts.mono(11)).padding(.vertical, Theme.Space.xs)
    }
    private func cell(_ s: String, _ align: Alignment, _ color: Color) -> some View {
        Text(s).foregroundStyle(color).frame(maxWidth: .infinity, alignment: align)
    }

    private var insight: some View {
        Text(vm.insightText).font(Theme.Fonts.serifItalic(14)).foregroundStyle(Theme.Colors.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(Theme.Space.md)
            .background(Theme.Colors.surface2).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base, style: .continuous))
    }
}

#Preview { LoanView() }
```

- [ ] **Step 2: Wire the tab** — in `App/RootTabView.swift`, replace the Loan placeholder:
```swift
// was: PlaceholderTab(title: "Loan", systemImage: "banknote")
LoanView()
    .tabItem { Label("Loan", systemImage: "banknote") }
```
(Remove the old `.tabItem` that was attached to the Loan `PlaceholderTab`; keep the other four placeholders unchanged.)

- [ ] **Step 3: Build + run the full app test suite**
```bash
xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -6
```
Expected: BUILD SUCCEEDED, `LoanViewModelTests` green.

- [ ] **Step 4: Launch + light/dark screenshots (visual gate)**
```bash
UDID=$(xcrun simctl list devices available | grep -m1 "iPhone 17 (" | grep -oE '[0-9A-F-]{36}')
xcrun simctl boot "$UDID" 2>/dev/null || true; xcrun simctl bootstatus "$UDID"
APP=$(find ./.build-xcode/Build/Products -name 'InCalcBD.app' -maxdepth 3 | head -1)
xcrun simctl install "$UDID" "$APP"; xcrun simctl launch "$UDID" com.claudinglab.incalcbd
xcrun simctl ui "$UDID" appearance light; sleep 1; xcrun simctl io "$UDID" screenshot /tmp/loan-light.png
xcrun simctl ui "$UDID" appearance dark;  sleep 1; xcrun simctl io "$UDID" screenshot /tmp/loan-dark.png
echo "screenshots: /tmp/loan-light.png /tmp/loan-dark.png"
```
Confirm: Loan tab renders inputs, four metric cards with sensible default figures (EMI ≈ ৳12,668 for the 10y/9%/10L default — verify it equals `Money.fmt(base.emi)`), a chart, a table; no console errors; both appearances legible. **Surface these two screenshots to the owner** (they are the human visual-fidelity gate).

- [ ] **Step 5: Commit**
```bash
git add Features/Loan/LoanView.swift App/RootTabView.swift
git commit -m "feat(ios): Loan tab — sliders, metric cards, EAR, payoff chart, amortization table"
```

---

### Task 5: Polish, governance, and final gate

**Files:** Modify `AGENTS.md`, `AGENT_LEARNINGS.md`, `README.md` (incalc-ios).

Standard model. Lock in the design-drift landmine and the build flow, run the full gate, final review, open the PR.

- [ ] **Step 1: Placeholder + navigation sanity** — on the running simulator, tap each of the four placeholder tabs; confirm each shows "Coming soon" and the tab bar navigates without crashing. (No code change expected; if a tab crashes, fix in this task.)

- [ ] **Step 2: `AGENTS.md`** — add an app section + landmines:
  - New structure: `App/`, `DesignSystem/`, `Features/`, `Shared/`, `Tests/AppTests/`; `project.yml` is the source of truth, `.xcodeproj` is generated + gitignored.
  - Build flow: `xcodegen generate` → `xcodebuild build/test -project InCalcBD.xcodeproj -scheme InCalcBD -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode`. The only installed sim runtime is **iOS 26.5**; deploy target is iOS 17.
  - **Landmine — design drift:** Plan-4 tabs (Deposit/DSCR/Compare/Settlement) MUST reuse `Theme` + the `DesignSystem/` components; do NOT introduce new colors/spacing or restyle. Add new tokens to `Theme`, not inline.
  - **Landmine — ViewModel persistence:** inputs persist via `@Observable` + injected `UserDefaults` (NOT `@AppStorage`, which cannot live in a non-View type). Tests inject a `UserDefaults(suiteName:)`.
  - **Landmine — parity:** EMI computed unrounded; CS max = `round(P*0.5)` capped 5M; EAR two-gated; tenure in years. Numbers come from `InCalcEngine` only.

- [ ] **Step 3: `README.md`** — short "Running the app" section with the generate/build/test/screenshot commands above.

- [ ] **Step 4: `AGENT_LEARNINGS.md`** — append any incident from this build (e.g. if `path: .` package resolution needed a workaround, or a Swift 6 `@MainActor` issue). If nothing bit, add a one-line note that Plan 3 shipped clean. Use the file's Trigger/What went wrong/Lesson/Prevention template.

- [ ] **Step 5: Full gate** (everything green, including the pre-existing engine/import suites)
```bash
cd ~/Projects/incalc-ios
xcodegen generate
xcodebuild test -project InCalcBD.xcodeproj -scheme InCalcBD \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ./.build-xcode 2>&1 | tail -4
swift test 2>&1 | tail -4    # InCalcEngine + InCalcExcelImport must still be green (untouched by Plan 3)
```
Expected: app tests pass; `swift test` reports all engine/import tests passing.

- [ ] **Step 6: Commit governance**
```bash
git add AGENTS.md AGENT_LEARNINGS.md README.md
git commit -m "docs(ios): app build flow + design-drift/persistence landmines for Plan 3"
```

- [ ] **Step 7: Final review + PR** — after the controller's final whole-implementation code review, push and open the PR:
```bash
git push -u origin feat/plan3-ui-loan
gh pr create --title "Plan 3: app foundation + Loan reference tab (InCalc BD)" \
  --body "$(cat <<'EOF'
Plan 3 of the InCalc BD iOS port: runnable app + native design system + the Loan tab, end to end.

## What's here
- XcodeGen app project (`project.yml`; `.xcodeproj` gitignored) — app + AppTests targets, 5-tab shell.
- Native design system (Theme light/dark mirroring the web palette, SurfaceCard, MetricCard, LabeledSlider, BDTField, Chip, ChartStyle). SF Mono figures / New York titles / SF Pro body.
- Loan tab: web-faithful sliders → `InCalcEngine.Loan` → metric cards, prepay savings, EAR (two-gated), Swift Charts payoff chart, amortization table.
- `LoanViewModel` (`@Observable` + injected UserDefaults) with `LoanViewModelTests` proving the wiring against the golden engine.

## Verification
- `xcodebuild test` green on the iPhone 17 (iOS 26.5) simulator; `swift test` (engine/import) still green.
- Light + dark simulator screenshots captured.

## Decisions (owner-locked)
- All-sliders Loan inputs (web-faithful); BDTField/Chip built for Plan-4 reuse.
- Native Apple fonts (no bundling).
- `@Observable` + UserDefaults (not `@AppStorage`).
EOF
)"
```

---

## Self-review (writing-plans checklist)

**1. Spec coverage** — App project + design system + 5-tab shell + Loan tab fully working: Tasks 1–4. Placeholder tabs: Task 1 + Task 5 Step 1. XcodeGen / `.xcodeproj` gitignored / `project.yml` committed: Task 1. View+ViewModel MVVM-lite, engine-only dependency, `@AppStorage`-intent persistence: Task 3. Polished native design system (not raw `Form`): Task 2 + Task 4. Verification gate (xcodegen → xcodebuild build/test on sim + ViewModel tests + light/dark screenshots + placeholder sanity): Tasks 1/3/4/5. Risks: XcodeGen install (present, verified) + `path: .` fallback noted (Task 1 Step 4); design drift → AGENTS landmine (Task 5); simulator availability (iPhone 17 / iOS 26.5 confirmed). Loan parity (inputs/defaults/ranges, metric cards EMI/interest/repayment/ratio, prepay savings, EAR two-gate, dynamic CS max, chart 4-series, table 5-col + prepay delta, insight): Tasks 3–4 against the verified web contract.

**2. Placeholder scan** — no "TBD/handle edge cases/similar to Task N". Every code step carries real code; the one judgment latitude (Observation tick vs per-key) is explicitly bounded with the public surface pinned.

**3. Type consistency** — `LoanViewModel` public surface used by tests = surface used by `LoanView` (`emi/emiText/totalInterestText/totalPaidText/interestRatioText`, `showsEAR/effectiveRateText/netDisbursementText/rateMarkupText/csInterestText`, `showsSavings/monthsSaved/interestSavedText/newPayoffText`, `principalPct/interestPct`, `chartPoints:[YearPoint]`, `tableRows:[TableRow]`, `cashSecurityMax`, ranges). Engine calls use the exact `Loan.buildSchedule(principal:annualRatePct:years:extraMonthly:)` / `Loan.effectiveRate(...)` / `Money.fmt` signatures verified in the source. `ChartStyle.barColorScale` consumed by `LoanView`. `project.yml` target/scheme name `InCalcBD` matches every `xcodebuild -scheme` invocation; bundle id `com.claudinglab.incalcbd` matches every `simctl launch`.

## Open items to confirm while executing
- **`path: .` local-package resolution** (Task 1 Step 4) — verify the products link before proceeding; fallback documented.
- **Observation reactivity** — the `storageTick` funnel must actually re-render the metric cards when a slider moves; the Task 4 simulator run is the real proof. If it doesn't update live, switch to per-key `access/withMutation` (public surface unchanged).
- **Default EMI sanity number** — confirm the rendered Monthly EMI for the 10L / 9% / 10y default equals `Money.fmt(Loan.buildSchedule(principal:1_000_000,annualRatePct:9,years:10,extraMonthly:0).emi)`; if the screenshot disagrees with the test, the View is reading the wrong property.
