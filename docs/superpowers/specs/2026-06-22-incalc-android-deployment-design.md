# InCalc — Android deployment design (2026-06-22)

## Goal

Ship **InCalc on the Google Play Store** as a genuinely native Android app that stands beside the live iOS app — not a webview wrapper. First release covers four calculators; the Excel-upload Settlement tab follows in v1.1.

This is a multi-phase port in the mould of the iOS one, owned in a new repo and governed by the same **web-first golden-vector parity contract** that keeps web and iOS bit-identical.

## Decisions (locked in brainstorming, 2026-06-22)

| Decision | Choice | Why |
|---|---|---|
| **Android approach** | **Native Kotlin / Jetpack Compose** | Owner chose a true native app over a TWA wrap. Accepted trade-off: InCalc becomes a **three-platform parity problem** (web → iOS Swift → Android Kotlin), enforced by the vector tests. |
| **Design language** | **Brand-consistent, natively Android** — Material 3 wearing InCalc's palette/identity | Reads as a real Android app, unmistakably InCalc; avoids the uncanny-iOS-clone look and lower-quality-clone review scrutiny. NOT a pixel-port of the iOS Liquid Glass UI; NOT Material You dynamic color (brand color must stay constant). |
| **v1.0 scope** | **Phased** — Loan, Deposit, DSCR, Compare in v1.0; Settlement in v1.1 | Four pure-calculator tabs reach the store fast and low-risk; the hardest Android-specific work (xlsx parse + file picker) is isolated into its own follow-up. |
| **Play Console owner** | `adnan.rshd@gmail.com` (personal account) | Owner's primary Google account; same personal-identity spirit as the iOS paid Apple team. |
| **Test hardware** | Emulator only (no physical Android device) | Dev/UAT on Android Studio AVD (Apple Silicon). All 12 closed-test testers recruited externally. |

## Architecture

### Repo & module layout

New repo **`clauding-lab/incalc-android`** (mirrors `clauding-lab/incalc-ios`). Gradle multi-module, Kotlin DSL:

```
incalc-android/
├── engine/                 # pure-Kotlin/JVM math — NO Android deps (fast JUnit tests)
│   └── src/test/resources/golden-vectors.json   # copied from the web repo
├── app/                    # Jetpack Compose UI module (depends on :engine)
├── AGENTS.md · VISION.md · AGENT_LEARNINGS.md    # governance trio, scaffolded at bootstrap
└── settings.gradle.kts
```

The split mirrors the proven iOS shape: a dependency-free engine the math lives in, and a UI module on top. The engine having **no Android imports** is what makes it unit-testable in milliseconds and keeps the math reviewable in isolation.

### Parity contract (extended to a third platform)

**Web is the source of truth.** Flow, identical in spirit to iOS:

```
change web calc → regenerate golden-vectors.json (web tools/) → copy into
engine/src/test/resources/ → mirror the math in Kotlin → ./gradlew test (all vectors green)
```

A change ships only when web, iOS, and Android all pass the same vectors. The Android test is the gate; nothing merges red.

## Phase decomposition

Each phase is its own spec → plan → implementation cycle. **This document designs the whole deployment and details Phase A1 (the engine), which we build first.**

| Phase | Delivers | Notes |
|---|---|---|
| **A1 — Engine** | Pure-Kotlin `:engine` (Loan, Deposit, DSCR, Compare) + golden-vector JUnit parity | Money-critical foundation. Built and proven green before any UI. |
| **A2 — App shell + design system + Loan** | Compose scaffold, Material 3 in InCalc tokens, light/dark, navy ৳, navigation, the Loan tab end-to-end | First visible app; establishes the design system the other tabs reuse. |
| **A3 — Deposit + DSCR + Compare** | The remaining three calculator tabs + charts (Vico) | Completes the v1.0 feature set. |
| **A4 — Play release (v1.0)** | Signing, AAB, Play Console, closed testing, store listing | → **v1.0 live (4 tabs)**. Gated by the 12-tester rule (see Release plan). |
| **A5 — Settlement (v1.1)** | Excel-upload IRR tab: xlsx parsing + Storage Access Framework file picker + Settlement vectors | → **v1.1**. Isolated because it carries the most Android-specific risk. |

## Phase A1 — Engine (detailed design)

### Modules (mirror the web `index.html` calc functions and the Swift `InCalcEngine`)

- **`Loan.kt`** — EMI, full amortization schedule, effective annual rate once advance instalments / cash security are factored in.
- **`Deposit.kt`** — FD / DPS / WDS / MBS / Custom. Carries every money-critical rule: FY2026-27 excise-duty slabs (`getED`, exemption ৳4L), source tax 10% (PSR filed) / 15% (not), **annual compounding** for FD/DPS/WDS/MBS, **deposit-date pro-rating** of recurring contributions, the **FD 2×/3× doubling-time solver**, and the **DPS/WDS `P=0` guard** (recurring schemes have no opening principal).
- **`Dscr.kt`** — DSCR / DBR coverage and burden.
- **`Compare.kt`** — two-scenario compare; reuses Loan + Deposit, adds no new math.
- **Shared** — money/format/rounding helpers (`fmt` equivalent), ED slab table with a fiscal-year comment.

`Settlement` (XIRR) is **out of scope for A1** — it ships in A5 with its own vectors.

### The one real risk: JS ↔ Kotlin numeric parity

Plainly: JavaScript and Kotlin do not round the same way by default, and a banking app cannot drift by a taka. The iOS port hit JS↔Swift rounding/range traps; Android will hit the JS↔Kotlin equivalents.

Mitigations:
- Use Kotlin **`Double`** (IEEE-754 binary64 — the same representation as a JS `Number`) for all interim math, so arithmetic matches the web bit-for-bit.
- Reproduce the web's **exact `fmt()` rounding** (the web rounds half-up toward +∞ via `Math.round`; Kotlin's `Math.round(Double)` matches this, but `roundToInt`/`BigDecimal.HALF_EVEN` do not — pick the matching mode deliberately, not by reflex).
- Mirror integer-grid behaviours exactly: the 3-month tenor grid, the `getED` slab boundaries (`<=` vs `<`), the 2×/3× solver's `Math.floor`/`Math.pow` stepping.
- The **1,228-vector golden test is the proof.** Any rounding trap surfaces as a red vector, not a production miscalculation.

### Parity harness

Copy the web repo's `golden-vectors.json` into `engine/src/test/resources/`. A JUnit (or Kotlin-test) suite deserializes every vector, runs the corresponding engine function, and asserts each output field equals the expected value exactly. Loan/Deposit/DSCR/Compare sections are in scope for A1; Settlement vectors are skipped until A5.

## Toolchain & build

- **Android Studio** (free) on the Mac + bundled JDK; **Gradle** (Kotlin DSL); **Jetpack Compose** + **Material 3**.
- **`minSdk 26`** (Android 8.0 — ~96% of active devices); **`compileSdk` / `targetSdk 36`** (Android 16) — mandatory for new Play submissions from **31 Aug 2026**, and we will be at/after that date.
- **Charts: Vico** (Compose-native) — the Chart.js equivalent; mirrors the web/iOS chart treatment within the design system.
- **Headless release build:** `./gradlew bundleRelease` → an `.aab` (Android App Bundle). Same CLI discipline that produced the iOS `.ipa`; CI-able later.
- **UAT:** Android Studio emulator (AVD) on Apple Silicon. No physical device.

## Release plan (Phase A4) — the actual bottleneck

**The code is not the long pole. Google's tester rule is.** (Verified 2026-06-22.)

- **Play Console account:** $25 one-time, owned by `adnan.rshd@gmail.com`.
- **Closed-testing gate (personal accounts created after 13 Nov 2023):** a closed test with **≥12 testers continuously opted-in for ≥14 days** is required *before* production access can even be requested. Production review then takes ~7 days. Organisation accounts are exempt but require a registered legal entity / D-U-N-S — we ship personal, so the gate applies.
- **The lever — parallelise:** stand up the Play account and push a **minimal but real build into closed testing as early as A2**, recruit the 12 testers, and let the 14-day clock run *while A3 is still being built*. Time-to-Play is then bounded by the tester window, not by engineering.
- **Tester recruitment:** the owner has no Android device, so all 12 are external — but **Bangladesh is ~95% Android**, so IDLC colleagues are a ready pool. Recruit via a Google Group / email list opted into the closed track; testers must actually open the app during the window (Google tracks active engagement).
- **Store listing:** needs its own Android screenshots (phone, plus optional 7"/10" tablet) — the iOS App Store assets do not transfer. Captured from the emulator build. Privacy URL reuses `https://incalc.clauding-lab.com/privacy.html`.
- **Realistic timeline:** ≥3 weeks from first closed-test upload to live, almost all of it the tester gate.

## Governance

The new repo gets the standard trio at bootstrap (owner's repo rule): `AGENTS.md` (Android/Gradle build + release commands, signing landmines, the parity flow), `VISION.md` (what auto-merges vs needs sign-off), `AGENT_LEARNINGS.md` (starts from template). Mirror the relevant `incalc-ios` landmines (web-first parity, money-critical number discipline).

## Out of scope / deferred

- **Settlement / Excel upload** → v1.1 (Phase A5).
- **Tablet-optimised layouts** → phone-first portrait for v1.0 (matches iOS); tablets get a functional but unrefined layout.
- **Material You dynamic color** → explicitly rejected; brand color stays constant.
- **iOS Liquid Glass visual port** → rejected; native Material 3 expression of the brand instead.
- **CI/CD automation** → manual `./gradlew` builds for v1.0; automate later if cadence warrants.

## Success criteria

- **A1:** `./gradlew test` green on all Loan/Deposit/DSCR/Compare golden vectors — Android math bit-identical to web and iOS.
- **v1.0:** four calculators live on Play under `adnan.rshd@gmail.com`, brand-consistent Material 3, numbers matching the other two platforms, passed the closed-testing gate and production review.
- **v1.1:** Settlement tab with working Excel upload, vectors green.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| JS↔Kotlin rounding drift produces wrong money | **Critical** | `Double` + exact `fmt` rounding mode + the 1,228-vector gate; engine built and proven before any UI |
| 12-tester gate stalls release | High | Start closed testing at A2, recruit IDLC Android colleagues, parallelise the 14-day clock with A3 |
| Three-platform parity rot over time | High | Web-first contract enforced by `./gradlew test`; any calc change must update all three or CI goes red |
| Compose charts can't match Chart.js treatment | Low | Vico is capable; charts are presentational, not money-critical |

---

*Sources (release rules, verified 2026-06-22):* [Play closed-testing requirement](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) · [Target API level requirement](https://developer.android.com/google/play/requirements/target-sdk)
