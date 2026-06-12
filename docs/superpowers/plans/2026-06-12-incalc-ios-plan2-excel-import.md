# InCalc BD iOS — Plan 2: Excel Import (Settlement sheet parser)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Swift `SettlementSheetParser` that reads a settlement-workbook `.xlsx` via a vendored CoreXLSX and produces the exact same client/receivables/payments/dates the verified web `parseSettlementSheet` produces — proven by golden parse vectors generated from the real web parser — then feeds them through the Plan-1 `Settlement` engine to an end-to-end XIRR.

**Architecture:** Same web-first golden-vector contract as Plan 1, applied to parsing. A Node generator in the web repo (1) builds synthetic fixture `.xlsx` files programmatically (NEVER from a real file — see landmine), and (2) runs the REAL web `parseSettlementSheet` (+ `cellVal`/`cellDate`/`num`) under the Plan-1 DOM stub to emit `parse-vectors.json` (expected parse output per fixture). In `incalc-ios`, a new library target `InCalcExcelImport` (separate from the CoreXLSX-free `InCalcEngine`) vendors CoreXLSX 0.14.2 (fork + SchemaType patch), exposes an `XLSXSheet` A1-reference adapter, a pure `SettlementSheetParser` TDD'd against the fixtures, and a thin `SettlementCalculator` bridge that builds XIRR cashflows exactly like the web `calcSettlement` and calls the Plan-1 `Settlement.xirr` / `Settlement.collectionForIRR`.

**Tech Stack:** Node 20 + SheetJS (generator, already a CDN dep of the web app — run via `npx xlsx` or a vendored copy); Swift 5.9 SPM (`InCalcExcelImport` library target + tests), CoreXLSX 0.14.2 vendored as a local SwiftPM package under `Vendor/`, XCTest, `swift test`. The SwiftUI `.fileImporter` intake and the three-screen Settlement UI are **Plan 3**, not here — Plan 2 is the pure, testable parsing + bridge layer.

**Spec:** `docs/superpowers/specs/2026-06-12-incalc-ios-design.md` §5 (Excel import) and §6.3 (Excel fixtures). Web source of truth: `index.html` functions `parseSettlementSheet`, `cellVal`, `cellDate`, `formatDateInput`, `num`, and the cashflow segment of `calcSettlement`.

**Landmine (carries from Plan 1 / project landmine #1):** Fixture `.xlsx` files are generated programmatically with obviously fake data and verified through a parser before use. NEVER derive a sample/fixture from a real working file — office files are zip archives that retain hidden PII no visible-cell edit removes.

**Function/parity inventory ported (web → Swift):** `num` → `CellParse.number`; `cellDate` serial branch → `CellParse.excelSerialToISO`; `parseSettlementSheet` → `SettlementSheetParser.parse`; `calcSettlement` cashflow build → `SettlementCalculator.irr`. The collection-for-IRR rule and XIRR themselves are already shipped in Plan 1 (`Settlement.collectionForIRR`, `Settlement.xirr`) and are REUSED, not re-ported.

---

### Task 1: Web repo — synthetic fixtures + golden parse-vector generator

**Files:**
- Create: `tools/generate-parse-vectors.mjs`
- Output (committed): `tools/parse-fixtures/clean.xlsx`, `no-settlement.xlsx`, `scattered-blanks.xlsx`, `comma-negative.xlsx`
- Output (committed): `tools/parse-vectors.json`

This reuses the Plan-1 DOM-stub technique to run the REAL `parseSettlementSheet` headless, so the golden output is the actual web parser's behaviour — not a reimplementation.

- [ ] **Step 1: Generator skeleton — extract the real parser functions under the DOM stub**

```js
// tools/generate-parse-vectors.mjs
// Builds synthetic settlement-workbook fixtures (fake data only) and runs the REAL web
// parseSettlementSheet over them (under a DOM stub) to emit golden parse vectors for the
// Swift port. Node 20+. SheetJS is the only dep — load the same build the app uses.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as XLSX from 'xlsx';   // `npm i xlsx` in tools/, or vendor the 0.20.3 build the app pins

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];
function extract(name) {
  const i = main.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`function ${name} not found`);
  let depth = 0, j = main.indexOf('{', i);
  for (let k = j; k < main.length; k++) { if (main[k] === '{') depth++; if (main[k] === '}') { depth--; if (depth === 0) return main.slice(i, k + 1); } }
  throw new Error(`unbalanced braces in ${name}`);
}

// --- DOM stub (same shape as generate-golden-vectors.mjs) ---
const els = new Map();
function el(id) {
  if (!els.has(id)) els.set(id, { value:'', textContent:'', innerHTML:'', checked:false,
    style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false} }, dataset:{} });
  return els.get(id);
}
globalThis.document = { getElementById: el, querySelectorAll: () => [] };
globalThis.XLSX = XLSX;                               // parseSettlementSheet calls XLSX.SSF.parse_date_code
globalThis.escH = s => String(s);                     // file-badge escaper; output not asserted
globalThis.currency = 'BDT';
globalThis.settleRecv = []; globalThis.settlePay = [];
globalThis.defaultReceivables = ['URPA','Principal Overdue','Interest Overdue','Deferment Interest','Late Payment Interest (LPI)','Excise Duty','Others Receivable','Supervision Fees','Legal Fee'];
for (const fn of ['num','formatDateInput','cellVal','cellDate','renderSettleRecv','renderSettlePay','settleUpdateTotals','settleShowScreen'])
  try { (0, eval)(extract(fn)); } catch { /* render/show helpers may be no-ops under the stub; define fallbacks */ }
globalThis.renderSettleRecv = globalThis.renderSettleRecv || (() => {});
globalThis.renderSettlePay  = globalThis.renderSettlePay  || (() => {});
globalThis.settleShowScreen = () => {};
(0, eval)(extract('parseSettlementSheet'));
```

- [ ] **Step 2: Build the four synthetic fixtures (fake data only)**

```js
const dir = new URL('./parse-fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

// Helper: assemble a worksheet from an explicit cell map, write a one-sheet workbook.
function writeFixture(name, cells) {
  const ws = {};
  let maxR = 1, maxC = 0;
  for (const [ref, cell] of Object.entries(cells)) {
    ws[ref] = cell;
    const m = ref.match(/^([A-Z]+)(\d+)$/); const c = XLSX.utils.decode_col(m[1]), r = +m[2];
    if (r > maxR) maxR = r; if (c > maxC) maxC = c;
  }
  ws['!ref'] = XLSX.utils.encode_range({ s:{c:0,r:0}, e:{c:maxC, r:maxR-1} });
  const wb = { SheetNames:['Settlement'], Sheets:{ Settlement: ws } };
  XLSX.writeFile(wb, new URL(name, dir).pathname, { bookType:'xlsx', cellDates:false });
}
const S = v => ({ t:'s', v:String(v) });            // string cell
const N = v => ({ t:'n', v });                      // number cell
const D = serial => ({ t:'n', v:serial });          // Excel serial date cell (display format irrelevant to parser)
// Excel serials (epoch 1899-12-30): 2024-01-15 = 45306, 2024-02-15 = 45337, 2024-06-30 = 45473
const F = (formula, v) => ({ t:'n', f:formula, v }); // formula cell (settlement-row detection)

// FIXTURE 1 — "clean": full receivables, dated payments, a settlement row with BOTH a /H1[45]/ formula AND a "negotiat" label.
writeFixture('clean.xlsx', {
  D2:S('Test Client Ltd'), D3:S('0123456789'), D4:N(1000000), C9:D(45306), // disb 2024-01-15
  // Receivables G3:I11 — name, receivable, adjustment(=recv−waiver)
  G3:S('URPA'),              H3:N(50000),  I3:N(50000),
  G4:S('Principal Overdue'), H4:N(600000), I4:N(600000),
  G5:S('Interest Overdue'),  H5:N(60000),  I5:N(60000),
  G6:S('Late Payment Interest (LPI)'), H6:N(25000), I6:N(5000),   // waiver = max(0, 25000-5000)=20000
  G7:S('Excise Duty'),       H7:N(3000),   I7:N(3000),
  G8:S('Supervision Fees'),  H8:N(8000),   I8:N(0),               // waiver = 8000
  G9:S('Legal Fee'),         H9:N(12000),  I9:N(12000),
  // Payment schedule from row 10 (col C date, col D amount); settlement row at 14
  C10:D(45337), D10:N(30000),
  C11:D(45368), D11:N(30000),
  C12:D(45399), D12:N(30000),
  C14:F('=H14', 685000), E14:S('Negotiated Settlement'),         // settlement row: formula /H1[45]/ + label
});

// FIXTURE 2 — "no-settlement": payments only, no settlement row → settleDate must be empty.
writeFixture('no-settlement.xlsx', {
  D2:S('No Settle Co'), D3:S('0222222222'), D4:N(500000), C9:D(45306),
  G3:S('Principal Overdue'), H3:N(300000), I3:N(300000),
  C10:D(45337), D10:N(20000),
  C11:D(45368), D11:N(20000),
});

// FIXTURE 3 — "scattered-blanks": isolated blank rows (≤4) tolerated; a run of ≥5 stops the scan.
writeFixture('scattered-blanks.xlsx', {
  D2:S('Blanks Inc'), D3:S('0333333333'), D4:N(800000), C9:D(45306),
  G3:S('Principal Overdue'), H3:N(400000), I3:N(400000),
  C10:D(45337), D10:N(25000),
  // rows 11–13 blank (tolerated), payment resumes at 14
  C14:D(45430), D14:N(25000),
  // rows 15–19 blank ×5 → scan stops; row 25 below must be IGNORED
  C20:F('=H15', 600000), E20:S('Negotiation'),                   // this settlement row is BEYOND the 5-blank stop → not seen
});

// FIXTURE 4 — "comma-negative": amounts as comma-strings and accounting negatives, to exercise num().
writeFixture('comma-negative.xlsx', {
  D2:S('Comma Corp'), D3:S('0444444444'), D4:S('1,000,000'), C9:D(45306),
  G3:S('Principal Overdue'), H3:S('6,00,000'), I3:S('6,00,000'),
  G4:S('Reversal'),          H4:S('(1,234)'),  I4:N(0),         // accounting negative → -1234, waiver max(0,-1234-0)=0
  C10:D(45337), D10:S('30,000'),
  C11:D(45368), D11:S('(5,000)'),                               // negative payment kept signed
  C14:F('=H14', 600000), E14:S('Negotiated'),
});
```

- [ ] **Step 3: Run the real parser over each fixture; capture client/receivables/payments/dates**

```js
function runParse(file) {
  // reset the globals parseSettlementSheet mutates
  globalThis.settleRecv = []; globalThis.settlePay = [];
  for (const id of ['s-client','s-account','s-loan-amt','s-disb-date','s-settle-date']) el(id).value = '';
  const wb = XLSX.readFile(new URL(`./parse-fixtures/${file}`, import.meta.url).pathname, { cellStyles:true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  parseSettlementSheet(ws, file);
  return {
    client: el('s-client').value, account: el('s-account').value,
    loanAmt: el('s-loan-amt').value, disbDate: el('s-disb-date').value, settleDate: el('s-settle-date').value,
    receivables: globalThis.settleRecv.map(r => ({ name:r.name, receivable:r.receivable, waiver:r.waiver })),
    payments: globalThis.settlePay.map(p => ({ date:p.date, amount:p.amount })),
  };
}

// Value-parser golden cases (num + serial→ISO) so the Swift leaf utilities are vector-driven too.
const numCases = ['1,000,000','6,00,000','(1,234)','30,000','(5,000)','', 'abc', '1234.5', '-50'].map(s => ({ in:s, out:nnNum(num(s)) }));
function nnNum(x){ return (typeof x === 'number' && !Number.isFinite(x)) ? null : x; }  // NaN → null
const serialCases = [45306, 45337, 45368, 45399, 45430, 45473, 1, 60, 61].map(s => ({ serial:s, iso:cellDate({ ['Z1']:{ t:'n', v:s } }, 'Z1') }));

const vectors = {
  meta: { sourceCommit: execSync('git rev-parse HEAD', { cwd: new URL('..', import.meta.url).pathname }).toString().trim() },
  parseValues: { num: numCases, serial: serialCases },
  fixtures: {
    'clean.xlsx': runParse('clean.xlsx'),
    'no-settlement.xlsx': runParse('no-settlement.xlsx'),
    'scattered-blanks.xlsx': runParse('scattered-blanks.xlsx'),
    'comma-negative.xlsx': runParse('comma-negative.xlsx'),
  },
};
writeFileSync(new URL('./parse-vectors.json', import.meta.url), JSON.stringify(vectors, null, 1));
console.log('fixtures:', Object.keys(vectors.fixtures).map(k => `${k}:recv${vectors.fixtures[k].receivables.length}/pay${vectors.fixtures[k].payments.length}/settle"${vectors.fixtures[k].settleDate}"`).join('  '));
```

- [ ] **Step 4: Run and eyeball**

Run: `cd tools && npm i xlsx && node generate-parse-vectors.mjs`
Expected (HARD GATE):
- `clean.xlsx`: `client="Test Client Ltd"`, `loanAmt="1000000"`, `disbDate="2024-01-15"`, 7 receivables (LPI waiver `20000`), 3 payments, `settleDate="2024-04-09"` (serial 45390 ≈ the formula row's date C14=45390… use the serial you set; confirm the printed value).
- `no-settlement.xlsx`: `settleDate=""`, 2 payments, 1 receivable.
- `scattered-blanks.xlsx`: 2 payments (rows 10 + 14), the row-20 settlement row NOT seen → `settleDate=""`.
- `comma-negative.xlsx`: `loanAmt="1,000,000"` (string as-is — D4 is `cellVal`, not `num`), receivable[1] `receivable=-1234, waiver=0`, payment[1] `amount=-5000` (signed).
- `parseValues.num`: `"(1,234)"→-1234`, `"6,00,000"→600000`, `""→null`, `"abc"→null`.

If a printed value is wrong, the fixture cell layout doesn't match what `parseSettlementSheet` reads — fix the fixture (NOT the parser), regenerate.

- [ ] **Step 5: Commit + push (web repo)**

```bash
git add tools/generate-parse-vectors.mjs tools/parse-fixtures tools/parse-vectors.json tools/package.json tools/package-lock.json
git commit -m "feat: settlement parse-vector generator + synthetic fixtures for the iOS Excel import"
git push origin main
```

---

### Task 2: incalc-ios — vendor CoreXLSX 0.14.2 + SchemaType catch-all patch

**Files (in `~/Projects/incalc-ios`):**
- Create: `Vendor/CoreXLSX/` (vendored package), `Vendor/CoreXLSX/PATCH.md`
- Modify: `Package.swift`, `.gitignore`

- [ ] **Step 1: Vendor CoreXLSX at the proven version**

```bash
cd ~/Projects/incalc-ios
git clone --depth 1 --branch 0.14.2 https://github.com/CoreOffice/CoreXLSX Vendor/CoreXLSX
rm -rf Vendor/CoreXLSX/.git           # vendor the source, not a submodule
```

- [ ] **Step 2: Apply the `Relationship.SchemaType` catch-all patch**

CoreXLSX throws while decoding a workbook whose `.rels` contain a relationship `Type` it doesn't recognise (real third-party/bank files trigger this BEFORE any cell is readable — upstream issues/PRs #188/#193/#194). Make the schema type tolerate unknowns instead of throwing.

Find the `SchemaType` declaration (in `Vendor/CoreXLSX/Sources/CoreXLSX/Worksheet/Relationships.swift` — it is a `String`-backed enum used by `struct Relationship { let type: SchemaType }`). Convert it to a custom `RawRepresentable` that maps unknown raw values to an `.other(String)` case instead of failing:

```swift
// Relationships.swift — SchemaType: never throw on an unknown relationship Type.
public enum SchemaType: RawRepresentable, Codable, Equatable {
    case officeDocument, worksheet, sharedStrings, styles, theme /* …keep the existing known cases… */
    case other(String)

    public init(rawValue: String) {
        switch rawValue {
        case Self.officeDocument.rawValue: self = .officeDocument
        case Self.worksheet.rawValue:      self = .worksheet
        case Self.sharedStrings.rawValue:  self = .sharedStrings
        case Self.styles.rawValue:         self = .styles
        case Self.theme.rawValue:          self = .theme
        /* …one line per existing known case… */
        default: self = .other(rawValue)            // <- the catch-all that prevents the throw
        }
    }
    public var rawValue: String {
        switch self {
        case .officeDocument: return "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
        /* …existing raw strings… */
        case .other(let s):   return s
        }
    }
    public init(from decoder: Decoder) throws { self = SchemaType(rawValue: try decoder.singleValueContainer().decode(String.self)) }
    public func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(rawValue) }
}
```

Record the exact before/after in `Vendor/CoreXLSX/PATCH.md` (so a future CoreXLSX bump can re-apply it). **Verify against the actual vendored file**: keep every existing case and its raw string; only ADD `case other(String)`, the `default:` arm, and the `init(from:)`/`encode(to:)` if the original relied on synthesized `Codable`.

- [ ] **Step 3: Add CoreXLSX as a local SwiftPM package dependency**

In `Package.swift`, add the local package and a new `InCalcExcelImport` library target that depends on `InCalcEngine` (Plan 1) + `CoreXLSX`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InCalcEngine",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "InCalcEngine", targets: ["InCalcEngine"]),
        .library(name: "InCalcExcelImport", targets: ["InCalcExcelImport"]),
    ],
    dependencies: [
        .package(path: "Vendor/CoreXLSX"),
    ],
    targets: [
        .target(name: "InCalcEngine"),
        .testTarget(name: "InCalcEngineTests", dependencies: ["InCalcEngine"],
                    resources: [.copy("Fixtures")]),
        .target(name: "InCalcExcelImport",
                dependencies: ["InCalcEngine", .product(name: "CoreXLSX", package: "CoreXLSX")]),
        .testTarget(name: "InCalcExcelImportTests",
                    dependencies: ["InCalcExcelImport"],
                    resources: [.copy("Fixtures")]),
    ]
)
```

`.gitignore`: add `Vendor/CoreXLSX/.build/`.

- [ ] **Step 4: Build to confirm the vendored package compiles**

Run: `swift build 2>&1 | tail -3`
Expected: `Build complete!` (InCalcEngine + CoreXLSX + empty InCalcExcelImport target). If CoreXLSX fails to compile under Swift 5.9, note the error; the patch must keep CoreXLSX's existing API intact.

- [ ] **Step 5: Commit**

```bash
git add Vendor/CoreXLSX Package.swift .gitignore
git commit -m "chore: vendor CoreXLSX 0.14.2 with SchemaType catch-all patch; add InCalcExcelImport target"
```

---

### Task 3: incalc-ios — scaffold import sources + copy fixtures + ParseVectors helper

**Files:**
- Create: `Sources/InCalcExcelImport/InCalcExcelImport.swift` (placeholder namespace), `Tests/InCalcExcelImportTests/Fixtures/parse-vectors.json` (+ the 4 `.xlsx`), `Tests/InCalcExcelImportTests/ParseVectors.swift`

- [ ] **Step 1: Copy the fixtures from the web repo**

```bash
cd ~/Projects/incalc-ios
mkdir -p Sources/InCalcExcelImport Tests/InCalcExcelImportTests/Fixtures
cp ~/Projects/InCalc/tools/parse-vectors.json Tests/InCalcExcelImportTests/Fixtures/
cp ~/Projects/InCalc/tools/parse-fixtures/*.xlsx Tests/InCalcExcelImportTests/Fixtures/
```

- [ ] **Step 2: Placeholder namespace so the target builds**

```swift
// Sources/InCalcExcelImport/InCalcExcelImport.swift
// Excel-import layer for the Settlement tab — CoreXLSX-backed parser + engine bridge.
// Real types (CellParse, XLSXSheet, SettlementSheetParser, SettlementCalculator) land in Tasks 4–7.
public enum InCalcExcelImport {}
```

- [ ] **Step 3: Test helper — load parse-vectors.json and resolve fixture URLs**

```swift
// Tests/InCalcExcelImportTests/ParseVectors.swift
import Foundation
import XCTest

enum ParseVectors {
    static let root: [String: Any] = {
        let url = Bundle.module.url(forResource: "Fixtures/parse-vectors", withExtension: "json")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }()
    static var fixturesNode: [String: Any] { root["fixtures"] as! [String: Any] }
    static func expected(_ file: String) -> [String: Any] { fixturesNode[file] as! [String: Any] }
    /// Absolute path to a bundled fixture .xlsx (CoreXLSX needs a filesystem path).
    static func xlsxPath(_ file: String) -> String {
        let base = (file as NSString).deletingPathExtension
        return Bundle.module.url(forResource: "Fixtures/\(base)", withExtension: "xlsx")!.path
    }
}
func dblOrNil(_ v: Any?) -> Double? { (v is NSNull || v == nil) ? nil : (v as! NSNumber).doubleValue }
```

- [ ] **Step 4: Build, then commit**

Run: `swift build 2>&1 | tail -2` → Build complete.
```bash
git add Sources/InCalcExcelImport Tests/InCalcExcelImportTests
git commit -m "chore: scaffold InCalcExcelImport sources + parse-vector fixtures and helper"
```

---

### Task 4: incalc-ios — value parsers (`CellParse.number`, `CellParse.excelSerialToISO`)

**Files:**
- Create: `Sources/InCalcExcelImport/CellParse.swift`, `Tests/InCalcExcelImportTests/CellParseTests.swift`

- [ ] **Step 1: Failing test (against `parseValues` vectors)**

```swift
import XCTest
@testable import InCalcExcelImport

final class CellParseTests: XCTestCase {
    private var pv: [String: Any] { ParseVectors.root["parseValues"] as! [String: Any] }
    func testNumber() {
        for c in pv["num"] as! [[String: Any]] {
            let got = CellParse.number(c["in"] as? String ?? "")
            if let want = dblOrNil(c["out"]) { XCTAssertEqual(got, want, "num(\(c["in"]!))") }
            else { XCTAssertNil(got, "num(\(c["in"]!)) should be nil") }
        }
    }
    func testExcelSerialToISO() {
        for c in pv["serial"] as! [[String: Any]] {
            XCTAssertEqual(CellParse.excelSerialToISO(dblOrNil(c["serial"])!), c["iso"] as! String, "serial \(c["serial"]!)")
        }
    }
}
```

- [ ] **Step 2: Run — FAIL** (`cannot find 'CellParse'`).

- [ ] **Step 3: Implement (faithful port of web `num` + the `cellDate` serial branch)**

```swift
// CellParse.swift
import Foundation

public enum CellParse {
    /// Mirror of web num(v): null/empty → nil; accounting parens → negative; strip (),\s and any
    /// non [0-9.\-]; parseFloat; non-numeric → nil. Returns nil where the web returned NaN.
    public static func number(_ raw: String) -> Double? {
        let s0 = raw.trimmingCharacters(in: .whitespaces)
        if s0.isEmpty { return nil }
        let isAccountingNegative = s0.hasPrefix("(") && s0.hasSuffix(")")     // web: /^\(.*\)$/
        let stripped = s0.unicodeScalars.filter { "0123456789.-".unicodeScalars.contains($0) }
        let cleaned = String(String.UnicodeScalarView(stripped))
        guard let x = Double(cleaned), x.isFinite else { return nil }          // web parseFloat → NaN guard
        return isAccountingNegative ? -abs(x) : x
    }

    /// Mirror of web cellDate's numeric branch: Excel serial → "yyyy-MM-dd" via epoch 1899-12-30,
    /// formatted in LOCAL time. (UTC round-trips shift BD dates by a day — see spec §5 date gotcha.)
    public static func excelSerialToISO(_ serial: Double) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let base = cal.date(from: DateComponents(year: 1899, month: 12, day: 30, hour: 12))!  // noon anchor avoids DST edge
        let date = cal.date(byAdding: .day, value: Int(serial.rounded()), to: base)!
        let f = DateFormatter(); f.calendar = cal; f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
```

- [ ] **Step 4: Run — PASS** (`swift test --filter CellParseTests`). If `excelSerialToISO` disagrees with a `serial` vector, the day arithmetic differs from `XLSX.SSF.parse_date_code` (the web's converter) — the vectors hold the truth; reconcile the anchor/leap handling against them (Excel's 1900-leap bug is already absorbed by the 1899-12-30 epoch). Do NOT change the vectors.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Excel cell value parsers (num, serial→ISO) matching web parse vectors"`

---

### Task 5: incalc-ios — `XLSXSheet` A1-reference adapter over CoreXLSX

**Files:**
- Create: `Sources/InCalcExcelImport/XLSXSheet.swift`, `Tests/InCalcExcelImportTests/XLSXSheetTests.swift`

CoreXLSX has no built-in A1 lookup (README: "you will have to implement your own mapping"). This adapter is the ONLY file that touches CoreXLSX types — the parser (Task 6) works purely against this interface.

- [ ] **Step 1: Failing test (open the clean fixture, read landmark cells)**

```swift
import XCTest
@testable import InCalcExcelImport

final class XLSXSheetTests: XCTestCase {
    func testReadsLandmarkCells() throws {
        let sheet = try XLSXSheet(path: ParseVectors.xlsxPath("clean.xlsx"))
        XCTAssertEqual(sheet.string("D2"), "Test Client Ltd")
        XCTAssertEqual(sheet.string("D3"), "0123456789")
        XCTAssertEqual(sheet.number("D4"), 1000000)
        XCTAssertEqual(sheet.serialDate("C9"), "2024-01-15")
        XCTAssertEqual(sheet.string("G3"), "URPA")
        // Settlement-row signals on row 14:
        XCTAssertTrue(sheet.formula("D14")?.contains("H14") ?? false)
        XCTAssertEqual(sheet.string("E14"), "Negotiated Settlement")
        // Absent cell:
        XCTAssertNil(sheet.string("Z99"))
    }
}
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement (the CoreXLSX integration; verify property names against the vendored 0.14.2 source)**

```swift
// XLSXSheet.swift
import Foundation
import CoreXLSX

/// A1-addressable view over the first worksheet of an .xlsx. Resolves shared strings up front and
/// indexes every cell by its A1 reference (e.g. "D2"), since CoreXLSX offers no A1 lookup.
public struct XLSXSheet {
    public enum ParseError: Error { case unreadable(String), noWorksheet }
    private let cells: [String: Cell]
    private let shared: SharedStrings?

    public init(path: String) throws {
        guard let file = XLSXFile(filepath: path) else { throw ParseError.unreadable(path) }
        self.shared = try? file.parseSharedStrings()
        // First worksheet (the web uses wb.SheetNames[0]).
        guard let firstPath = try file.parseWorksheetPaths().first else { throw ParseError.noWorksheet }
        let ws = try file.parseWorksheet(at: firstPath)
        var map: [String: Cell] = [:]
        for row in ws.data?.rows ?? [] {
            for cell in row.cells { map[cell.reference.description] = cell }   // reference.description == "D2"
        }
        self.cells = map
    }

    /// Resolved string value (shared-string aware), trimmed; nil if the cell is absent/empty.
    public func string(_ ref: String) -> String? {
        guard let c = cells[ref] else { return nil }
        let s = (shared.flatMap { c.stringValue($0) }) ?? c.value
        let t = s?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (t?.isEmpty ?? true) ? nil : t
    }
    /// Raw numeric value of a cell (the underlying stored number), or nil.
    public func number(_ ref: String) -> Double? {
        guard let v = cells[ref]?.value else { return nil }
        return Double(v)
    }
    /// The cell's formula source string (e.g. "H14"), or nil if the cell has no formula.
    public func formula(_ ref: String) -> String? { cells[ref]?.formula?.value }
    /// A date cell rendered "yyyy-MM-dd" mirroring web cellDate: numeric serial → CellParse;
    /// ISO-string cell (t="d" / a yyyy-MM-dd value) → first 10 chars; else "".
    public func serialDate(_ ref: String) -> String {
        guard let c = cells[ref], let v = c.value else { return "" }
        if let serial = Double(v) { return CellParse.excelSerialToISO(serial) }       // numeric branch
        let s = (shared.flatMap { c.stringValue($0) }) ?? v
        if let r = s.range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression) { return String(s[r]) }
        return ""
    }
}
```

- [ ] **Step 4: Run — PASS** (`swift test --filter XLSXSheetTests`). If `formula("D14")` is nil, CoreXLSX did not surface this formula (its shared-formula gap) — that is EXPECTED and is exactly why the parser also uses the column-E label; note it and proceed (the parser test in Task 6 is the real gate). If `number`/`string`/`serialDate` mismatch, reconcile the CoreXLSX property names (`cell.value`, `cell.formula?.value`, `cell.reference.description`, `cell.stringValue(_:)`) against the vendored 0.14.2 headers.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: XLSXSheet A1-reference adapter over CoreXLSX"`

---

### Task 6: incalc-ios — `SettlementSheetParser` (the faithful `parseSettlementSheet` port)

**Files:**
- Create: `Sources/InCalcExcelImport/SettlementSheetParser.swift`, `Tests/InCalcExcelImportTests/SettlementSheetParserTests.swift`

- [ ] **Step 1: Failing test (all 4 fixtures vs parse-vectors.json)**

```swift
import XCTest
@testable import InCalcExcelImport

final class SettlementSheetParserTests: XCTestCase {
    private func check(_ file: String) throws {
        let want = ParseVectors.expected(file)
        let got = try SettlementSheetParser.parse(XLSXSheet(path: ParseVectors.xlsxPath(file)))
        XCTAssertEqual(got.client, want["client"] as? String ?? "", "client \(file)")
        XCTAssertEqual(got.account, want["account"] as? String ?? "", "account \(file)")
        XCTAssertEqual(got.loanAmountRaw, want["loanAmt"] as? String ?? "", "loanAmt \(file)")
        XCTAssertEqual(got.disbursementDate, want["disbDate"] as? String ?? "", "disbDate \(file)")
        XCTAssertEqual(got.settlementDate, want["settleDate"] as? String ?? "", "settleDate \(file)")
        let wantRecv = want["receivables"] as! [[String: Any]]
        XCTAssertEqual(got.receivables.count, wantRecv.count, "recv count \(file)")
        for (g, w) in zip(got.receivables, wantRecv) {
            XCTAssertEqual(g.name, w["name"] as! String, "recv name \(file)")
            XCTAssertEqual(g.receivable, dblOrNil(w["receivable"])!, "recv amt \(file)")
            XCTAssertEqual(g.waiver, dblOrNil(w["waiver"])!, "recv waiver \(file)")
        }
        let wantPay = want["payments"] as! [[String: Any]]
        XCTAssertEqual(got.payments.count, wantPay.count, "pay count \(file)")
        for (g, w) in zip(got.payments, wantPay) {
            XCTAssertEqual(g.date, w["date"] as! String, "pay date \(file)")
            XCTAssertEqual(g.amount, dblOrNil(w["amount"])!, "pay amt \(file)")
        }
    }
    func testClean()            throws { try check("clean.xlsx") }
    func testNoSettlement()     throws { try check("no-settlement.xlsx") }
    func testScatteredBlanks()  throws { try check("scattered-blanks.xlsx") }
    func testCommaNegative()    throws { try check("comma-negative.xlsx") }
}
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement (line-faithful port of `parseSettlementSheet`)**

```swift
// SettlementSheetParser.swift
import Foundation

public enum SettlementSheetParser {
    public struct Receivable: Equatable { public let name: String, receivable: Double, waiver: Double }
    public struct Payment: Equatable { public let date: String, amount: Double }
    public struct Import: Equatable {
        public let client: String, account: String
        public let loanAmountRaw: String          // web stores D4 verbatim (cellVal, not num)
        public let disbursementDate: String, settlementDate: String
        public let receivables: [Receivable], payments: [Payment]
    }

    /// Mirror of web parseSettlementSheet — same cell map, blank tolerance, and settlement-row detection.
    public static func parse(_ s: XLSXSheet) -> Import {
        let client  = s.string("D2") ?? ""
        let account = s.string("D3") ?? ""
        // D4 is read with cellVal (raw) in the web, so keep the verbatim cell text; numbers render as their string.
        let loanAmt = s.string("D4") ?? (s.number("D4").map { Self.plain($0) } ?? "")
        let disb    = s.serialDate("C9")

        // Receivables G3:I11
        var recv: [Receivable] = []
        for r in 3...11 {
            guard let name = s.string("G\(r)") else { continue }
            let rec = CellParse.number(s.cellText("H\(r)")) ?? 0
            let adj = CellParse.number(s.cellText("I\(r)")) ?? 0
            recv.append(Receivable(name: name, receivable: rec, waiver: max(0, rec - adj)))
        }
        if recv.isEmpty {
            recv = Self.defaultReceivables.map { Receivable(name: $0, receivable: 0, waiver: 0) }
        }

        // Payment schedule rows 10…300, tolerate <5 consecutive blanks, detect the settlement row.
        struct PayRow { let date: String; let amount: Double; let isSettlement: Bool }
        var all: [PayRow] = []
        var row = 10, blanks = 0
        while row <= 300 {
            let dateVal = s.serialDate("C\(row)")
            let amtVal  = CellParse.number(s.cellText("D\(row)"))
            if dateVal.isEmpty && amtVal == nil { blanks += 1; if blanks >= 5 { break }; row += 1; continue }
            blanks = 0
            let hasFormula = (s.formula("D\(row)")?.range(of: #"H1[45]"#, options: .regularExpression)) != nil
            let label = s.string("E\(row)") ?? ""
            let hasLabel = label.range(of: "negotiat", options: .caseInsensitive) != nil
            all.append(PayRow(date: dateVal, amount: amtVal ?? 0, isSettlement: hasFormula || hasLabel))
            row += 1
        }

        var payments: [Payment] = []
        var settleDate = ""
        if let idx = all.firstIndex(where: { $0.isSettlement }) {
            for i in 0..<idx { payments.append(Payment(date: all[i].date, amount: all[i].amount)) }
            settleDate = all[idx].date
        } else {
            for p in all { payments.append(Payment(date: p.date, amount: p.amount)) }
            settleDate = ""    // clear any stale settlement date — matches the web
        }
        return Import(client: client, account: account, loanAmountRaw: loanAmt,
                      disbursementDate: disb, settlementDate: settleDate, receivables: recv, payments: payments)
    }

    static let defaultReceivables = ["URPA","Principal Overdue","Interest Overdue","Deferment Interest",
        "Late Payment Interest (LPI)","Excise Duty","Others Receivable","Supervision Fees","Legal Fee"]
    /// Web renders a numeric cell value through String(): integers print without a decimal.
    static func plain(_ n: Double) -> String { n == n.rounded() ? String(Int(n)) : String(n) }
}
```

Add to `XLSXSheet` (Task 5 file) the raw-text accessor the parser uses for `num()` inputs (mirrors web `cellVal` passed to `num`):

```swift
/// Raw cell text exactly as cellVal returns it (number → its string form, string → itself); "" if absent.
public func cellText(_ ref: String) -> String {
    if let s = string(ref) { return s }
    if let n = number(ref) { return n == n.rounded() ? String(Int(n)) : String(n) }
    return ""
}
```

- [ ] **Step 4: Run — PASS** (`swift test --filter SettlementSheetParserTests`). Debug protocol per failing fixture: print `got` vs the vector, and diff field-by-field. Likely culprits: (a) `loanAmountRaw` formatting for the numeric-D4 clean fixture (web `cellVal` returns the number, then `.value=` stringifies it — confirm "1000000" not "1000000.0"); (b) the scattered-blanks fixture's row-20 settlement row must NOT be detected (the 5-blank break fires first → `settleDate=""`); (c) the comma-negative receivable `(1,234)` → `-1234`, `waiver=max(0,-1234-0)=0`. The vectors are truth — fix the Swift, never the vectors.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: SettlementSheetParser matching web parseSettlementSheet over golden fixtures"`

---

### Task 7: incalc-ios — `SettlementCalculator` bridge (parser → Plan-1 engine) + full gate + push

**Files:**
- Create: `Sources/InCalcExcelImport/SettlementCalculator.swift`, `Tests/InCalcExcelImportTests/SettlementCalculatorTests.swift`

This wires the parsed `Import` to the Plan-1 `Settlement` engine exactly as the web `calcSettlement` builds its XIRR cashflows.

- [ ] **Step 1: Failing test (end-to-end XIRR on the clean fixture)**

```swift
import XCTest
@testable import InCalcExcelImport
import InCalcEngine

final class SettlementCalculatorTests: XCTestCase {
    func testCleanFixtureIRR() throws {
        let imp = try SettlementSheetParser.parse(XLSXSheet(path: ParseVectors.xlsxPath("clean.xlsx")))
        // Web calcSettlement needs loanAmt + disbDate + settleDate; the clean fixture supplies all three.
        let r = SettlementCalculator.compute(
            loanAmount: CellParse.number(imp.loanAmountRaw) ?? 0,
            disbursementDate: imp.disbursementDate,
            settlementDate: imp.settlementDate,
            receivables: imp.receivables, payments: imp.payments)
        XCTAssertNotNil(r.irr)
        // Collection-for-IRR reuses the Plan-1 rule: non-excise/legal adjustments − excise/legal waivers.
        // clean.xlsx: adjustments(URPA 0 + PrincOD 0 + IntOD 0 + LPI 20000 + Superv 0) − (excise waiver 0 + legal waiver 0)…
        // assert the exact collIRR the web produced for this fixture (read it from parse-vectors or compute once and pin):
        XCTAssertEqual(r.collectionForIRR, Settlement.collectionForIRR(imp.receivables.map {
            Settlement.Receivable(name: $0.name, receivable: $0.receivable, waiver: $0.waiver) }), accuracy: 1e-6)
        // 3 dated positive payments + the collection all entered the cashflow:
        XCTAssertEqual(r.cashflowCount, 1 /*disb*/ + 3 /*payments*/ + (r.collectionForIRR > 0 ? 1 : 0))
    }
}
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement (faithful port of the `calcSettlement` cashflow build; reuse Plan-1 engine)**

```swift
// SettlementCalculator.swift
import Foundation
import InCalcEngine

public enum SettlementCalculator {
    public struct Result { public let irr: Double?, collectionForIRR: Double, cashflowCount: Int, excludedPayments: Int }

    private static let iso: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current; f.calendar = Calendar(identifier: .gregorian); return f
    }()

    /// Mirror of web calcSettlement's cashflow construction → Plan-1 Settlement.xirr.
    /// Requires loanAmount>0, disbursementDate and settlementDate non-empty (the web gates these);
    /// returns irr=nil if those preconditions fail or <2 flows.
    public static func compute(loanAmount: Double, disbursementDate: String, settlementDate: String,
                               receivables: [SettlementSheetParser.Receivable],
                               payments: [SettlementSheetParser.Payment]) -> Result {
        let engineRecv = receivables.map { Settlement.Receivable(name: $0.name, receivable: $0.receivable, waiver: $0.waiver) }
        let collIRR = Settlement.collectionForIRR(engineRecv)

        guard loanAmount > 0, let disb = iso.date(from: disbursementDate) else {
            return Result(irr: nil, collectionForIRR: collIRR, cashflowCount: 0, excludedPayments: 0)
        }
        var cf: [Double] = [-loanAmount], dates: [Date] = [disb]
        var excluded = 0
        for p in payments {
            if !p.date.isEmpty, p.amount > 0, let d = iso.date(from: p.date) { cf.append(p.amount); dates.append(d) }
            else if p.amount != 0 { excluded += 1 }     // has an amount but no usable date / non-positive → excluded (web warns)
        }
        if collIRR > 0, !settlementDate.isEmpty, let sd = iso.date(from: settlementDate) {
            cf.append(collIRR); dates.append(sd)
        }
        let irr = cf.count >= 2 ? Settlement.xirr(cashflows: cf, dates: dates) : nil
        return Result(irr: irr, collectionForIRR: collIRR, cashflowCount: cf.count, excludedPayments: excluded)
    }
}
```

- [ ] **Step 4: Run the FULL suite** — `swift test 2>&1 | tail -3` → ALL green (InCalcEngine 15 + the new InCalcExcelImport tests: CellParse, XLSXSheet, SettlementSheetParser ×4, SettlementCalculator).

- [ ] **Step 5: Cross-repo governance** — append to BOTH `AGENTS.md` files a landmine: *"Settlement Excel parsing is golden-tested too: change web `parseSettlementSheet` → regenerate `tools/parse-vectors.json` + fixtures → copy into `incalc-ios` `InCalcExcelImportTests/Fixtures/` → mirror in `SettlementSheetParser` → `swift test` green. Fixtures are synthetic-only (landmine #1)."* Commit in each.

- [ ] **Step 6: Commit + push (incalc-ios)**

```bash
git add -A && git commit -m "feat: SettlementCalculator bridge (parser → Settlement engine); Excel-import suite green"
git push origin main
```

---

## Self-review (done at write time)

- **Spec coverage (§5):** library/vendoring + SchemaType patch → Task 2; parser parity rules (D2/D3/D4/C9, G3:I11, rows 10–300, settlement-row /H1[45]/ + "negotiat" label, ≤5 blank tolerance, signed amounts, comma/accounting num, clear stale settle date) → Tasks 4–6 with each rule exercised by a named fixture; date gotcha (epoch 1899-12-30, local tz, ISO-string fallback) → Task 4 `excelSerialToISO` + Task 5 `serialDate`; `.fileImporter` intake + UTType + security-scoped resource → **deferred to Plan 3 (UI)** by design; Plan B hand-rolled parser → noted as the trigger-based fallback, not built unless a real file fails (kept out of scope per spec). §6.3 fixtures (clean + no-settlement + scattered-blanks + comma/negative) → Task 1.
- **Reuse, not re-port:** `Settlement.xirr` and `Settlement.collectionForIRR` are Plan-1 deliverables; Task 7 calls them. Only `num`, the serial→date conversion, `parseSettlementSheet`, and the `calcSettlement` cashflow build are newly ported (they have no Plan-1 equivalent).
- **Type consistency:** `XLSXSheet` exposes `string/number/formula/serialDate/cellText`; the parser uses exactly those. `SettlementSheetParser.Receivable/Payment/Import` are consumed unchanged by `SettlementCalculator`, which maps `Receivable` → the Plan-1 `Settlement.Receivable`. `CellParse.number` returns `Double?` (nil == web NaN) and is used consistently in the parser and the calculator.
- **Known judgment calls encoded:** CoreXLSX shared-formula gap → the parser relies on the column-E label as the reliable settlement-row signal, with the formula as a bonus (Task 5 Step 4 + Task 6 fixtures carry both); D4 kept as raw text (web `cellVal`, not `num`) so the calculator re-parses it with `CellParse.number`; date conversion done manually (not via `cell.dateValue`) to control the timezone for BD parity; the SchemaType patch is the one place the plan cannot give final line-exact code (it must be applied against the vendored source) — Task 2 gives the exact target file, the catch-all shape, and a build-green verification.

## Open items to confirm before/while executing

- **CoreXLSX property names** (`cell.value`, `cell.formula?.value`, `cell.reference.description`, `cell.stringValue(_:)`, `ws.data?.rows`) are from the 0.14.2 README/API; verify against the vendored headers in Task 5 Step 4 and adjust the adapter if a name differs (the adapter is the only file that needs touching — the parser is insulated).
- **Settlement-row serial in the clean fixture:** set C14 to a serial whose ISO you assert in Task 1 Step 4 (pick one, e.g. 45390 → 2024-04-09, and make the expected `settleDate` match what the generator prints).
