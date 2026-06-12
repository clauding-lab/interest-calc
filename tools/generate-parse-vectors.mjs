// tools/generate-parse-vectors.mjs
// Builds synthetic settlement fixture .xlsx files (fake data only — no PII) and
// runs the REAL parseSettlementSheet() (extracted from index.html) over them to
// emit tools/parse-vectors.json — the golden expected parse output for the iOS port.
// Node 20+. Requires: cd tools && npm i xlsx
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

// xlsx must be required (not ESM-imported) so that XLSX.SSF is available.
// `import * as XLSX from 'xlsx'` gives only the re-exported subset; the CJS
// default export carries SSF, readFile, writeFile, utils, etc.
const XLSX = createRequire(import.meta.url)('xlsx');

// ── Step 1: Extract the real parser from index.html under a DOM stub ──────────

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];

function extract(name) {
  const i = main.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`function ${name} not found`);
  let depth = 0, j = main.indexOf('{', i);
  for (let k = j; k < main.length; k++) { if (main[k] === '{') depth++; if (main[k] === '}') { depth--; if (depth === 0) return main.slice(i, k + 1); } }
  throw new Error(`unbalanced braces in ${name}`);
}

const els = new Map();
function el(id) {
  if (!els.has(id)) els.set(id, { value:'', textContent:'', innerHTML:'', checked:false,
    style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false} }, dataset:{} });
  return els.get(id);
}

globalThis.document = {
  getElementById: el,
  querySelectorAll: () => [],
};
globalThis.XLSX = XLSX;
globalThis.escH = s => String(s);
globalThis.currency = 'BDT';
globalThis.settleRecv = [];
globalThis.settlePay = [];
globalThis.defaultReceivables = [
  'URPA','Principal Overdue','Interest Overdue','Deferment Interest',
  'Late Payment Interest (LPI)','Excise Duty','Others Receivable','Supervision Fees','Legal Fee',
];

// Stubs for helpers that settleUpdateTotals needs but that depend on heavy display machinery.
// These are no-ops or identity functions — they do NOT replace any calculation logic.
globalThis.fmt   = n => String(n);   // stub: settleUpdateTotals uses this only for textContent display
globalThis.fmtS  = n => String(n);
globalThis.fmtBDT  = n => String(n);  // stub
globalThis.fmtSBDT = n => String(n);  // stub
globalThis.grp   = n => String(isFinite(n) ? n : 0);  // stub

for (const fn of ['num','formatDateInput','cellVal','cellDate','renderSettleRecv','renderSettlePay','settleUpdateTotals'])
  try { (0, eval)(extract(fn)); } catch (e) { console.warn(`[stub-warn] ${fn}: ${e.message}`); }

globalThis.renderSettleRecv = globalThis.renderSettleRecv || (() => {});
globalThis.renderSettlePay  = globalThis.renderSettlePay  || (() => {});
globalThis.settleShowScreen = () => {};

(0, eval)(extract('parseSettlementSheet'));

// ── Step 2: Build synthetic fixtures (fake data only — LANDMINE: no real files) ──

const dir = new URL('./parse-fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

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

const S = v => ({ t:'s', v:String(v) });
const N = v => ({ t:'n', v });
const D = serial => ({ t:'n', v:serial });
const F = (formula, v) => ({ t:'n', f:formula, v });

// FIXTURE 1 — clean (full receivables, dated payments, settlement row w/ formula /H1[45]/ + "negotiat" label)
// Parser reads: date from col C, amount from col D (dCell=ws['D'+row]), label from col E.
// Formula goes in D14 so hasFormula fires; C14 carries a date serial for settleDate.
// 45430 = 2024-05-15 (fake settlement date)
writeFixture('clean.xlsx', {
  D2:S('Test Client Ltd'), D3:S('0123456789'), D4:N(1000000), C9:D(45306),
  G3:S('URPA'),              H3:N(50000),  I3:N(50000),
  G4:S('Principal Overdue'), H4:N(600000), I4:N(600000),
  G5:S('Interest Overdue'),  H5:N(60000),  I5:N(60000),
  G6:S('Late Payment Interest (LPI)'), H6:N(25000), I6:N(5000),
  G7:S('Excise Duty'),       H7:N(3000),   I7:N(3000),
  G8:S('Supervision Fees'),  H8:N(8000),   I8:N(0),
  G9:S('Legal Fee'),         H9:N(12000),  I9:N(12000),
  C10:D(45337), D10:N(30000),
  C11:D(45368), D11:N(30000),
  C12:D(45399), D12:N(30000),
  C14:D(45430), D14:F('=H14', 685000), E14:S('Negotiated Settlement'),
});

// FIXTURE 2 — no-settlement (payments only → settleDate empty)
writeFixture('no-settlement.xlsx', {
  D2:S('No Settle Co'), D3:S('0222222222'), D4:N(500000), C9:D(45306),
  G3:S('Principal Overdue'), H3:N(300000), I3:N(300000),
  C10:D(45337), D10:N(20000),
  C11:D(45368), D11:N(20000),
});

// FIXTURE 3 — scattered-blanks (≤4 blanks tolerated; ≥5 stops; the settlement row at row 20 is BEYOND the stop)
// Rows 15–19 are blank (5 consecutive blanks) → parser stops at row 15; row 20 is never seen.
// Formula goes in D20 (amount col) as it would in a real file; it's unreachable so only structural correctness matters.
writeFixture('scattered-blanks.xlsx', {
  D2:S('Blanks Inc'), D3:S('0333333333'), D4:N(800000), C9:D(45306),
  G3:S('Principal Overdue'), H3:N(400000), I3:N(400000),
  C10:D(45337), D10:N(25000),
  C14:D(45430), D14:N(25000),
  C20:D(45500), D20:F('=H15', 600000), E20:S('Negotiation'),
});

// FIXTURE 4 — comma-negative (comma strings + accounting negatives exercise num())
// Formula in D14 (amount col), date serial in C14 for settleDate. 45473 = 2024-06-27.
writeFixture('comma-negative.xlsx', {
  D2:S('Comma Corp'), D3:S('0444444444'), D4:S('1,000,000'), C9:D(45306),
  G3:S('Principal Overdue'), H3:S('6,00,000'), I3:S('6,00,000'),
  G4:S('Reversal'),          H4:S('(1,234)'),  I4:N(0),
  C10:D(45337), D10:S('30,000'),
  C11:D(45368), D11:S('(5,000)'),
  C14:D(45473), D14:F('=H14', 600000), E14:S('Negotiated'),
});

console.log('Wrote 4 fixtures to parse-fixtures/');

// ── Step 3: Run the real parser over each fixture; capture output ─────────────

function runParse(file) {
  globalThis.settleRecv = [];
  globalThis.settlePay = [];
  for (const id of ['s-client','s-account','s-loan-amt','s-disb-date','s-settle-date']) el(id).value = '';
  const wb = XLSX.readFile(new URL(`./parse-fixtures/${file}`, import.meta.url).pathname, { cellStyles:true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  parseSettlementSheet(ws, file);
  return {
    client: el('s-client').value,
    account: el('s-account').value,
    loanAmt: el('s-loan-amt').value,
    disbDate: el('s-disb-date').value,
    settleDate: el('s-settle-date').value,
    receivables: globalThis.settleRecv.map(r => ({ name:r.name, receivable:r.receivable, waiver:r.waiver })),
    payments: globalThis.settlePay.map(p => ({ date:p.date, amount:p.amount })),
  };
}

function nnNum(x){ return (typeof x === 'number' && !Number.isFinite(x)) ? null : x; }

const numCases = ['1,000,000','6,00,000','(1,234)','30,000','(5,000)','', 'abc', '1234.5', '-50']
  .map(s => ({ in:s, out:nnNum(num(s)) }));

const serialCases = [45306, 45337, 45368, 45399, 45430, 45473, 1, 60, 61]
  .map(s => ({ serial:s, iso:cellDate({ ['Z1']:{ t:'n', v:s } }, 'Z1') }));

const vectors = {
  meta: {
    sourceCommit: execSync('git rev-parse HEAD', { cwd: new URL('..', import.meta.url).pathname }).toString().trim(),
  },
  parseValues: { num: numCases, serial: serialCases },
  fixtures: {
    'clean.xlsx': runParse('clean.xlsx'),
    'no-settlement.xlsx': runParse('no-settlement.xlsx'),
    'scattered-blanks.xlsx': runParse('scattered-blanks.xlsx'),
    'comma-negative.xlsx': runParse('comma-negative.xlsx'),
  },
};

writeFileSync(new URL('./parse-vectors.json', import.meta.url), JSON.stringify(vectors, null, 1));

// ── Step 4: Print structural invariant check ──────────────────────────────────

console.log('fixtures:',
  Object.keys(vectors.fixtures)
    .map(k => `${k}:recv${vectors.fixtures[k].receivables.length}/pay${vectors.fixtures[k].payments.length}/settle"${vectors.fixtures[k].settleDate}"`)
    .join('  ')
);
console.log(
  'num (1,234)=', num('(1,234)'),
  ' serial45306=', vectors.parseValues.serial[0].iso,
  ' clean.disb=', vectors.fixtures['clean.xlsx'].disbDate,
);

// Explicit invariant assertions (fail loud rather than silently emit bad vectors)
const c = vectors.fixtures;
const assert = (cond, msg) => { if (!cond) { console.error('INVARIANT FAIL:', msg); process.exit(1); } };

assert(c['clean.xlsx'].client === 'Test Client Ltd', `clean.client=${c['clean.xlsx'].client}`);
assert(c['clean.xlsx'].receivables.length === 7, `clean.recv=${c['clean.xlsx'].receivables.length} (want 7)`);
const lpi = c['clean.xlsx'].receivables.find(r => r.name === 'Late Payment Interest (LPI)');
assert(lpi && lpi.waiver === 20000, `clean.LPI.waiver=${lpi?.waiver} (want 20000)`);
assert(c['clean.xlsx'].payments.length === 3, `clean.pay=${c['clean.xlsx'].payments.length} (want 3)`);
assert(c['clean.xlsx'].settleDate !== '', `clean.settleDate is empty — settlement row not detected`);

assert(c['no-settlement.xlsx'].settleDate === '', `no-settle.settleDate="${c['no-settlement.xlsx'].settleDate}" (want "")`);
assert(c['no-settlement.xlsx'].payments.length === 2, `no-settle.pay=${c['no-settlement.xlsx'].payments.length} (want 2)`);
assert(c['no-settlement.xlsx'].receivables.length === 1, `no-settle.recv=${c['no-settlement.xlsx'].receivables.length} (want 1)`);

assert(c['scattered-blanks.xlsx'].payments.length === 2, `scattered.pay=${c['scattered-blanks.xlsx'].payments.length} (want 2)`);
assert(c['scattered-blanks.xlsx'].settleDate === '', `scattered.settleDate="${c['scattered-blanks.xlsx'].settleDate}" (want "")`);

const rev = c['comma-negative.xlsx'].receivables.find(r => r.name === 'Reversal');
assert(rev && rev.receivable === -1234, `comma.Reversal.receivable=${rev?.receivable} (want -1234)`);
assert(rev && rev.waiver === 0, `comma.Reversal.waiver=${rev?.waiver} (want 0)`);
const pay2 = c['comma-negative.xlsx'].payments[1];
assert(pay2 && pay2.amount === -5000, `comma.pay[1].amount=${pay2?.amount} (want -5000)`);

const numInv = numCases.find(x => x.in === '(1,234)');
assert(numInv && numInv.out === -1234, `num("(1,234)")=${numInv?.out} (want -1234)`);
const num6 = numCases.find(x => x.in === '6,00,000');
assert(num6 && num6.out === 600000, `num("6,00,000")=${num6?.out} (want 600000)`);
const numEmpty = numCases.find(x => x.in === '');
assert(numEmpty && numEmpty.out === null, `num("")=${numEmpty?.out} (want null)`);
const numAbc = numCases.find(x => x.in === 'abc');
assert(numAbc && numAbc.out === null, `num("abc")=${numAbc?.out} (want null)`);

console.log('All structural invariants PASS.');
