// tools/generate-golden-vectors.mjs
// Runs the REAL web engine (extracted from index.html) and emits golden vectors
// for the Swift port. Node 20+, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).sort((a, b) => b.length - a.length)[0];

// Naive brace counter: it works because none of the functions we extract
// (the pure set below + the DOM-coupled set in the Task-2 section: getChartColors,
// alpha, fmtBDT, fmtSBDT, calcDeposit, settleUpdateTotals) contain an UNBALANCED
// brace inside a string/regex literal (verified at v1.0.0).
// `${...}` template braces stay balanced, so they're fine. If a future edit adds
// something like a string `'opening {'` to one of these functions, extract() will
// throw "unbalanced braces" loudly on the next run — fix the source, not this counter.
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
  fxTakaPerUsd: 110,   // snapshot rate; used only by currency-display helpers, never by financial math
};
for (const fn of ['sym','toDisp','fmt','fmtS','grp','num','emiFormula','getED','fmtTenor',
                  'buildSchedule','calcEffectiveRate','dscrPMT','dscrIRR','dscrFV',
                  'xirr','scenarioCalc','fdMultiplierMonths']) {
  (0, eval)(extract(fn));            // indirect eval -> defines on globalThis
}

const nn = v => (typeof v === 'number' && !Number.isFinite(v)) ? null : v; // NaN/Inf -> null
const vectors = { meta: {
  sourceCommit: execSync('git rev-parse HEAD', { cwd: new URL('..', import.meta.url).pathname }).toString().trim(),
} };

// getED — all slab boundaries, both sides
vectors.getED = [
  0, 1, 299999, 300000, 300001, 399999, 400000, 400001, 499999, 500000, 500001, 999999, 1000000, 1000001,
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

// Loan schedules (buildSchedule is pure). Tenor is in MONTHS (6-month-interval feature).
// The whole-year cases below (months % 12 === 0) MUST regenerate bit-identical to the prior
// years-based vectors — that's the parity proof for the months refactor. The sub-year cases
// exercise the new partial-final-year path.
vectors.loanSchedule = [];
for (const c of [
  { P: 1000000, rate: 9,  months: 120, extra: 0 },
  { P: 1000000, rate: 9,  months: 120, extra: 5000 },
  { P: 600000,  rate: 6,  months: 60,  extra: 0 },
  { P: 600000,  rate: 7,  months: 60,  extra: 0 },
  { P: 4750000, rate: 12.5, months: 240, extra: 0 },
  { P: 4750000, rate: 12.5, months: 240, extra: 25000 },
  { P: 50000,   rate: 1,  months: 12,  extra: 0 },
  { P: 50000000, rate: 25, months: 360, extra: 100000 },
  // 6-month-interval cases: partial final year, with and without prepay, plus a sub-UI-min tenor.
  { P: 1000000, rate: 9,  months: 18,  extra: 0 },     // 1y 6m → Yr 2 is a 6-month partial row
  { P: 1000000, rate: 9,  months: 30,  extra: 0 },     // 2y 6m
  { P: 600000,  rate: 7,  months: 18,  extra: 5000 },  // partial final year WITH prepay
  { P: 4750000, rate: 12.5, months: 54, extra: 0 },    // 4y 6m
  { P: 50000,   rate: 1,  months: 6,   extra: 0 },     // below the UI's 12-month min — engine robustness
  // 3-month-interval grid cases: tenors that are off the old 6-month grid (months % 6 !== 0).
  { P: 1000000, rate: 9,  months: 15,  extra: 0 },     // 1y 3m → new 3-month notch
  { P: 1000000, rate: 9,  months: 27,  extra: 5000 },  // 2y 3m WITH prepay
  { P: 4750000, rate: 12.5, months: 39, extra: 0 },    // 3y 3m
]) {
  const s = buildSchedule(c.P, c.rate, c.months, c.extra);
  vectors.loanSchedule.push({ ...c, emi: s.emi, totalPaid: s.totalPaid,
    totalInterest: s.totalInterest, totalMonths: s.totalMonths,
    rows: s.rows.map(r => ({ year: r.year, open: r.open, principal: r.principal,
                             interest: r.interest, close: r.close })) });
}

// Effective rate (EAR) — calcEffectiveRate is pure. Vectors record the REAL engine
// output, INCLUDING the null branch (netDisb <= 0). Where a `result` is non-null but
// the web UI still hides it, that gating lives in the caller, not the engine — the
// Swift engine should compute the same values and let the UI decide what to show.
vectors.effectiveRate = [];
for (const c of [
  { P: 1000000, rate: 9, months: 120, advEMI: 0, csAmt: 0,      csRate: 0 },   // engine returns a valid EAR (~9.38%); web UI hides it (no advance EMI, no cash security)
  { P: 1000000, rate: 9, months: 120, advEMI: 2, csAmt: 0,      csRate: 0 },
  { P: 1000000, rate: 9, months: 120, advEMI: 0, csAmt: 200000, csRate: 7 },
  { P: 1000000, rate: 9, months: 120, advEMI: 3, csAmt: 300000, csRate: 8.5 },
  { P: 1000000, rate: 19, months: 36, advEMI: 12, csAmt: 500000, csRate: 0 },  // heavy advance + cash security -> sharply negative effective rate; netDisb stays > 0 (NOT null)
  { P: 1000000, rate: 19, months: 36, advEMI: 12, csAmt: 700000, csRate: 0 },  // advance EMIs + cash security exceed principal -> netDisb <= 0 -> engine returns null
  { P: 1000000, rate: 9, months: 30, advEMI: 2, csAmt: 200000, csRate: 7 },    // 6-month-interval (2y 6m) effective rate over a partial-year tenor
]) {
  const emi = buildSchedule(c.P, c.rate, c.months, 0).emi;
  const r = calcEffectiveRate(c.P, c.rate, c.months, emi, c.advEMI, c.csAmt, c.csRate);
  vectors.effectiveRate.push({ ...c, emi, result: r === null ? null : {
    effectiveRate: r.effectiveRate, netDisbursement: r.netDisbursement,
    csInterest: r.csInterest, rateMarkup: r.rateMarkup } });
}

// Compare — scenarioCalc is pure (needs fmt, already defined); winner is numeric
// Tenor is in MONTHS (6-month-interval feature). Whole-year cases (months % 12 === 0) stay
// bit-identical to the prior years-based vectors; the sub-year cases exercise partial final years.
vectors.compare = [];
for (const c of [
  { aType:'loan', aAmt:600000, aRate:6, aMonths:60,  bType:'loan', bAmt:600000, bRate:7, bMonths:60 },   // historical string-trap case
  { aType:'loan', aAmt:50000,  aRate:1, aMonths:60,  bType:'loan', bAmt:50000,  bRate:15, bMonths:240 },
  { aType:'deposit', aAmt:500000, aRate:8, aMonths:120, bType:'deposit', bAmt:500000, bRate:12, bMonths:120 },
  { aType:'loan', aAmt:1000000, aRate:9, aMonths:120, bType:'loan', bAmt:1000000, bRate:9, bMonths:120 }, // tie
  { aType:'loan', aAmt:600000, aRate:7, aMonths:18, bType:'loan', bAmt:600000, bRate:9, bMonths:30 },      // 6-month-interval loan vs loan
  { aType:'deposit', aAmt:500000, aRate:8, aMonths:18, bType:'deposit', bAmt:500000, bRate:8, bMonths:30 }, // 6-month-interval deposit vs deposit
  { aType:'loan', aAmt:600000, aRate:7, aMonths:15, bType:'loan', bAmt:600000, bRate:9, bMonths:39 },      // 3-month-interval loan vs loan (off the old grid)
  { aType:'deposit', aAmt:500000, aRate:8, aMonths:15, bType:'deposit', bAmt:500000, bRate:8, bMonths:27 }, // 3-month-interval deposit vs deposit
]) {
  const A = scenarioCalc(c.aType, c.aAmt, c.aRate, c.aMonths);
  const B = scenarioCalc(c.bType, c.bAmt, c.bRate, c.bMonths);
  vectors.compare.push({ ...c,
    aFinal: A.vals[A.vals.length-1], bFinal: B.vals[B.vals.length-1],
    aTotalInt: nn(A.totalInt ?? null), bTotalInt: nn(B.totalInt ?? null),
    // Ties fall to B by design (strict < / >, mirrors the web engine) — do not "fix" to <=.
    winner: c.aType==='loan' ? (A.totalInt < B.totalInt ? 'A' : 'B')
                             : (A.vals[A.vals.length-1] > B.vals[B.vals.length-1] ? 'A' : 'B') });
}

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
globalThis.dChart = null;
(0, eval)(extract('getChartColors'));
(0, eval)(extract('alpha'));
(0, eval)(extract('fmtBDT'));
(0, eval)(extract('fmtSBDT'));
(0, eval)(extract('grp'));   // settleUpdateTotals/calcDeposit call grp; re-eval is a harmless redefine (also in the pure loop above)
(0, eval)(extract('calcDeposit'));
globalThis.currentPreset = 'custom';

const deNum = s => parseFloat(String(s).replace(/[৳,]/g,'')) || 0;  // "৳21,78,010" -> 2178010
// Runs the REAL calcDeposit() engine instead of reimplementing its maths: inputs go IN
// via stub DOM elements, calcDeposit() runs, outputs come BACK out of those same elements
// (the on-screen result spans + table). So any future change to the web calculator flows
// straight into the golden vectors — the Swift port stays pinned to whatever the web does.
function runDeposit(c) {  // c: {preset,P,contrib,weekly,rate,compound,years,actualYears,edOn,taxOn,psr,tableView}
  globalThis.currentPreset = c.preset;
  el('d-principal').value = String(c.P); el('d-contrib').value = String(c.contrib ?? 0);
  el('d-weekly').value = String(c.weekly ?? 0); el('d-rate').value = String(c.rate);
  el('d-freq').value = String(c.compound);
  // #d-years now holds MONTHS (3-month grid). Cases are declared in YEARS → convert (×12).
  el('d-years').value = String(Math.round(c.years * 12));
  el('d-years').dataset.actual = c.actualYears != null ? String(Math.round(c.actualYears * 12)) : '';
  el('d-contrib-freq').value = c.contribFreq ?? 'monthly';
  el('d-table-view').value = 'yearly';  // always yearly; the WDS weekly table is UI-only, not part of the parity contract
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
  { preset:'fd',  P:100000, contrib:0, rate:9.5,  compound:4,  years:2, edOn:true, taxOn:true, psr:true },   // ED+tax mandatory now
  { preset:'dps', P:0, contrib:5000,  rate:11,    compound:12, years:5, edOn:true,  taxOn:true,  psr:true },
  { preset:'wds', P:0, weekly:500,  rate:10.5, compound:12, years:1, actualYears:1, contribFreq:'weekly', edOn:true, taxOn:true, psr:true },
  { preset:'wds', P:0, weekly:2000, rate:10.5, compound:12, years:1, actualYears:0.5, contribFreq:'weekly', edOn:true, taxOn:true, psr:false },
  { preset:'mbs', P:500000, contrib:0, rate:10, compound:12, years:3, edOn:true, taxOn:true, psr:true },
  { preset:'mbs', P:2000000, contrib:0, rate:10, compound:12, years:5, edOn:true, taxOn:true, psr:false },
  { preset:'custom', P:100000, contrib:2000, contribFreq:'weekly', rate:8.5, compound:12, years:3, edOn:true, taxOn:true, psr:true },
  { preset:'custom', P:100000, contrib:0, rate:8.5, compound:12, years:1.5, edOn:true, taxOn:true, psr:true },   // 6-month-step (18mo) deposit slider value
  // 3-month-step deposit slider values (15/27/39 months → 1.25/2.25/3.25 years), off the old 6-month grid.
  { preset:'custom', P:100000, contrib:0,    rate:8.5, compound:12, years:1.25, edOn:true, taxOn:true, psr:true },  // 15mo
  { preset:'custom', P:100000, contrib:5000, rate:8.5, compound:12, years:2.25, edOn:true, taxOn:true, psr:true },  // 27mo with contributions
  { preset:'fd',     P:100000, contrib:0,    rate:8,   compound:4,  years:3.25, edOn:true, taxOn:true, psr:true },  // 39mo FD
);
for (const c of depositCases) vectors.deposit.push({ input: c, output: runDeposit(c) });

// FD "double/triple your money" solver — fdMultiplierMonths is pure (extracted above).
// For a fixed principal P, find the tenor (snapped UP to the 3-month grid, capped at 480mo)
// that reaches N× gross maturity. grossFV is the exact closed-form FV on that grid (quarterly
// compounding at rate/4 per quarter = rate/400 as a fraction), matching the deposit FV display.
const FD_MULT_P = 100000;
vectors.fdMultiplier = [];
for (const rate of [12, 9.5, 8, 1.75, 1])
  for (const N of [2, 3]) {
    const { months, reached } = fdMultiplierMonths(rate, N);
    const grossFV = Math.round(FD_MULT_P * Math.pow(1 + rate / 400, months / 3));
    vectors.fdMultiplier.push({ P: FD_MULT_P, rate, N, months, reached, grossFV });
  }

// ---- Settlement collection-for-IRR vectors ----
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

writeFileSync(new URL('./golden-vectors.json', import.meta.url), JSON.stringify(vectors, null, 1));
console.log('sections:', Object.keys(vectors).map(k => `${k}:${Array.isArray(vectors[k]) ? vectors[k].length : '-'}`).join(' '));
