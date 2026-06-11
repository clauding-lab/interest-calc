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

writeFileSync(new URL('./golden-vectors.json', import.meta.url), JSON.stringify(vectors, null, 1)); console.log('sections:', Object.keys(vectors).map(k=>`${k}:${Array.isArray(vectors[k])?vectors[k].length:'-'}`).join(' '));
