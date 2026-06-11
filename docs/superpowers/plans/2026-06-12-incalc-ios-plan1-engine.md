# InCalc BD iOS — Plan 1: Engine + Golden Vectors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure-Swift `InCalcEngine` package whose every financial function is proven equal to the verified web JS engine via committed golden vectors.

**Architecture:** A Node generator in the web repo runs the *real* JS engine (pure functions extracted from `index.html`; DOM-coupled functions run under a tiny DOM stub) and emits `golden-vectors.json`. A new `incalc-ios` repo holds a Swift Package (`InCalcEngine`, no UI imports) built TDD against those vectors. The app target comes in Plan 3 and will depend on this package.

**Tech Stack:** Node 20 (generator), Swift 5.9+ SPM package, XCTest, `swift test` (no Xcode project needed in this plan).

**Spec:** `docs/superpowers/specs/2026-06-12-incalc-ios-design.md` (web repo). Parity rule: Swift replicates JS behavior exactly, quirks included. Tolerances: integers/slabs exact; floats relative ≤ 1e-9; deposit outputs match at rounded-taka level (that is the engine's display contract).

**Function inventory being ported (web `index.html`, tag v1.0.0+):** `getED`, `emiFormula`, `buildSchedule`, `calcEffectiveRate`, `dscrPMT`, `dscrIRR`, `dscrFV`, `xirr`, collection-for-IRR rule (from `settleUpdateTotals`), `scenarioCalc`, deposit projection loops (from `calcDeposit`: monthly, weekly, MBS), `fmt`/`grp` (BDT only).

---

### Task 1: Golden-vector generator — pure functions (web repo)

**Files:**
- Create: `tools/generate-golden-vectors.mjs`
- Output (committed): `tools/golden-vectors.json`

- [ ] **Step 1: Write the generator skeleton with the proven extraction harness**

```js
// tools/generate-golden-vectors.mjs
// Runs the REAL web engine (extracted from index.html) and emits golden vectors
// for the Swift port. Node 20+, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).sort((a, b) => b.length - a.length)[0];

function extract(name) {
  const i = main.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`function ${name} not found`);
  let depth = 0, j = main.indexOf('{', i);
  for (let k = j; k < main.length; k++) {
    if (main[k] === '{') depth++;
    if (main[k] === '}') { depth--; if (depth === 0) return main.slice(i, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// Globals the pure functions reference
globalThis.currency = 'BDT';
globalThis.CONFIG = {
  sourceTax: { withReturnProof: 0.10, withoutReturnProof: 0.15 },
  loanProcFeeRate: 0.01,
  fxTakaPerUsd: 110,
};
for (const fn of ['sym','toDisp','fmt','fmtS','grp','num','emiFormula','getED',
                  'buildSchedule','calcEffectiveRate','dscrPMT','dscrIRR','dscrFV',
                  'xirr','scenarioCalc']) {
  (0, eval)(extract(fn));            // indirect eval -> defines on globalThis
}

const nn = v => (typeof v === 'number' && !Number.isFinite(v)) ? null : v; // NaN/Inf -> null
const vectors = { meta: {
  sourceCommit: execSync('git rev-parse HEAD', { cwd: new URL('..', import.meta.url).pathname }).toString().trim(),
} };
```

- [ ] **Step 2: Emit getED, emiFormula, money-format vectors**

Append to the script:

```js
// getED — all slab boundaries, both sides
vectors.getED = [
  0, 1, 299999, 300000, 300001, 499999, 500000, 500001, 999999, 1000000, 1000001,
  4999999, 5000000, 5000001, 9999999, 10000000, 10000001, 19999999, 20000000,
  20000001, 49999999, 50000000, 50000001, 80000000, 250000000,
].map(bal => ({ bal, ed: getED(bal) }));

// emiFormula — grid incl. zero/negative rate and n=0 quirks
vectors.emi = [];
for (const pv of [50000, 600000, 1000000, 4750000, 50000000])
  for (const annual of [0, 1, 6, 9, 12.5, 19, 25])
    for (const n of [6, 12, 36, 60, 84, 120, 240, 360])
      vectors.emi.push({ pv, r: annual / 100 / 12, n, emi: nn(emiFormula(pv, annual / 100 / 12, n)) });
vectors.emi.push({ pv: 1000000, r: 0, n: 0, emi: nn(emiFormula(1000000, 0, 0)) });

// Money formatting (BDT) — exact display strings
vectors.money = [0, 1, 999, 1000, 99999, 100000, 1234568, 12345678, 123456789,
  -95981, -1234568, 2178010, 49108.4, 49108.6].map(n => ({ n, fmt: fmt(n), grp: grp(n) }));
```

- [ ] **Step 3: Emit loan schedule, effective-rate (EAR), and compare vectors**

```js
// Loan schedules (buildSchedule is pure)
vectors.loanSchedule = [];
for (const c of [
  { P: 1000000, rate: 9,  years: 10, extra: 0 },
  { P: 1000000, rate: 9,  years: 10, extra: 5000 },
  { P: 600000,  rate: 6,  years: 5,  extra: 0 },
  { P: 600000,  rate: 7,  years: 5,  extra: 0 },
  { P: 4750000, rate: 12.5, years: 20, extra: 0 },
  { P: 4750000, rate: 12.5, years: 20, extra: 25000 },
  { P: 50000,   rate: 1,  years: 1,  extra: 0 },
  { P: 50000000, rate: 25, years: 30, extra: 100000 },
]) {
  const s = buildSchedule(c.P, c.rate, c.years, c.extra);
  vectors.loanSchedule.push({ ...c, emi: s.emi, totalPaid: s.totalPaid,
    totalInterest: s.totalInterest, totalMonths: s.totalMonths,
    rows: s.rows.map(r => ({ year: r.year, open: r.open, principal: r.principal,
                             interest: r.interest, close: r.close })) });
}

// Effective rate (EAR) — calcEffectiveRate is pure; null result must be preserved
vectors.effectiveRate = [];
for (const c of [
  { P: 1000000, rate: 9, years: 10, advEMI: 0, csAmt: 0,      csRate: 0 },   // -> null (gated by caller, but engine must agree)
  { P: 1000000, rate: 9, years: 10, advEMI: 2, csAmt: 0,      csRate: 0 },
  { P: 1000000, rate: 9, years: 10, advEMI: 0, csAmt: 200000, csRate: 7 },
  { P: 1000000, rate: 9, years: 10, advEMI: 3, csAmt: 300000, csRate: 8.5 },
  { P: 1000000, rate: 19, years: 3, advEMI: 12, csAmt: 500000, csRate: 0 },  // netDisb<=0 -> null
]) {
  const emi = buildSchedule(c.P, c.rate, c.years, 0).emi;
  const r = calcEffectiveRate(c.P, c.rate, c.years, emi, c.advEMI, c.csAmt, c.csRate);
  vectors.effectiveRate.push({ ...c, emi, result: r === null ? null : {
    effectiveRate: r.effectiveRate, netDisbursement: r.netDisbursement,
    csInterest: r.csInterest, rateMarkup: r.rateMarkup } });
}

// Compare — scenarioCalc is pure (needs fmt, already defined); winner is numeric
vectors.compare = [];
for (const c of [
  { aType:'loan', aAmt:600000, aRate:6, aYears:5,  bType:'loan', bAmt:600000, bRate:7, bYears:5 },   // historical string-trap case
  { aType:'loan', aAmt:50000,  aRate:1, aYears:5,  bType:'loan', bAmt:50000,  bRate:15, bYears:20 },
  { aType:'deposit', aAmt:500000, aRate:8, aYears:10, bType:'deposit', bAmt:500000, bRate:12, bYears:10 },
  { aType:'loan', aAmt:1000000, aRate:9, aYears:10, bType:'loan', bAmt:1000000, bRate:9, bYears:10 }, // tie
]) {
  const A = scenarioCalc(c.aType, c.aAmt, c.aRate, c.aYears);
  const B = scenarioCalc(c.bType, c.bAmt, c.bRate, c.bYears);
  vectors.compare.push({ ...c,
    aFinal: A.vals[A.vals.length-1], bFinal: B.vals[B.vals.length-1],
    aTotalInt: nn(A.totalInt ?? null), bTotalInt: nn(B.totalInt ?? null),
    winner: c.aType==='loan' ? (A.totalInt < B.totalInt ? 'A' : 'B')
                             : (A.vals[A.vals.length-1] > B.vals[B.vals.length-1] ? 'A' : 'B') });
}
```

- [ ] **Step 4: Emit DSCR and XIRR vectors**

```js
// DSCR — replicate calcDSCR's IRR segment exactly (EMI round-up-to-10, full-tenor loop, savings credit)
vectors.dscr = [];
for (const c of [
  { loanAmt:1000000, tenor:36,  ratePct:19, advInst:0,  fdrAmt:200000, fdrRate:7, poolRate:10 },
  { loanAmt:1000000, tenor:60,  ratePct:19, advInst:0,  fdrAmt:200000, fdrRate:7, poolRate:10 },
  { loanAmt:1000000, tenor:61,  ratePct:19, advInst:0,  fdrAmt:0,      fdrRate:0, poolRate:0  },
  { loanAmt:1000000, tenor:84,  ratePct:19, advInst:0,  fdrAmt:200000, fdrRate:7, poolRate:10 },
  { loanAmt:1000000, tenor:120, ratePct:19, advInst:12, fdrAmt:200000, fdrRate:7, poolRate:10 },
  { loanAmt:1000000, tenor:36,  ratePct:0,  advInst:0,  fdrAmt:0,      fdrRate:0, poolRate:0  },
  { loanAmt:0,       tenor:36,  ratePct:19, advInst:0,  fdrAmt:200000, fdrRate:7, poolRate:10 }, // IRR must be null
  { loanAmt:1000000, tenor:36,  ratePct:19, advInst:36, fdrAmt:0,      fdrRate:0, poolRate:0  }, // activeTenor=0 -> null
]) {
  const monthlyRate = c.ratePct/100/12;
  let emi = 0;
  if (c.tenor > 0 && c.loanAmt > 0) { emi = dscrPMT(monthlyRate, c.tenor, c.loanAmt); emi = Math.round((emi+4.999)/10)*10; }
  const tenorYears = c.tenor/12;
  const fvFdr  = c.fdrAmt>0 && tenorYears>0 ? Math.round(dscrFV(c.fdrRate/100,  tenorYears, c.fdrAmt)) : 0;
  const fvPool = c.fdrAmt>0 && tenorYears>0 ? Math.round(dscrFV(c.poolRate/100, tenorYears, c.fdrAmt)) : 0;
  const costSavings = fvPool - fvFdr;
  const loanDeposit = emi * c.advInst, netDisburse = c.loanAmt - loanDeposit, activeTenor = c.tenor - c.advInst;
  const cfNo = [-netDisburse], cfWith = [-netDisburse];
  for (let m = 1; m <= activeTenor; m++) { cfNo.push(emi); cfWith.push(m === activeTenor ? emi + costSavings : emi); }
  const irrValid = netDisburse > 0 && emi > 0 && activeTenor > 0;
  vectors.dscr.push({ ...c, emi, fvFdr, fvPool, costSavings, netDisburse, activeTenor,
    irrNoSaveAnnual:  irrValid ? nn(dscrIRR(cfNo, 0.015)  * 12) : null,
    irrWithSaveAnnual: irrValid ? nn(dscrIRR(cfWith, 0.015) * 12) : null });
}

// XIRR — incl. the Microsoft reference case (expected ~0.373362535)
const D = s => new Date(s);
vectors.xirr = [
  { cashflows: [-10000, 2750, 4250, 3250, 2750],
    dates: ['2008-01-01','2008-03-01','2008-10-30','2009-02-15','2009-04-01'] }, // MS docs case
  { cashflows: [-1000000, ...Array(12).fill(30000), 950000],
    dates: ['2022-01-15', ...Array.from({length:12},(_,i)=>`20${i<11?22:23}-${String((i%12)+2>12?(i%12)-10:(i%12)+2).padStart(2,'0')}-10`), '2024-06-01'] },
  { cashflows: [-1000000, 200000, 200000, 800000],
    dates: ['2023-01-01','2023-07-01','2024-01-01','2025-06-01'] },
  { cashflows: [-1000000, 100000], dates: ['2023-01-01','2023-06-01'] },        // deeply negative IRR
  { cashflows: [-1000000], dates: ['2023-01-01'] },                              // <2 flows -> null
].map(c => ({ ...c, rate: nn(xirr(c.cashflows, c.dates.map(D))) }));
```

- [ ] **Step 5: Run and eyeball**

Run: `node tools/generate-golden-vectors.mjs` (add at end of file: `writeFileSync(new URL('./golden-vectors.json', import.meta.url), JSON.stringify(vectors, null, 1)); console.log('sections:', Object.keys(vectors).map(k=>`${k}:${Array.isArray(vectors[k])?vectors[k].length:'-'}`).join(' '));`)
Expected: prints section counts; `xirr[0].rate` ≈ 0.3733625 (Microsoft case); `getED` 25 entries; no exceptions.

- [ ] **Step 6: Commit (web repo)**

```bash
git add tools/generate-golden-vectors.mjs tools/golden-vectors.json
git commit -m "feat: add golden-vector generator for the iOS engine port (pure functions)"
```

---

### Task 2: Generator — DOM-coupled functions (deposit, settlement collection)

**Files:**
- Modify: `tools/generate-golden-vectors.mjs`
- Regenerate: `tools/golden-vectors.json`

The deposit math lives inside `calcDeposit` (DOM-coupled) and the collection-for-IRR rule inside `settleUpdateTotals`. Run the REAL functions under a DOM stub — zero reimplementation.

- [ ] **Step 1: Add the DOM stub and run real calcDeposit**

```js
// ---- DOM stub: every getElementById returns a stable stub element ----
const els = new Map();
function el(id) {
  if (!els.has(id)) els.set(id, { value:'', textContent:'', innerHTML:'', checked:false,
    style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false} }, dataset:{} });
  return els.get(id);
}
globalThis.document = { getElementById: el, querySelectorAll: () => [], documentElement: el('docEl') };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#000000' });
globalThis.Chart = class { constructor(){} destroy(){} update(){} };  // charts are no-ops
globalThis.localStorage = { getItem: () => null, setItem(){} };
(0, eval)(extract('getChartColors'));
(0, eval)(extract('alpha'));
(0, eval)(extract('calcDeposit'));
globalThis.currentPreset = 'custom';

const deNum = s => parseFloat(String(s).replace(/[৳,]/g,'')) || 0;  // "৳21,78,010" -> 2178010
function runDeposit(c) {  // c: {preset,P,contrib,weekly,rate,compound,years,actualYears,edOn,taxOn,psr,tableView}
  globalThis.currentPreset = c.preset;
  el('d-principal').value = String(c.P); el('d-contrib').value = String(c.contrib ?? 0);
  el('d-weekly').value = String(c.weekly ?? 0); el('d-rate').value = String(c.rate);
  el('d-freq').value = String(c.compound); el('d-years').value = String(c.years);
  el('d-years').dataset.actual = c.actualYears != null ? String(c.actualYears) : '';
  el('d-contrib-freq').value = c.contribFreq ?? 'monthly';
  el('d-table-view').value = 'yearly';
  el('d-ed-toggle').checked = c.edOn; el('d-tax-toggle').checked = c.taxOn;
  el('d-tin').value = c.psr ? 'tin' : 'notin';
  calcDeposit();
  const rows = [...el('d-table').innerHTML.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(t => t[1].replace(/<[^>]*>/g,'')));
  return { future: deNum(el('d-future').textContent), interest: deNum(el('d-interest').textContent),
    invested: deNum(el('d-invested').textContent), eay: parseFloat(el('d-eay').textContent),
    ed: deNum(el('d-ed-total').textContent), tax: deNum(el('d-tax-total').textContent),
    net: deNum(el('d-net-recv').textContent),
    futureStr: el('d-future').textContent, netStr: el('d-net-recv').textContent,
    rows: rows.map(r => r.map(cell => cell === '—' ? 0 : deNum(cell))) };
}

vectors.deposit = [];
const depositCases = [];
// Custom grid
for (const P of [0, 100000, 1000000]) for (const contrib of [0, 5000, 50000])
  for (const rate of [1, 8.5, 12, 20]) for (const compound of [12, 4, 2, 1])
    for (const years of [1, 5, 15]) for (const psr of [true, false])
      depositCases.push({ preset:'custom', P, contrib, rate, compound, years, edOn:true, taxOn:true, psr });
// Presets + fractional tenors + toggle-off cases
depositCases.push(
  { preset:'fd',  P:100000, contrib:0, rate:9.5,  compound:4,  years:1, actualYears:0.25, edOn:true,  taxOn:true,  psr:true },
  { preset:'fd',  P:3000000, contrib:0, rate:8,   compound:4,  years:5, edOn:true,  taxOn:true,  psr:true },
  { preset:'fd',  P:100000, contrib:0, rate:9.5,  compound:4,  years:2, edOn:false, taxOn:false, psr:true },
  { preset:'dps', P:0, contrib:5000,  rate:11,    compound:12, years:5, edOn:true,  taxOn:true,  psr:true },
  { preset:'wds', P:0, weekly:500,  rate:10.5, compound:12, years:1, actualYears:1, contribFreq:'weekly', edOn:true, taxOn:true, psr:true },
  { preset:'wds', P:0, weekly:2000, rate:10.5, compound:12, years:1, actualYears:0.5, contribFreq:'weekly', edOn:true, taxOn:false, psr:false },
  { preset:'mbs', P:500000, contrib:0, rate:10, compound:12, years:3, edOn:true, taxOn:true, psr:true },
  { preset:'mbs', P:2000000, contrib:0, rate:10, compound:12, years:5, edOn:true, taxOn:true, psr:false },
  { preset:'custom', P:100000, contrib:2000, contribFreq:'weekly', rate:8.5, compound:12, years:3, edOn:true, taxOn:true, psr:true },
);
for (const c of depositCases) vectors.deposit.push({ input: c, output: runDeposit(c) });
```

- [ ] **Step 2: Add settlement collection-for-IRR vectors via the same stub**

```js
(0, eval)(extract('settleUpdateTotals'));
vectors.settlementCollection = [];
for (const recv of [
  [{name:'URPA',receivable:50000,waiver:0},{name:'Principal Overdue',receivable:600000,waiver:0},
   {name:'Interest Overdue',receivable:60000,waiver:0},{name:'Late Payment Interest (LPI)',receivable:25000,waiver:20000},
   {name:'Excise Duty',receivable:3000,waiver:0},{name:'Supervision Fee',receivable:8000,waiver:8000},
   {name:'Legal Fee',receivable:12000,waiver:0}],
  [{name:'Excise Duty',receivable:5000,waiver:5000},{name:'Legal Fee',receivable:10000,waiver:10000}], // all excluded+waived -> negative
  [{name:'Principal Overdue',receivable:100000,waiver:100000}],                                        // fully waived -> 0
  [],
]) {
  globalThis.settleRecv = recv;
  settleUpdateTotals();
  vectors.settlementCollection.push({ recv, collIRR: parseFloat(el('s-settle-amt-val').value) });
}
```

- [ ] **Step 3: Regenerate, sanity-check the known default**

Run: `node tools/generate-golden-vectors.mjs`
Expected: the `{preset:'custom',P:100000,contrib:5000,rate:8.5,compound:12,years:15,psr:true}` case outputs `future:2178010, net:1974797, ed:20800, tax:110622` — the byte-verified defaults from this session.

- [ ] **Step 4: Commit (web repo)**

```bash
git add tools/generate-golden-vectors.mjs tools/golden-vectors.json
git commit -m "feat: golden vectors for deposit projections and settlement collection rule"
git push origin main
```

---

### Task 3: Create the `incalc-ios` repo + Swift package scaffold

**Files (new repo `~/Projects/incalc-ios`):**
- Create: `Package.swift`, `Sources/InCalcEngine/.gitkeep` placeholder removed by Task 4, `Tests/InCalcEngineTests/Fixtures/golden-vectors.json` (copied), `README.md`, `AGENTS.md`, `VISION.md`, `AGENT_LEARNINGS.md`, `.gitignore`

- [ ] **Step 1: Create repo and scaffold**

```bash
gh repo create clauding-lab/incalc-ios --private --description "InCalc BD — native iOS app (SwiftUI)" --clone ~/Projects/incalc-ios
cd ~/Projects/incalc-ios
mkdir -p Sources/InCalcEngine Tests/InCalcEngineTests/Fixtures
cp ~/Projects/InCalc/tools/golden-vectors.json Tests/InCalcEngineTests/Fixtures/
```

- [ ] **Step 2: Write Package.swift**

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InCalcEngine",
    platforms: [.iOS(.v17), .macOS(.v13)],   // macOS so `swift test` runs on the Mac
    products: [.library(name: "InCalcEngine", targets: ["InCalcEngine"])],
    targets: [
        .target(name: "InCalcEngine"),
        .testTarget(name: "InCalcEngineTests", dependencies: ["InCalcEngine"],
                    resources: [.copy("Fixtures")]),
    ]
)
```

- [ ] **Step 3: Write the vector-loading test helper**

Create `Tests/InCalcEngineTests/Vectors.swift`:

```swift
import Foundation
import XCTest

enum Vectors {
    static let root: [String: Any] = {
        let url = Bundle.module.url(forResource: "Fixtures/golden-vectors", withExtension: "json")!
        let data = try! Data(contentsOf: url)
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()
    static func section(_ name: String) -> [[String: Any]] { root[name] as! [[String: Any]] }
}

func XCTAssertClose(_ a: Double, _ b: Double, rel: Double = 1e-9,
                    _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
    let scale = max(abs(a), abs(b), 1.0)
    XCTAssertLessThanOrEqual(abs(a - b), rel * scale, "\(message) (\(a) vs \(b))", file: file, line: line)
}
/// JSON numbers arrive as Any — normalize. JS NaN was emitted as null -> returns nil.
func dbl(_ v: Any?) -> Double? {
    if v is NSNull || v == nil { return nil }
    return (v as! NSNumber).doubleValue
}
```

- [ ] **Step 4: Governance files + first commit**

`README.md` (3 lines: what it is, points to web repo + spec), `VISION.md` and `AGENT_LEARNINGS.md` from `~/.claude/governance/` templates, `AGENTS.md` with the cross-repo landmine: *"Regulatory values change WEB-FIRST → run `node tools/generate-golden-vectors.mjs` there → copy `golden-vectors.json` into `Tests/InCalcEngineTests/Fixtures/` → mirror the table in Swift → `swift test` green. Engine files mirror named web functions — do not 'improve' math unilaterally."* `.gitignore`: `.build/`, `*.xcuserdata*`, `.DS_Store`.

```bash
swift build   # expected: succeeds (empty target warning is fine)
git add -A && git commit -m "chore: scaffold InCalcEngine Swift package with golden-vector fixtures"
git push -u origin main
```

Also (web repo): append the paired landmine to `~/Projects/InCalc/AGENTS.md` Landmines section: *"8. The iOS app (clauding-lab/incalc-ios) ports this engine. Any change to CONFIG, getED, or calculation behavior requires regenerating tools/golden-vectors.json and updating the Swift engine — see incalc-ios/AGENTS.md."* Commit there: `docs: add iOS golden-vector landmine to AGENTS.md`.

---

### Task 4: Money formatting (Swift)

**Files:**
- Create: `Sources/InCalcEngine/Money.swift`
- Test: `Tests/InCalcEngineTests/MoneyTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import InCalcEngine

final class MoneyTests: XCTestCase {
    func testFmtMatchesGoldenVectors() {
        for v in Vectors.section("money") {
            let n = dbl(v["n"])!
            XCTAssertEqual(Money.fmt(n), v["fmt"] as! String, "fmt(\(n))")
            XCTAssertEqual(Money.grp(n), v["grp"] as! String, "grp(\(n))")
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails** — `swift test 2>&1 | tail -5` → FAIL: `cannot find 'Money'`.

- [ ] **Step 3: Implement (direct port of web fmt/grp, BDT-only — no toDisp, no Infinity input expected but guard anyway)**

```swift
import Foundation

public enum Money {
    /// Mirror of web `fmt` in BDT mode: round, then lakh/crore grouping with ৳.
    public static func fmt(_ n: Double) -> String {
        let v = n.isFinite ? n : 0
        let r = Int(v.rounded())                 // JS Math.round: half away from zero for positives; see note
        let neg = r < 0
        var s = String(abs(r))
        if s.count <= 3 { return (neg ? "-" : "") + "৳" + s }
        var out = "," + String(s.suffix(3)); s = String(s.dropLast(3))
        while s.count > 2 { out = "," + s.suffix(2) + out; s = String(s.dropLast(2)) }
        return (neg ? "-" : "") + "৳" + s + out
    }
    /// Mirror of web `grp`: en-IN grouping, 2 decimals, no symbol.
    public static func grp(_ n: Double) -> String {
        let v = n.isFinite ? n : 0
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_IN")
        f.minimumFractionDigits = 2; f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: v))!
    }
}
```

**Note:** JS `Math.round(-0.5) == -0` (rounds toward +∞ for .5); Swift `rounded()` rounds half away from zero. The vectors include `49108.4/49108.6` to catch drift; if a negative-half case ever appears, port with `(v - 0.5).rounded(.up)` semantics — the current vector set decides.

- [ ] **Step 4: Run to verify pass** — `swift test 2>&1 | tail -5` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Money formatter matching web fmt/grp vectors"`

---

### Task 5: ExciseDuty + Config (Swift)

**Files:**
- Create: `Sources/InCalcEngine/Config.swift`, `Sources/InCalcEngine/ExciseDuty.swift`
- Test: `Tests/InCalcEngineTests/ExciseDutyTests.swift`

- [ ] **Step 1: Failing test**

```swift
import XCTest
@testable import InCalcEngine

final class ExciseDutyTests: XCTestCase {
    func testAllSlabBoundaries() {
        for v in Vectors.section("getED") {
            XCTAssertEqual(ExciseDuty.annual(yearEndBalance: dbl(v["bal"])!), dbl(v["ed"])!,
                           "getED(\(dbl(v["bal"])!))")
        }
    }
}
```

- [ ] **Step 2: Run — FAIL** (`cannot find 'ExciseDuty'`).
- [ ] **Step 3: Implement**

```swift
// Config.swift
public enum Config {
    /// NBR source tax (TDS) on deposit interest, by proof-of-return (PSR) status. FY2025-26.
    public static let sourceTaxWithReturnProof = 0.10
    public static let sourceTaxWithoutReturnProof = 0.15
    /// DSCR proposed-loan processing fee. FY2025-26.
    public static let loanProcFeeRate = 0.01
}

// ExciseDuty.swift
public enum ExciseDuty {
    /// NBR excise duty slabs FY2025-26 (effective 1 Jul 2025) — mirror of web getED().
    /// RE-CHECK after every national budget; change WEB-FIRST, then regenerate vectors.
    public static func annual(yearEndBalance bal: Double) -> Double {
        if bal <= 300_000    { return 0 }
        if bal <= 500_000    { return 150 }
        if bal <= 1_000_000  { return 500 }
        if bal <= 5_000_000  { return 3_000 }
        if bal <= 10_000_000 { return 5_000 }
        if bal <= 20_000_000 { return 10_000 }
        if bal <= 50_000_000 { return 20_000 }
        return 50_000
    }
}
```

- [ ] **Step 4: Run — PASS.**  Step 5: Commit `feat: ExciseDuty FY2025-26 slabs + Config constants`.

---

### Task 6: Loan engine (Swift)

**Files:**
- Create: `Sources/InCalcEngine/Loan.swift`
- Test: `Tests/InCalcEngineTests/LoanTests.swift`

- [ ] **Step 1: Failing tests (EMI grid, schedules incl. rows, EAR incl. null cases)**

```swift
import XCTest
@testable import InCalcEngine

final class LoanTests: XCTestCase {
    func testEmiGrid() {
        for v in Vectors.section("emi") {
            let got = Loan.emi(pv: dbl(v["pv"])!, monthlyRate: dbl(v["r"])!, months: Int(dbl(v["n"])!))
            if let want = dbl(v["emi"]) { XCTAssertClose(got, want) } else { XCTAssertEqual(got, 0) }
        }
    }
    func testSchedules() {
        for v in Vectors.section("loanSchedule") {
            let s = Loan.buildSchedule(principal: dbl(v["P"])!, annualRatePct: dbl(v["rate"])!,
                                       years: Int(dbl(v["years"])!), extraMonthly: dbl(v["extra"])!)
            XCTAssertClose(s.emi, dbl(v["emi"])!)
            XCTAssertClose(s.totalInterest, dbl(v["totalInterest"])!)
            XCTAssertClose(s.totalPaid, dbl(v["totalPaid"])!)
            XCTAssertEqual(s.totalMonths, Int(dbl(v["totalMonths"])!))
            let rows = v["rows"] as! [[String: Any]]
            XCTAssertEqual(s.rows.count, rows.count)
            for (got, want) in zip(s.rows, rows) {
                XCTAssertEqual(got.year, Int(dbl(want["year"])!))
                XCTAssertClose(got.open, dbl(want["open"])!)
                XCTAssertClose(got.principal, dbl(want["principal"])!)
                XCTAssertClose(got.interest, dbl(want["interest"])!)
                XCTAssertClose(got.close, dbl(want["close"])!)
            }
        }
    }
    func testEffectiveRate() {
        for v in Vectors.section("effectiveRate") {
            let got = Loan.effectiveRate(principal: dbl(v["P"])!, nominalRatePct: dbl(v["rate"])!,
                                         years: Int(dbl(v["years"])!), emi: dbl(v["emi"])!,
                                         advanceEMIs: Int(dbl(v["advEMI"])!),
                                         cashSecurity: dbl(v["csAmt"])!, csAnnualRatePct: dbl(v["csRate"])!)
            if let want = v["result"] as? [String: Any] {
                XCTAssertClose(got!.effectiveRate, dbl(want["effectiveRate"])!)
                XCTAssertClose(got!.netDisbursement, dbl(want["netDisbursement"])!)
                XCTAssertClose(got!.csInterest, dbl(want["csInterest"])!)
                XCTAssertClose(got!.rateMarkup, dbl(want["rateMarkup"])!)
            } else { XCTAssertNil(got) }
        }
    }
}
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement — line-faithful port of web `emiFormula`/`buildSchedule`/`calcEffectiveRate`**

```swift
import Foundation

public enum Loan {
    /// Mirror of web emiFormula(pv,r,n): r>0 ? annuity : (n>0 ? pv/n : 0)
    public static func emi(pv: Double, monthlyRate r: Double, months n: Int) -> Double {
        if r > 0 { return pv * r * pow(1 + r, Double(n)) / (pow(1 + r, Double(n)) - 1) }
        return n > 0 ? pv / Double(n) : 0
    }

    public struct YearRow: Equatable { public let year: Int, open: Double, principal: Double, interest: Double, close: Double }
    public struct Schedule { public let emi: Double, rows: [YearRow], totalPaid: Double, totalInterest: Double, totalMonths: Int }

    /// Mirror of web buildSchedule(P,rate,years,extra) — including the <0.01 stop and Math.min payment cap.
    public static func buildSchedule(principal P: Double, annualRatePct rate: Double,
                                     years: Int, extraMonthly extra: Double) -> Schedule {
        let rM = rate / 100 / 12, n = years * 12
        let emi = Self.emi(pv: P, monthlyRate: rM, months: n)
        var rows: [YearRow] = [], balance = P, totInt = 0.0, totMo = 0
        for y in 1...max(years, 1) {
            if balance < 0.01 { break }
            var yP = 0.0, yI = 0.0; let open = balance
            for _ in 0..<12 {
                if balance < 0.01 { break }
                let ic = balance * rM
                let pc = min(emi + extra - ic, balance)
                yI += ic; yP += pc; totInt += ic
                balance = max(0, balance - pc); totMo += 1
            }
            rows.append(YearRow(year: y, open: open, principal: yP, interest: yI, close: balance))
        }
        return Schedule(emi: emi, rows: rows, totalPaid: P + totInt, totalInterest: totInt, totalMonths: totMo)
    }

    public struct EffectiveRate { public let effectiveRate: Double, netDisbursement: Double, csInterest: Double, rateMarkup: Double }

    /// Mirror of web calcEffectiveRate — Newton on the monthly cash-flow vector, EAR annualization.
    public static func effectiveRate(principal P: Double, nominalRatePct nomRate: Double, years: Int,
                                     emi: Double, advanceEMIs advEMI: Int,
                                     cashSecurity csAmt: Double, csAnnualRatePct: Double) -> EffectiveRate? {
        let N = years * 12
        let csMonthlyRate = csAnnualRatePct / 100 / 12
        let netDisb = P - (Double(advEMI) * emi) - csAmt
        if netDisb <= 0 { return nil }
        let csReturn = csAmt > 0 ? csAmt * pow(1 + csMonthlyRate, Double(N)) : 0
        let csInterest = csReturn - csAmt
        let payMonths = N - advEMI
        var cf = [Double](repeating: 0, count: N + 1)
        cf[0] = netDisb
        for t in 1...max(payMonths, 1) where t <= payMonths { cf[t] = -emi }
        cf[N] += csReturn
        var r = nomRate / 100 / 12
        for _ in 0..<200 {
            var npv = 0.0, dnpv = 0.0
            for t in 0...N {
                if cf[t] == 0 && t > 0 { continue }
                let d = pow(1 + r, Double(t))
                npv += cf[t] / d
                if t > 0 { dnpv += -Double(t) * cf[t] / (d * (1 + r)) }
            }
            if abs(dnpv) < 1e-15 { break }
            let step = npv / dnpv
            r -= step
            if r <= -1 { r = 0.0001 }
            if abs(step) < 1e-10 { break }
        }
        let effAnnual = (pow(1 + r, 12) - 1) * 100
        return EffectiveRate(effectiveRate: effAnnual, netDisbursement: netDisb,
                             csInterest: csInterest, rateMarkup: effAnnual - nomRate)
    }
}
```

- [ ] **Step 4: Run — PASS** (`swift test --filter LoanTests`). If the EAR null cases disagree, check the web gate: the all-zero case (`advEMI:0, csAmt:0`) returns a *non-null* result in raw `calcEffectiveRate` — the vectors hold the truth; match them, not assumptions.
- [ ] **Step 5: Commit** — `feat: Loan engine (EMI, amortization, EAR) matching golden vectors`

---

### Task 7: DSCR engine (Swift)

**Files:**
- Create: `Sources/InCalcEngine/DSCR.swift`
- Test: `Tests/InCalcEngineTests/DSCRTests.swift`

- [ ] **Step 1: Failing test**

```swift
import XCTest
@testable import InCalcEngine

final class DSCRTests: XCTestCase {
    func testProposedLoanVectors() {
        for v in Vectors.section("dscr") {
            let r = DSCR.proposedLoan(amount: dbl(v["loanAmt"])!, tenorMonths: Int(dbl(v["tenor"])!),
                                      annualRatePct: dbl(v["ratePct"])!, advanceInstallments: Int(dbl(v["advInst"])!),
                                      fdrAmount: dbl(v["fdrAmt"])!, fdrRatePct: dbl(v["fdrRate"])!,
                                      poolRatePct: dbl(v["poolRate"])!)
            XCTAssertEqual(r.emi, dbl(v["emi"])!)                       // exact: round-to-10 integers
            XCTAssertEqual(r.fvFdr, dbl(v["fvFdr"])!)
            XCTAssertEqual(r.fvPool, dbl(v["fvPool"])!)
            if let want = dbl(v["irrNoSaveAnnual"]) { XCTAssertClose(r.irrNoSaveAnnual!, want) }
            else { XCTAssertNil(r.irrNoSaveAnnual) }
            if let want = dbl(v["irrWithSaveAnnual"]) { XCTAssertClose(r.irrWithSaveAnnual!, want) }
            else { XCTAssertNil(r.irrWithSaveAnnual) }
        }
    }
}
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement (ports dscrPMT/dscrFV/dscrIRR + the calcDSCR IRR segment incl. round-up-to-10 and savings credit)**

```swift
import Foundation

public enum DSCR {
    /// Mirror of web dscrPMT — shared annuity formula.
    public static func pmt(monthlyRate: Double, months: Int, pv: Double) -> Double {
        Loan.emi(pv: pv, monthlyRate: monthlyRate, months: months)
    }
    /// Mirror of web dscrFV.
    public static func fv(rate: Double, periods: Double, pv: Double) -> Double { pv * pow(1 + rate, periods) }

    /// Mirror of web dscrIRR — Newton for evenly spaced periods; nil where JS returned NaN.
    public static func irr(_ cashflows: [Double], guess: Double = 0.015) -> Double? {
        if !cashflows.contains(where: { abs($0) > 1e-9 }) { return nil }
        var rate = guess
        for _ in 0..<300 {
            var npv = 0.0, dnpv = 0.0
            for (t, cf) in cashflows.enumerated() {
                let d = pow(1 + rate, Double(t))
                npv += cf / d
                if t > 0 { dnpv -= Double(t) * cf / pow(1 + rate, Double(t) + 1) }
            }
            if abs(npv) < 1e-8 { return rate }
            let newRate = rate - npv / dnpv
            if !newRate.isFinite || newRate <= -1 { return nil }
            rate = newRate
        }
        return nil
    }

    public struct ProposedLoan {
        public let emi: Double, fvFdr: Double, fvPool: Double, costSavings: Double
        public let netDisburse: Double, activeTenor: Int
        public let cashflowsNoSave: [Double], cashflowsWithSave: [Double]
        public let irrNoSaveAnnual: Double?, irrWithSaveAnnual: Double?
    }

    /// Mirror of calcDSCR's proposed-loan/IRR segment: EMI rounded UP to nearest 10,
    /// full-tenor cash flows, savings credited in the final active month, gated IRR.
    public static func proposedLoan(amount loanAmt: Double, tenorMonths tenor: Int, annualRatePct: Double,
                                    advanceInstallments advInst: Int,
                                    fdrAmount fdrAmt: Double, fdrRatePct: Double, poolRatePct: Double) -> ProposedLoan {
        let monthlyRate = annualRatePct / 100 / 12
        var emi = 0.0
        if tenor > 0 && loanAmt > 0 {
            emi = pmt(monthlyRate: monthlyRate, months: tenor, pv: loanAmt)
            emi = ((emi + 4.999) / 10).rounded() * 10          // JS: Math.round((emi+4.999)/10)*10
        }
        let tenorYears = Double(tenor) / 12
        let fvFdr  = fdrAmt > 0 && tenorYears > 0 ? (fv(rate: fdrRatePct / 100,  periods: tenorYears, pv: fdrAmt)).rounded() : 0
        let fvPool = fdrAmt > 0 && tenorYears > 0 ? (fv(rate: poolRatePct / 100, periods: tenorYears, pv: fdrAmt)).rounded() : 0
        let costSavings = fvPool - fvFdr
        let loanDeposit = emi * Double(advInst)
        let netDisburse = loanAmt - loanDeposit
        let activeTenor = tenor - advInst
        var cfNo: [Double] = [-netDisburse], cfWith: [Double] = [-netDisburse]
        if activeTenor > 0 {
            for m in 1...activeTenor { cfNo.append(emi); cfWith.append(m == activeTenor ? emi + costSavings : emi) }
        }
        let irrValid = netDisburse > 0 && emi > 0 && activeTenor > 0
        return ProposedLoan(emi: emi, fvFdr: fvFdr, fvPool: fvPool, costSavings: costSavings,
                            netDisburse: netDisburse, activeTenor: activeTenor,
                            cashflowsNoSave: cfNo, cashflowsWithSave: cfWith,
                            irrNoSaveAnnual: irrValid ? irr(cfNo).map { $0 * 12 } : nil,
                            irrWithSaveAnnual: irrValid ? irr(cfWith).map { $0 * 12 } : nil)
    }
}
```

**Rounding caveat:** JS `Math.round` rounds half toward +∞; Swift `.rounded()` rounds half away from zero. Both EMI (always positive after +4.999) and FV (positive) are unaffected; the vectors prove it. If a vector fails on a .5 boundary, use `(x + 0.5).rounded(.down)` to mirror JS exactly.

- [ ] **Step 4: Run — PASS** (`swift test --filter DSCRTests`).
- [ ] **Step 5: Commit** — `feat: DSCR engine (PMT, IRR, FV, full-tenor cashflows) matching golden vectors`

---

### Task 8: Settlement engine (Swift)

**Files:**
- Create: `Sources/InCalcEngine/Settlement.swift`
- Test: `Tests/InCalcEngineTests/SettlementTests.swift`

- [ ] **Step 1: Failing test**

```swift
import XCTest
@testable import InCalcEngine

final class SettlementTests: XCTestCase {
    private let iso: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Asia/Dhaka"); return f
    }()
    func testXIRRVectors() {
        for v in Vectors.section("xirr") {
            let flows = (v["cashflows"] as! [Any]).map { ($0 as! NSNumber).doubleValue }
            let dates = (v["dates"] as! [String]).map { iso.date(from: $0)! }
            let got = Settlement.xirr(cashflows: flows, dates: dates)
            if let want = dbl(v["rate"]) { XCTAssertClose(got!, want, rel: 1e-7) } else { XCTAssertNil(got) }
        }
    }
    func testCollectionForIRR() {
        for v in Vectors.section("settlementCollection") {
            let recv = (v["recv"] as! [[String: Any]]).map {
                Settlement.Receivable(name: $0["name"] as! String,
                                      receivable: dbl($0["receivable"])!, waiver: dbl($0["waiver"])!)
            }
            XCTAssertClose(Settlement.collectionForIRR(recv), dbl(v["collIRR"])!, rel: 1e-9)
        }
    }
}
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement (port of web xirr + the excise/legal exclusion rule)**

```swift
import Foundation

public enum Settlement {
    public struct Receivable { public let name: String, receivable: Double, waiver: Double
        public init(name: String, receivable: Double, waiver: Double) {
            self.name = name; self.receivable = receivable; self.waiver = waiver } }

    /// Mirror of the web collection-for-IRR rule: sum adjustments of non-excise/legal rows,
    /// minus the WAIVERS of excise/legal rows.
    public static func collectionForIRR(_ rows: [Receivable]) -> Double {
        var coll = 0.0, excl = 0.0
        for r in rows {
            let nm = r.name.lowercased()
            if nm.contains("excise") || nm.contains("legal") { excl += r.waiver }
            else { coll += r.receivable - r.waiver }
        }
        return coll - excl
    }

    /// Mirror of web xirr: Newton from 0.1, day-count /365, |npv|<1 acceptance, nil for NaN.
    public static func xirr(cashflows: [Double], dates: [Date]) -> Double? {
        guard cashflows.count == dates.count, cashflows.count >= 2 else { return nil }
        let d0 = dates[0].timeIntervalSince1970
        let years = dates.map { ($0.timeIntervalSince1970 - d0) / 86_400 / 365.0 }
        func npv(_ rate: Double) -> Double {
            zip(cashflows, years).reduce(0) { $0 + $1.0 / pow(1 + rate, $1.1) }
        }
        func dnpv(_ rate: Double) -> Double {
            zip(cashflows, years).reduce(0) { $1.1 == 0 ? $0 : $0 + (-$1.1 * $1.0 / pow(1 + rate, $1.1 + 1)) }
        }
        var rate = 0.1
        for _ in 0..<300 {
            let nv = npv(rate), dv = dnpv(rate)
            if abs(dv) < 1e-14 { break }
            let step = nv / dv
            rate -= step
            if rate <= -1 { rate = -0.99 }
            if abs(step) < 1e-10 && abs(nv) < 1e-6 { break }
        }
        let final = npv(rate)
        return (abs(final) < 1 && rate.isFinite) ? rate : nil
    }
}
```

**Date caveat (load-bearing):** the generator's JS `new Date('yyyy-mm-dd')` parses as **UTC midnight**; day-count differences are date-minus-date so any consistent timezone works — but the Swift test parses in Asia/Dhaka. If the XIRR vectors disagree at >1e-7, switch the test formatter to `TimeZone(identifier: "UTC")` to match JS exactly, and note in `Settlement.swift` that callers must build `Date`s consistently (Plan 2's Excel parser formats in local time — the *strings* round-trip, the XIRR day deltas are identical either way because all dates shift together).

- [ ] **Step 4: Run — PASS.**  Step 5: Commit `feat: Settlement engine (XIRR + collection rule) matching golden vectors`

---

### Task 9: Deposit engine (Swift) — the big port

**Files:**
- Create: `Sources/InCalcEngine/Deposit.swift`
- Test: `Tests/InCalcEngineTests/DepositTests.swift`

The web source of truth is `calcDeposit`'s three computation paths (MBS simple-interest; weekly loop; monthly loop). Port them **with quirks**: full-period interest credited on the compounding month regardless of when contributions landed; ED applied to year-end net balance; contributions skipped for FD; the final-partial-year compounding trigger `(monthsThisYear<12 && mo===monthsThisYear-1)`; weekly compounding every `52/n` weeks with `wSinceComp` carry-over.

- [ ] **Step 1: Failing test**

```swift
import XCTest
@testable import InCalcEngine

final class DepositTests: XCTestCase {
    func testDepositVectors() {
        for v in Vectors.section("deposit") {
            let c = v["input"] as! [String: Any], out = v["output"] as! [String: Any]
            let preset = Deposit.Preset(rawValue: c["preset"] as! String)!
            let input = Deposit.Input(
                preset: preset,
                principal: dbl(c["P"]) ?? 0,
                contribution: dbl(c["contrib"]) ?? 0,
                weeklyAmount: dbl(c["weekly"]) ?? 0,
                contributionFrequency: (c["contribFreq"] as? String) == "weekly" ? .weekly : .monthly,
                annualRatePct: dbl(c["rate"])!,
                compoundingPerYear: Int(dbl(c["compound"])!),
                years: dbl(c["actualYears"]) ?? dbl(c["years"])!,
                exciseDutyOn: c["edOn"] as! Bool,
                sourceTaxOn: c["taxOn"] as! Bool,
                hasReturnProof: c["psr"] as! Bool)
            let r = Deposit.project(input)
            // Display contract: rounded-taka equality with what the web app showed
            XCTAssertEqual(r.futureGross.rounded(), dbl(out["future"])!, "future \(c)")
            XCTAssertEqual(r.totalGrossInterest.rounded(), dbl(out["interest"])!, "interest \(c)")
            XCTAssertEqual(r.totalInvested.rounded(), dbl(out["invested"])!, "invested \(c)")
            XCTAssertEqual(r.totalED.rounded(), dbl(out["ed"])!, "ed \(c)")
            XCTAssertEqual(r.totalTax.rounded(), dbl(out["tax"])!, "tax \(c)")
            XCTAssertEqual(r.netReceivable.rounded(), dbl(out["net"])!, "net \(c)")
            XCTAssertClose(r.effectiveAnnualYieldPct, dbl(out["eay"])!, rel: 1e-3) // displayed at 3dp
        }
    }
}
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```swift
import Foundation

public enum Deposit {
    public enum Preset: String { case fd, dps, wds, mbs, custom }
    public enum ContributionFrequency { case monthly, weekly }

    public struct Input {
        public let preset: Preset
        public let principal: Double
        public let contribution: Double          // monthly amount (non-WDS)
        public let weeklyAmount: Double          // WDS only
        public let contributionFrequency: ContributionFrequency
        public let annualRatePct: Double
        public let compoundingPerYear: Int       // 12 / 4 / 2 / 1
        public let years: Double                 // may be fractional (0.25, 0.5 ...)
        public let exciseDutyOn: Bool
        public let sourceTaxOn: Bool
        public let hasReturnProof: Bool          // PSR -> 10%, else 15%
        public init(preset: Preset, principal: Double, contribution: Double, weeklyAmount: Double,
                    contributionFrequency: ContributionFrequency, annualRatePct: Double,
                    compoundingPerYear: Int, years: Double, exciseDutyOn: Bool,
                    sourceTaxOn: Bool, hasReturnProof: Bool) {
            self.preset = preset; self.principal = principal; self.contribution = contribution
            self.weeklyAmount = weeklyAmount; self.contributionFrequency = contributionFrequency
            self.annualRatePct = annualRatePct; self.compoundingPerYear = compoundingPerYear
            self.years = years; self.exciseDutyOn = exciseDutyOn
            self.sourceTaxOn = sourceTaxOn; self.hasReturnProof = hasReturnProof
        }
    }

    public struct YearRow {
        public let year: Int, openNet: Double, contribution: Double
        public let grossInterest: Double, netInterest: Double, exciseDuty: Double, tax: Double
        public let grossClose: Double, netClose: Double
    }
    public struct Result {
        public let futureGross: Double, totalGrossInterest: Double, totalInvested: Double
        public let totalED: Double, totalTax: Double, netReceivable: Double
        public let effectiveAnnualYieldPct: Double
        public let rows: [YearRow]
        public let monthlyPayout: Double         // MBS only, else 0
    }

    /// Mirror of web calcDeposit's three computation paths (MBS / weekly / monthly), quirks included.
    public static func project(_ c: Input) -> Result {
        let taxRate = c.hasReturnProof ? Config.sourceTaxWithReturnProof : Config.sourceTaxWithoutReturnProof
        let rate = c.annualRatePct, n = Double(c.compoundingPerYear)
        let totalMonths = Int((c.years * 12).rounded())

        // ── MBS: simple-interest payout, principal returned at maturity ──
        if c.preset == .mbs {
            let P = c.principal
            let monthlyPayout = (P * rate / 100) / 12
            let grossInterest = monthlyPayout * Double(totalMonths)
            let grossFV = P + grossInterest
            let fullYears = Int(c.years.rounded(.down))
            var totalED = 0.0
            if c.exciseDutyOn { for _ in 0..<fullYears { totalED += ExciseDuty.annual(yearEndBalance: P) } }
            let totalTax = c.sourceTaxOn ? grossInterest * taxRate : 0
            var rows: [YearRow] = []
            let yED = c.exciseDutyOn ? ExciseDuty.annual(yearEndBalance: P) : 0
            let yPay = monthlyPayout * 12, yTax = c.sourceTaxOn ? yPay * taxRate : 0
            for y in 1...max(1, fullYears) {
                rows.append(YearRow(year: y, openNet: P, contribution: 0,
                                    grossInterest: yPay * Double(y), netInterest: 0,
                                    exciseDuty: yED * Double(y), tax: yTax * Double(y),
                                    grossClose: P + yPay * Double(y),
                                    netClose: P + yPay * Double(y) - yED * Double(y) - yTax * Double(y)))
            }
            return Result(futureGross: grossFV, totalGrossInterest: grossInterest, totalInvested: P,
                          totalED: totalED, totalTax: totalTax, netReceivable: grossFV - totalED - totalTax,
                          effectiveAnnualYieldPct: rate, rows: rows, monthlyPayout: monthlyPayout)
        }

        // ── Compound paths ──
        var grossBal = c.principal, netBal = c.principal
        var totalContrib = 0.0, totalED = 0.0, totalTax = 0.0, totalGrossInterest = 0.0
        var rows: [YearRow] = []
        let fullYears = Int(c.years.rounded(.up))
        let isFD = c.preset == .fd
        let contribAmt = c.preset == .wds ? c.weeklyAmount : c.contribution
        let weekly = c.preset == .wds || c.contributionFrequency == .weekly

        if weekly {
            let rPer = rate / 100 / n
            let compEveryW = 52.0 / n
            var wSinceComp = 0.0
            for y in 1...fullYears {
                let isLast = (y == fullYears) && (c.years != Double(fullYears))
                let weeksThisYear = isLast ? Int(((c.years - Double(y - 1)) * 52).rounded()) : 52
                let openNet = netBal
                var yiGross = 0.0, yiNet = 0.0, yc = 0.0, yTax = 0.0
                for _ in 0..<weeksThisYear {
                    grossBal += contribAmt; netBal += contribAmt; yc += contribAmt; totalContrib += contribAmt
                    wSinceComp += 1
                    if wSinceComp >= compEveryW {
                        wSinceComp -= compEveryW
                        let gInt = grossBal * rPer; yiGross += gInt; grossBal += gInt; totalGrossInterest += gInt
                        var nInt = netBal * rPer
                        if c.sourceTaxOn { let t = nInt * taxRate; nInt -= t; yTax += t; totalTax += t }
                        yiNet += nInt; netBal += nInt
                    }
                }
                var yED = 0.0
                if c.exciseDutyOn { yED = ExciseDuty.annual(yearEndBalance: netBal); netBal -= yED; totalED += yED }
                rows.append(YearRow(year: y, openNet: openNet, contribution: yc, grossInterest: yiGross,
                                    netInterest: yiNet, exciseDuty: yED, tax: yTax,
                                    grossClose: grossBal, netClose: netBal))
            }
        } else {
            for y in 1...fullYears {
                let monthsThisYear = (y == fullYears && totalMonths % 12 != 0 && c.years < Double(fullYears))
                    ? (totalMonths - (y - 1) * 12) : 12
                let openNet = netBal
                var yiGross = 0.0, yiNet = 0.0, yc = 0.0, yTax = 0.0
                for mo in 0..<monthsThisYear {
                    if !isFD {
                        grossBal += contribAmt; netBal += contribAmt; yc += contribAmt; totalContrib += contribAmt
                    }
                    let nI = c.compoundingPerYear
                    let doC = (nI == 12) || (nI == 4 && mo % 3 == 2) || (nI == 2 && mo % 6 == 5)
                           || (nI == 1 && mo == 11) || (monthsThisYear < 12 && mo == monthsThisYear - 1)
                    if doC {
                        let rp = rate / 100 / n
                        let gInt = grossBal * rp; yiGross += gInt; grossBal += gInt; totalGrossInterest += gInt
                        var nInt = netBal * rp
                        if c.sourceTaxOn { let t = nInt * taxRate; nInt -= t; yTax += t; totalTax += t }
                        yiNet += nInt; netBal += nInt
                    }
                }
                var yED = 0.0
                if c.exciseDutyOn { yED = ExciseDuty.annual(yearEndBalance: netBal); netBal -= yED; totalED += yED }
                rows.append(YearRow(year: y, openNet: openNet, contribution: yc, grossInterest: yiGross,
                                    netInterest: yiNet, exciseDuty: yED, tax: yTax,
                                    grossClose: grossBal, netClose: netBal))
            }
        }
        let eay = (pow(1 + rate / 100 / n, n) - 1) * 100
        return Result(futureGross: grossBal, totalGrossInterest: totalGrossInterest,
                      totalInvested: c.principal + totalContrib, totalED: totalED, totalTax: totalTax,
                      netReceivable: netBal, effectiveAnnualYieldPct: eay, rows: rows, monthlyPayout: 0)
    }
}
```

- [ ] **Step 4: Run — PASS** (`swift test --filter DepositTests`). Debug protocol if a case fails: print the failing `input`, run the same case through the web stub (`node -e` one-off against the generator harness), and diff year rows to localize which loop diverges. The likeliest culprits: the partial-year `monthsThisYear` condition and the weekly `wSinceComp` float carry.
- [ ] **Step 5: Also assert year rows for three representative cases** (custom default, FD 3m fractional, WDS 0.5y) by extending the test to compare `rows` against `output.rows` (columns: year, open, contrib, grossInterest, ED, tax, netClose — matching the web table's column order) at rounded-taka level. Run — PASS.
- [ ] **Step 6: Commit** — `feat: Deposit engine (monthly/weekly/MBS paths) matching golden vectors`

---

### Task 10: Compare engine + full-suite gate + push

**Files:**
- Create: `Sources/InCalcEngine/Compare.swift`
- Test: `Tests/InCalcEngineTests/CompareTests.swift`

- [ ] **Step 1: Failing test**

```swift
import XCTest
@testable import InCalcEngine

final class CompareTests: XCTestCase {
    func testWinnerVectors() {
        for v in Vectors.section("compare") {
            let a = Compare.scenario(type: v["aType"] as! String == "loan" ? .loan : .deposit,
                                     amount: dbl(v["aAmt"])!, ratePct: dbl(v["aRate"])!, years: Int(dbl(v["aYears"])!))
            let b = Compare.scenario(type: v["bType"] as! String == "loan" ? .loan : .deposit,
                                     amount: dbl(v["bAmt"])!, ratePct: dbl(v["bRate"])!, years: Int(dbl(v["bYears"])!))
            XCTAssertEqual(a.finalValue, dbl(v["aFinal"])!)
            if let want = dbl(v["aTotalInt"]) { XCTAssertClose(a.totalInterest!, want) }
            XCTAssertEqual(Compare.winner(a: a, b: b), v["winner"] as! String)
        }
    }
}
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement (port of scenarioCalc; winner numeric, ties resolve to B exactly like the web)**

```swift
import Foundation

public enum Compare {
    public enum ScenarioType { case deposit, loan }
    public struct Scenario {
        public let type: ScenarioType
        public let yearEndValues: [Double]       // deposit: balance; loan: remaining balance (rounded like web)
        public let finalValue: Double
        public let totalInterest: Double?        // loan only
        public let emi: Double?                  // loan only
    }

    /// Mirror of web scenarioCalc.
    public static func scenario(type: ScenarioType, amount: Double, ratePct: Double, years: Int) -> Scenario {
        let rM = ratePct / 100 / 12
        switch type {
        case .deposit:
            var vals: [Double] = [], bal = amount
            for _ in 1...years { for _ in 0..<12 { bal += bal * rM }; vals.append(bal.rounded()) }
            return Scenario(type: .deposit, yearEndValues: vals, finalValue: vals.last!, totalInterest: nil, emi: nil)
        case .loan:
            let n = years * 12
            let emi = Loan.emi(pv: amount, monthlyRate: rM, months: n)
            let totalInt = emi * Double(n) - amount
            var vals: [Double] = [], bal = amount
            for _ in 1...years {
                for _ in 0..<12 { let ic = bal * rM; bal = max(0, bal - (emi - ic)) }
                vals.append(bal.rounded())
            }
            return Scenario(type: .loan, yearEndValues: vals, finalValue: vals.last!, totalInterest: totalInt, emi: emi)
        }
    }

    /// Web parity: loan-loan -> lower interest wins (tie -> B); deposit-deposit -> higher final wins (tie -> B).
    public static func winner(a: Scenario, b: Scenario) -> String {
        if a.type == .loan && b.type == .loan { return a.totalInterest! < b.totalInterest! ? "A" : "B" }
        return a.finalValue > b.finalValue ? "A" : "B"
    }
}
```

- [ ] **Step 4: Run the FULL suite** — `swift test 2>&1 | tail -3` → all tests PASS (Money, ExciseDuty, Loan, DSCR, Settlement, Deposit, Compare).
- [ ] **Step 5: Update AGENT_LEARNINGS.md** if any vector mismatch during Tasks 4–10 exposed a real JS/Swift semantic trap (rounding, dates, float order) — one entry per trap.
- [ ] **Step 6: Commit + push**

```bash
git add -A && git commit -m "feat: Compare engine; full golden-vector suite green"
git push origin main
```

---

## Self-review (done at write time)

- **Spec coverage:** §3 Engine modules → Tasks 4–10; §6 vectors incl. boundaries/Microsoft case/rows → Tasks 1–2; §8 cross-repo landmines → Task 3. Excel parsing, UI, store = Plans 2–4 by design.
- **Placeholders:** none — every step has runnable code or an exact command.
- **Type consistency:** `Loan.emi` used by DSCR (Task 7) and Compare (Task 10) matches Task 6's signature; `dbl`/`XCTAssertClose`/`Vectors.section` defined once in Task 3 and used in 4–10; `ExciseDuty.annual(yearEndBalance:)` consistent across 5 and 9.
- **Known judgment calls encoded:** JS-vs-Swift rounding (Tasks 4/7 notes), XIRR date timezone (Task 8 note), deposit display contract = rounded taka (Task 9), web tie-break semantics preserved (Task 10).
