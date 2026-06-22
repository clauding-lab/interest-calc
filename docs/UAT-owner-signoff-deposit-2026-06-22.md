# Owner UAT — Deposit rules sign-off (2026-06-22)

**Status of the apps:** both are LIVE with these numbers — web **v1.1.1** (`incalc.clauding-lab.com`) and iOS **v1.1.0** (App Store, build 3). The deposit math, web↔iOS parity, and internal correctness are all machine-verified (882 golden vectors green on both; every number below independently re-derived from first principles). **This sheet is the one check a machine cannot do: confirming the RULES match how IDLC actually computes each product.** Only a banker can tick the right-hand column.

The numbers in **"App shows"** were read verbatim from the live web app on 2026-06-22 (FY2026-27 excise-duty slabs, source tax 10% with PSR / 15% without). iOS shows the same figures by construction — spot-check 2–3 cases on the phone to confirm.

> How to use: read each rule + the inputs, decide whether IDLC's real product term agrees, and tick ✓ or ✗. Where it's ✗, jot the correct convention in the notes so we can fix it web-first.

---

## A. The conventions being asserted (this is what must match IDLC)

| Area | What the app assumes | Confirm against IDLC |
|---|---|---|
| **Excise duty** | MANDATORY. Charged **per year** on that year's **gross (highest) balance**, FY2026-27 slabs (0–৳4L = Nil). Source tax never lowers the ED basis. | ☐ |
| **Source tax (TDS)** | MANDATORY. **10%** if proof of return (PSR) filed, **15%** if not. Withheld **annually** on each year's interest — so for multi-year deposits the net balance that compounds is after-tax. | ☐ |
| **FD** | **Annual** compounding; a sub-year FD earns pro-rated interest (rate × months/12). | ☐ |
| **DPS** | Monthly instalment, **annual** compounding, **no opening principal**; each instalment earns interest only for the months it was held that year (deposit-date pro-rating). | ☐ |
| **WDS** | Weekly instalment, **annual** compounding pro-rated by weeks held, **no opening principal**. | ☐ |
| **MBS** | **Simple** monthly payout = principal × rate ÷ 12; principal returned at maturity; no compounding. | ☐ |
| **FD 2× / 3×** | Smallest tenor on the 3-month grid where gross maturity reaches 2× / 3× the principal under annual compounding. | ☐ |
| **Custom** | The **only** product with a selectable compounding frequency (Monthly / Quarterly / Semi-annual / Annual). | ☐ |

---

## B. Worked cases — tick each against IDLC's product terms

PSR assumed **filed (10%)** unless the row says otherwise.

| # | Rule | Inputs | App shows (live v1.1.x) | Matches IDLC? |
|---|---|---|---|---|
| 1 | **ED on gross, mandatory** | FD **৳5,00,000** · 9.5% · 1y | Gross **৳5,47,500** · Interest ৳47,500 · **ED ৳500** (the ৳5L–৳10L slab, on the 5.47L gross — *not* zeroed by tax) · Tax ৳4,750 · **Net ৳5,42,250** | ☐ |
| 2 | **FD annual compounding** | FD ৳1,00,000 · 10% · 1y | Gross **৳1,10,000** · ED **৳0** (under the ৳4L exemption) · Tax ৳1,000 · Net ৳1,09,000 | ☐ |
| 3 | **FD 2 years + annual TDS** | FD ৳1,00,000 · 10% · 2y | Gross **৳1,21,000** · **Tax ৳2,090** (annual withholding, *not* a flat ৳2,100) · Net ৳1,18,810 | ☐ |
| 4 | **Sub-year FD pro-rated** | FD ৳1,00,000 · 10% · 3m | Gross **৳1,02,500** (a quarter's interest) · Net ৳1,02,250 | ☐ |
| 5 | Sub-year FD, 6 months | FD ৳1,00,000 · 10% · 6m | Gross **৳1,05,000** · Net ৳1,04,500 | ☐ |
| 6 | **DPS recurring, pro-rated** | DPS ৳5,000/mo · 11% · 5y | Invested **৳3,00,000** · Interest **৳95,932** · Gross ৳3,95,932 · ED ৳0 · Tax ৳9,465 · Net ৳3,85,182 | ☐ |
| 7 | **WDS weekly, pro-rated** | WDS ৳500/wk · 10.5% · 1y | Annual deposit **৳26,000** · Interest **৳1,391** · Gross ৳27,391 · Tax ৳139 · Net ৳27,252 | ☐ |
| 8 | **MBS simple payout** | MBS ৳5,00,000 · 10% · 3y | **Monthly payout ৳4,167** · total payout ৳1,50,000 · ED ৳450 (৳150 × 3y) · Tax ৳15,000 · **Net receivable ৳6,34,550** (principal returned) | ☐ |
| 9 | **FD 2× solver** | FD · 12% · tap **2×** | Tenor snaps to **6y 3m** (75 months) · Gross **৳2,03,304** (≥ 2×) | ☐ |
| 10 | **FD 3× solver** | FD · 12% · tap **3×** | Tenor **9y 9m** (117 months) · Gross **৳3,02,266** (≥ 3×) | ☐ |
| 11 | **PSR rate (no proof)** | FD ৳1,00,000 · 10% · 1y · **PSR not filed** | Tax **৳1,500** (15%, vs ৳1,000 filed) · Net ৳1,08,500 | ☐ |
| 12 | **Custom compounding** | Custom ৳1,00,000 · 8.5% · 1y | Monthly **৳1,08,839** · Quarterly ৳1,08,775 · Semi ৳1,08,681 · Annual **৳1,08,500** — only Custom exposes this selector | ☐ |

---

## C. Excise-duty slab reference (FY2026-27, effective 1 Jul 2026)

Charged per year on the year-end gross balance. Source: Budget Speech FY2026-27 (customs.gov.bd) + IDLC "Revised Rate of Excise Duty" slide — only the exemption band changed (৳3L → ৳4L); the rest are unchanged.

| Year-end balance (৳) | Excise duty (৳/yr) |
|---|---|
| 0 – 4,00,000 | Nil |
| 4,00,001 – 5,00,000 | 150 |
| 5,00,001 – 10,00,000 | 500 |
| 10,00,001 – 50,00,000 | 3,000 |
| 50,00,001 – 1,00,00,000 | 5,000 |
| 1,00,00,001 – 2,00,00,000 | 10,000 |
| 2,00,00,001 – 5,00,00,000 | 20,000 |
| Above 5,00,00,000 | 50,000 |

---

## D. Two conventions to scrutinise hardest

1. **Annual TDS withholding (cases 3, 9, 10).** The app deducts source tax every year on that year's interest, so the compounding net balance is after-tax. If IDLC instead withholds TDS only at maturity, the multi-year net figures will differ. **This is the single most material convention to confirm.**
2. **ED accrues every year (cases 1, 8).** A 3-year MBS at ৳5L incurs ৳150 × 3 = ৳450, not ৳150 once. Confirm IDLC charges excise duty annually on the balance, not a single deduction at maturity.

---

## E. Sign-off

- ☐ Section A conventions all match IDLC's actual product terms
- ☐ All 12 worked cases match (or discrepancies noted below)
- ☐ Owner confirms the live deposit numbers are correct for both web and iOS

> **Discrepancies / corrections found:**
>
> _(write here — each becomes a web-first fix: change web → regenerate golden vectors → mirror iOS → ship)_
