# Tenor 3-Month Grid — Implementation Plan

> **For agentic workers:** executed via superpowers:subagent-driven-development, one Opus implementer per task, review per task. Web-first (`interest-calc`), then mirror iOS (`incalc-ios`). Steps use `- [ ]`.

**Goal:** Loan/Compare/Deposit tenor on a 3-month grid; Loan quick-pick chips; Deposit years→months slider keeping product chips; FD 2×/3× sticky solver. DSCR untouched. No formula changes. Spec: `docs/superpowers/specs/2026-06-20-tenor-3month-grid-design.md`.

**Architecture:** Web `index.html` (single file, source of truth) → regenerate `tools/generate-golden-vectors.mjs` → `golden-vectors.json` → mirror to the pure-Swift `InCalcEngine` + SwiftUI views. Verification: golden vectors (parity contract) + web manual + iOS `swift test`/build/visual.

## Global Constraints

- **No displayed financial number may change** except where a new tenor notch is now reachable (the math at that notch must be correct). FD/EMI/deposit/DSCR/settlement formulas are untouched. (`VISION.md`, project `CLAUDE.md`.)
- **Web-first parity:** change web → regenerate vectors → mirror iOS. Never edit iOS math without the matching web change + regenerated vector.
- **Tenor is whole months, step 3** (every value a multiple of 3) for Loan/Compare/Deposit. Readout via `fmtTenor(months)`.
- **FD 2×/3× solver (exact):** `months = 3 × ceil( ln(N) / ln(1 + rate/400) )`, clamp to slider max (480), guard `rate>0` (else unreachable). Targets **gross** maturity `P·(1+rate/400)^(months/3)` (FD is quarter-aligned on this grid → exact).
- **Conventional Commits; NO AI attribution trailers** (both repos' rules). Bump web `sw.js CACHE_NAME` once (v8→v9) when `index.html` changes.
- **Implementers read the live code** and write the diff (single-file `index.html`; capable Opus). Each task: implement → verify → commit, surgical (no unrelated edits).

## File Structure

| File | Change |
|---|---|
| `index.html` (web) | Loan slider step + chips; Compare sliders step; Deposit slider years→months + chips→months + FD 2×/3× solver; `fmtTenor` readouts; preset defaults |
| `sw.js` (web) | `CACHE_NAME` v8→v9 (once, with W6) |
| `tools/generate-golden-vectors.mjs` + `golden-vectors.json` (web) | new tenor-grid cases + FD 2×/3× cases; regenerate |
| `incalc-ios` engine / VMs / views / Fixtures | mirror all of the above; copy regenerated vectors |

---

## WEB — branch `feat/tenor-3month-grid`

### Task W1: Loan — step 6→3 + quick-pick chips
**Files:** `index.html` (Loan slider `#l-term` at ~626; add a chip row above it; chip JS near `calcLoan`/the loan helpers).
- [ ] Change `#l-term` `step="6"` → `step="3"` (range 12–360 unchanged).
- [ ] Add a `.tenure-chips` row in the Loan tenure field with chips **1y 2y 3y 4y 5y 8y 10y** mapping to months **12 24 36 48 60 96 120**. Reuse the existing `.tenure-chips`/`.tenure-chip`/`.active` CSS. A chip sets `#l-term.value`, calls `calcLoan()`, marks itself active; moving the slider (`oninput`) clears the active chip.
- [ ] Confirm the `#l-term-out` readout already uses `fmtTenor` (it does); chips therefore read e.g. "5 years".
- [ ] **Verify:** open the app (`ruby -run -ehttpd . --port=8080`), Loan EMI at 120 mo unchanged vs before; slider now steps by 3 (e.g. 15, 27 mo reachable); each chip snaps + highlights; dragging clears the chip. Screenshot.
- [ ] **Commit:** `feat: 3-month loan tenor grid + quick-pick chips (1y–10y)`.

### Task W2: Compare — step 6→3
**Files:** `index.html` (`#ca-years` ~743, `#cb-years` ~767).
- [ ] Change both `step="6"` → `step="3"`. Ranges 12–360 unchanged.
- [ ] Ensure `#ca-years-out`/`#cb-years-out` render via `fmtTenor` (apply if not already).
- [ ] **Verify:** Compare with A=18mo/B=30mo unchanged; sliders step by 3; readouts human. Screenshot.
- [ ] **Commit:** `feat: 3-month tenor grid on compare scenarios`.

### Task W3: Deposit — years slider → months slider (step 3), chips→months
**Files:** `index.html` (`#d-years` slider ~497–499; `calcDeposit` years derivation ~1408–1416; `buildTenureChips`/`selectTenure` ~1359–1368; preset defaults `setPreset` ~1309–1355 where `d-years.value` is set; the `#d-years-out` readout).
- [ ] Replace the `#d-years` years slider with a **months slider** `min="3" max="480" step="3"` (keep the id `d-years` to minimise churn, OR rename to `d-months` and update all refs — implementer's call, but be consistent). Label "Tenor".
- [ ] In `calcDeposit`: the slider now supplies **months**; set `totalMonths = sliderMonths` and `years = totalMonths/12`. The `dataset.actual` chip override now stores **months**. Keep all downstream logic (`fullYears=ceil(years)`, partial-year handling) intact — it already handles fractional years.
- [ ] `buildTenureChips`: values become **months**. Update the FD list to `[{l:'3m',v:3},{l:'6m',v:6},{l:'1y',v:12},{l:'2y',v:24},{l:'3y',v:36}]` and WDS to `[{l:'3m',v:3},{l:'6m',v:6},{l:'9m',v:9},{l:'12m',v:12}]`. `selectTenure(months)` sets `#d-years.value=months` + `dataset.actual=months` + `calcDeposit()`.
- [ ] In `setPreset`, change each `d-years.value=<years>` to the month equivalent (FD 1y→12, DPS 5y→60, WDS 1y→12, MBS 3y→36, Custom 15y→180).
- [ ] `#d-years-out` readout via `fmtTenor(totalMonths)`.
- [ ] **Verify:** FD/DPS/WDS/MBS/Custom each: Future Value + Net receivable identical to pre-change at the SAME tenor (e.g. FD 1y, DPS 5y); slider steps by 3 months; chips snap; readout reads "1 year"/"5 years". Screenshot each product.
- [ ] **Commit:** `feat: deposit tenor as 3-month months slider (chips preserved)`.

### Task W4: FD 2× / 3× sticky solver chips
**Files:** `index.html` (Deposit chip area; a new solver fn near the deposit helpers; the FD branch of `setPreset`; the rate slider `#d-rate` oninput; the tenor slider clear-handler).
- [ ] Add `function fdMultiplierMonths(rate, N){ if(rate<=0) return null; const q=Math.ceil(Math.log(N)/Math.log(1+rate/400)); const m=3*q; return m>480 ? {months:480, reached:false} : {months:m, reached:true}; }`.
- [ ] On FD only, render two extra chips **2×** and **3×** in the tenure-chip row (hidden for non-FD — gate in `buildTenureChips`/`setPreset`). Tapping computes `fdMultiplierMonths(currentRate, N)`, sets `#d-years.value=result.months` + `dataset.actual=result.months`, marks the 2×/3× chip active, `calcDeposit()`. If `!reached` or `null`, snap to 480 and show a brief inline note "can't reach N× at this rate (max 40y)" (no silent cap).
- [ ] **Sticky:** track active multiplier in a module var (e.g. `fdActiveMult`). When the rate slider `#d-rate` changes AND `fdActiveMult` set AND product is FD → re-solve and move the tenor before `calcDeposit()`. Manually moving the tenor slider, tapping a term chip, or switching product clears `fdActiveMult` and the active state.
- [ ] **Verify (hand-checked):** FD, rate 12% → tap 2× → tenor = **72 mo (6y)**, gross Future Value ≈ 2.03×P (≥2×). Tap 3× → ln3/ln1.03=37.16→38 quarters→**114 mo**, gross ≈ 3.06×P. Drag rate to 8% → 2× re-solves to 3·ceil(ln2/ln1.02)=3·ceil(35.0)=3·35=**105 mo** live. Very low rate (1%) 3× → check clamp-at-480 + note. Switch to DPS → 2×/3× chips gone. Screenshot the active 2× state.
- [ ] **Commit:** `feat: FD 2x/3x doubling-time solver chips (sticky, gross target)`.

### Task W5: Golden vectors — extend generator + regenerate
**Files:** `tools/generate-golden-vectors.mjs`, `golden-vectors.json`.
- [ ] Add loan/compare/deposit cases at **off-old-grid tenors now reachable**: months 15, 27, 39 (loan EMI + schedule; compare; deposit FV) so the math at the new notches is pinned.
- [ ] Add a **FD 2×/3× solver section**: extract/replicate `fdMultiplierMonths`; emit cases `{rate, N, months, grossFV}` for rates {12, 9.5, 8, 1} × N {2,3}, with `grossFV = round(P*(1+rate/400)^(months/3))` for a fixed P (e.g. 100000), including the clamp case. Use the SAME extract-from-index.html mechanism as existing sections (web is source of truth).
- [ ] Run `node tools/generate-golden-vectors.mjs`; confirm it writes `golden-vectors.json` with the new sections and spot-check 12%/2× → months 72.
- [ ] **Verify:** `node tools/generate-golden-vectors.mjs` exits 0; `git diff golden-vectors.json` shows only additions/grid changes; 12%→72mo present.
- [ ] **Commit:** `test: golden vectors for 3-month grid + FD 2x/3x solver`.

### Task W6: Cache bump
**Files:** `sw.js`.
- [ ] `CACHE_NAME` `incalc-v8` → `incalc-v9`.
- [ ] **Commit:** `chore: bump sw cache to v9 (tenor grid)`.

---

## iOS — branch `feat/tenor-3month-grid` in `incalc-ios`

### Task I1: Engine + regenerated vectors
**Files:** `incalc-ios` engine (deposit + a new solver fn), `Tests/.../Fixtures/golden-vectors.json`.
- [ ] Copy the regenerated `golden-vectors.json` (from W5) into the iOS Fixtures path (find it: `find . -name golden-vectors.json`).
- [ ] Add the doubling-time solver to the engine mirroring `fdMultiplierMonths` (e.g. `Deposit.fdMultiplierMonths(rate:N:) -> Int?` with the same clamp/guard), and a vector-driven test looping the new FD-multiplier section. Ensure the deposit engine accepts a months tenor.
- [ ] **Verify:** `swift test` green (existing + new sections; report counts). The new FD-multiplier vectors pass.
- [ ] **Commit:** `feat: doubling-time solver in engine + 3-month-grid vectors`.

### Task I2: Loan + Compare (VM/view) — step + chips
**Files:** `incalc-ios` Loan + Compare views/VMs (`LoanView`/`LoanViewModel` termRange step; `CompareView`/`CompareViewModel` monthsRange step; a chip row on Loan).
- [ ] Loan: change the tenure slider step 6→3; add a quick-pick chip row (1y–10y → 12…120) using the native chip/`Chip` component, snapping the slider + clearing on drag.
- [ ] Compare: change both scenario sliders' step 6→3.
- [ ] **Verify:** `xcodebuild build` SUCCEEDS; `swift test` green; simulator screenshot of Loan (chips) + Compare. EMI/compare numbers unchanged at same tenor.
- [ ] **Commit:** `feat: 3-month loan/compare tenor + loan quick-pick chips (iOS)`.

### Task I3: Deposit (VM/view) — months slider + chips + FD 2×/3×
**Files:** `incalc-ios` Deposit view/VM (replace year-slider + product chips with months slider + month-chips; add FD 2×/3× sticky chips wired to the engine solver from I1).
- [ ] Deposit tenure → months slider (3–480, step 3); product chips in months; readout via the iOS tenor formatter.
- [ ] FD 2×/3× chips (FD only): tap → engine `fdMultiplierMonths` → set tenor + active; sticky re-solve on rate change; clear on manual drag / term chip / product switch; clamp + note at max.
- [ ] **Verify:** `xcodebuild build` SUCCEEDS; `swift test` green; simulator screenshots (Deposit months slider, FD 2× active state). FD 2× at 12% → 72 mo, FV ≥ 2×.
- [ ] **Commit:** `feat: deposit months slider + FD 2x/3x solver chips (iOS)`.

## Test Strategy

- **Highest risk = the solver.** Hand-checked vectors (12%→72, 8%→105, 3×, clamp, rate=0) drive both web manual checks and iOS `swift test`.
- **Grid correctness:** vectors at 15/27/39 mo prove EMI/FV correct at new notches.
- **Parity:** regenerated `golden-vectors.json` is the single contract; iOS loops it.
- **No-regression:** existing vectors must stay green (unchanged formulas).

## Self-Review

- **Spec coverage:** Loan chips (W1/I2), Compare step (W2/I2), Deposit months+chips (W3/I3), FD 2×/3× (W4/I3), vectors (W5/I1), cache (W6), DSCR untouched (no task) — all covered. ✓
- **Placeholder scan:** the one judgement left to the implementer is keep-id-`d-years` vs rename-`d-months` (W3) — explicitly flagged as a consistent either/or, not a gap. ✓
- **Type consistency:** `fdMultiplierMonths(rate,N)` signature used identically in W4, W5, I1, I3. Tenor is months everywhere. ✓
