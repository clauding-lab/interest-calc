# interest-calc — code review (2026-06-18)

Reviewed alongside the native port `clauding-lab/incalc-ios`. Dimensions: calculation correctness, security, privacy-claim accuracy, PWA/service-worker correctness, and cross-platform parity. Severities are verification-calibrated (each finding confirmed by reading the actual code and, for the calc bug, hand-checking the math in Node).

## Verdict

The core math is, overall, in good shape — EMI, loan amortization, FD/DPS/WDS compounding, and the IRR/XIRR solvers all reproduce their textbook closed forms exactly. The web security posture is genuinely strong for a backend-less client-side calculator. Two items worth acting on (one calc, one privacy), plus a few informational notes.

## Findings

### 🟠 HIGH — deposit maturity overstated for Annual compounding on a fractional year
`index.html:1580` (the `doC` compounding trigger), reachable via the Custom preset's compounding dropdown (`:497-500`) + the 0.5-step time-horizon slider (`:490`).

In the deposit "standard compound" path, the partial-final-year clause `(monthsThisYear<12 && mo===monthsThisYear-1)` applies a **full** compounding period's rate (`rate/100/n`) to a stub shorter than one period. With **Annually** compounding (`n=1`), a 6-month stub receives a full year's interest.

- Example: P=100,000, rate=10%, **Annually**, **1.5 years** → app computes **121,000** (= 100,000 × 1.10 × 1.10, two full years of interest for 1.5 years); pro-rated-correct ≈ **115,500**. Overstatement ≈ 5,500 (~4.8%), and it **grows with tenor** (2.5y: +6,050; 3.5y: +6,655).
- Quarterly/semi-annual are unaffected (their 6-month stub is a whole number of periods); only Annually + an odd half-year is wrong. FD forces quarterly and WDS forces weekly, so presets are safe — this is a Custom-mode case.

**Status: NOT yet fixed — owner decision required.** The native port documents this as "an intentional web quirk … NOT a bug; do not remove it" (`incalc-ios Deposit.swift:129-135`). Whether a partial final period should earn a full period's interest, pro-rated simple interest, or nothing is a **banking-convention** call for the owner. Per this repo's CLAUDE.md ("wrong financial numbers are the worst possible defect class; flag any calculation change loudly"), no change is made unilaterally. If the convention is "pro-rated," the fix scales the stub's rate by the fraction of a compounding period actually elapsed; the change must be made here **first** (regenerating `tools/golden-vectors.json` via `generate-golden-vectors.mjs`, adding an Annually+1.5y vector) and then mirrored byte-identically into the iOS port.

### 🟡 MEDIUM — privacy policy contradicts actual third-party network calls
`privacy.html:113,119` vs `index.html:6,17-20`

`privacy.html` states "Nothing you type leaves your device" and "no third-party services." But `index.html` loads three third-party origins on **every page load** (allow-listed in its CSP): `cdnjs.cloudflare.com` (Chart.js), `cdn.sheetjs.com` (SheetJS), and **Google Fonts** (`fonts.googleapis.com` + `fonts.gstatic.com`). Google Fonts alone leaks the visitor's IP + User-Agent to Google on each load. For a public, owner-branded page this is an accuracy/credibility (and GDPR-flavored) problem — sharpened by `privacy.html` itself being self-contained (`connect-src 'none'`, "no webfonts fetched").

**Fix:** either self-host the three assets (fonts as local woff2; the SW already precaches the two JS libs so offline is unaffected) and tighten the app CSP, or amend the policy to disclose the CDN/Google-Fonts fetches. Self-hosting is the cleaner reconciliation and removes the third-party dependency entirely.

### 🟢 LOW (informational)
- **Deposit uses annuity-due crediting** (`index.html:1578` precedes `:1581`): each contribution earns interest in its own deposit month (verified: matches the annuity-due closed form, ~579/yr higher than ordinary annuity for 5k/mo @ 11%). Defensible for most BD DPS products; confirm it matches the target product's crediting rule.
- **DSCR EMI "round up to nearest 10"** (`index.html:2012`, `Math.round((emi+4.999)/10)*10`) is an approximate ceiling with a 5-unit bias, not a strict ceiling. Off by ≤5 in display; likely intentional banker rounding.
- **Unescaped date strings in the settlement print HTML** (`index.html:2738-2739,2748`): not exploitable today (values come from `<input type=date>`/`cellDate()`), but inconsistent with the surrounding `escH()`-escaped fields — wrap for defense-in-depth.
- **No SRI on the Google Fonts stylesheet** (`index.html:18`): informational; resolved automatically by self-hosting fonts.

### Verified-correct (no action)
`emiFormula`, `buildSchedule` amortization, `calcEffectiveRate`/`dscrIRR`/`xirr` (Newton-Raphson), FD quarterly/semi-annual, WDS weekly cadence, MBS simple-interest payout — all reproduce closed forms exactly. Security: proper `escH()` escaping on all user/spreadsheet-derived `innerHTML` writes, no dangerous sinks (no `eval`/`document.write`/URL-param parsing), no secrets committed, a well-built service worker (versioned cache, **network-first navigation** so deploys aren't stuck stale, scoped purge), SRI on the two external scripts, no mixed content, `rel="noopener"` on the one `target="_blank"`.

## Cross-platform parity (web ↔ iOS): ✅ zero divergence

The native port reproduces these numbers exactly — `incalc-ios`'s vendored `golden-vectors.json` is byte-identical to this repo's `tools/golden-vectors.json` (same `sourceCommit`). Any calc change here must regenerate those vectors and be mirrored into the port.
