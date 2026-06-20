# Tenor 3-Month Grid + Quick-Picks + FD Multiplier Chips — Design Spec

**Date:** 2026-06-20
**Repos:** `clauding-lab/interest-calc` (web, source of truth) → `clauding-lab/incalc-ios` (mirror)
**Type:** UX + input-grid change with one new math feature (FD doubling-time solver). Web-first, parity-locked.

## Goal

Make loan/deposit/compare tenor easy to set on a consistent **3-month (quarter) grid**, add tenor quick-pick chips to Loan, and add FD "double/triple your money" solver chips that compute the tenor for a target growth multiple.

## Scope

In scope (tenor → months, **step 3**):
- **Loan** — slider step 6→3; **+ quick-pick chips 1y · 2y · 3y · 4y · 5y · 8y · 10y**.
- **Compare** — both scenario sliders step 6→3.
- **Deposit** — years slider → **months slider (step 3)**; keep product chips as quick-picks; **FD gains 2× / 3× solver chips**.

Out of scope (unchanged):
- **DSCR** — keeps its precise **number box** (free month entry). Owner decision 2026-06-20: exact sanctioned-tenor entry matters more than grid uniformity in the credit-memo tab. Its existing web 480 / iOS 360 max gap is pre-existing and NOT addressed here.
- **No formula changes.** EMI, deposit compounding, DSCR, settlement math are untouched. Only the *selectable grid*, the Deposit input unit (years→months), and the new FD solver are new.

## Unified tenor model

- Tenor stored and stepped in **whole months, step 3** (every value a multiple of 3).
- **Readout** stays human via the existing `fmtTenor(months)` helper: `18 mo` · `3y` · `3y 3m` (web index.html ~line 1739; the loan tab already uses it). Apply the same readout to the Compare and Deposit sliders so a 180-month deposit reads "15y".

### Per-tab ranges (step 3 throughout)

| Tab | Min | Max | Notes |
|---|---|---|---|
| Loan (`l-term`) | 12 mo | 360 mo | range unchanged; only step 6→3 |
| Compare (`ca-years`,`cb-years`) | 12 mo | 360 mo | range unchanged; only step 6→3 |
| Deposit (`d-years`→months) | 3 mo | 480 mo (40 y) | range preserved (40 y); long jumps handled by chips, fine-tune by slider |

## Loan quick-pick chips

Add a chip row above the Loan slider (mirror the Deposit `.tenure-chips` pattern): **1y/2y/3y/4y/5y/8y/10y → 12/24/36/48/60/96/120 months** (all multiples of 3). Tap snaps the slider; dragging clears the active chip. Pure UI; no math.

## Deposit: years→months slider + kept chips

- Replace the years slider (`d-years`, 1–40 y, step 0.5) with a **months slider (3–480, step 3)**. Internally the deposit calc currently derives `totalMonths` from `years`; invert it — the slider supplies months, `years = months/12` where the calc needs years.
- Keep the product chips (`buildTenureChips`) as quick-picks, but their values become **months** (e.g. FD `3m/6m/1y/2y/3y` → `3/6/12/24/36`). `selectTenure` sets months. The `dataset.actual` override mechanism stays, in months.
- Correctness note: deposit gross compounding is quarterly for FD (and freq-driven otherwise); on a 3-month grid every tenor is quarter-aligned, so no partial-period drift is introduced. Verify via regenerated golden vectors across the full Deposit product set.

## FD 2× / 3× solver chips (new feature — FD only)

**What:** On the FD product, show two extra chips **2×** and **3×**. Tapping solves for the tenor at which the **gross maturity value reaches N× the principal** at the current rate, snaps the slider there, and stays **active (sticky)**.

**Math (exact, closed-form):** FD is a lump sum, quarterly-compounded, no contributions, so gross maturity `FV = P·(1 + rate/400)^(months/3)`. Solve `FV = N·P`:

```
quartersExact = ln(N) / ln(1 + rate/400)
quarters      = ceil(quartersExact)          // round UP → FV ≥ N·P (owner: always reach the target)
months        = 3 × quarters                  // on-grid by construction
```

- `N ∈ {2, 3}`. Uses the live `rate` (annual %, the `d-rate` value).
- **Cap:** if `months > 480` (max), clamp to 480 and surface a brief note that N× is unreachable at this rate within the 40-year range (no silent cap). The note replaces the chip's success state; the slider sits at max.
- **Edge:** `rate ≤ 0` → infinite/undefined doubling time → treat as unreachable (clamp + note). Guard `ln(1+rate/400) > 0`.
- **Gross promise:** at 2×, gross interest = principal; source tax + excise duty still apply, so the displayed **net receivable lands under N×** — this is intended (the chip's promise is gross "double your money", the standard meaning). No change to how tax/ED are shown.

**Sticky behavior:**
- Tapping **2×** (or **3×**) activates it and sets the tenor. While active, **changing the rate live re-solves and moves the tenor** (so the FD always shows the doubling tenor for the current rate — "tenor will vary").
- **Dragging the tenor slider manually, tapping a term chip, or switching product away from FD deactivates** the 2×/3× state (back to manual tenor).
- Only one of {2×, 3×, a term chip} is active at a time (shared active state with the term chips).
- 2×/3× chips are **hidden for non-FD products** (DPS/WDS/MBS/Custom have contributions or payouts where "double the principal" is ill-defined).

## Web-first parity process

1. **Web** (`index.html`): implement all the above; bump `sw.js` `CACHE_NAME`.
2. **Golden vectors:** extend `tools/generate-golden-vectors.mjs` to (a) sample the new 3-month tenor grid for loan/compare/deposit, and (b) emit FD 2×/3× solver cases (rate → expected months + gross FV). Regenerate `golden-vectors.json`.
3. **iOS** (`incalc-ios`): mirror in the pure-Swift engine (deposit tenor unit + the doubling-time solver as a new engine function), the affected view models, and the SwiftUI views (Loan chips, Compare step, Deposit months-slider + chips + 2×/3×). Copy the regenerated vectors into Fixtures. `swift test` green; app builds.

## Test strategy

- **Solver (highest risk):** golden vectors for representative rates with hand-checkable answers, e.g. rate 12% → quartersExact = ln2/ln(1.03) = 23.45 → 24 quarters → **72 mo (6y)**, gross FV/P = 1.03^24 = 2.0328×. Cover 2× and 3×, a low rate that clamps at 480, and rate=0 (unreachable). Same vectors drive web checks and `swift test`.
- **Grid:** vectors at off-old-grid tenors now reachable (e.g. 15, 27, 39 months) for loan EMI and deposit FV, proving the math is correct at the new notches.
- **Parity:** the regenerated `golden-vectors.json` is the single contract; iOS `swift test` loops it.
- **Visual:** web manual check + iOS simulator screenshots of Loan (chips), Deposit (months slider + 2×/3× active state), Compare.

## Out of scope / deferred

- DSCR (unchanged, per owner).
- The web Loan "cash security tenor" (`l-cs-tenor`): verify in planning whether it's a separate slider; if so, apply step 3 (no chips).
- Unifying the DSCR max across web/iOS (pre-existing gap; not this change).
