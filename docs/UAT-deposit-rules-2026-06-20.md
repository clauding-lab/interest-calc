# UAT — Deposit calculation changes (2026-06-20)

Run **before releasing** (web `incalc.clauding-lab.com` and/or the iOS build). The app's internal math and web↔iOS parity are already verified (882 golden vectors green on both). **This UAT confirms the RULES match how IDLC actually computes each product** — the one thing only a banker can sign off.

For each case: enter the inputs, read the result, and check it against IDLC's product terms / rate sheet. Source tax assumes **PSR filed (10%)** unless noted.

| # | Rule | Test case | App should show | Verify against IDLC |
|---|---|---|---|---|
| 1 | **ED on gross, mandatory** | FD ৳5,00,000 · 9.5% · 1 year | Excise duty applied on the ~৳5.5L gross balance (slab ৳3,000/yr), **not zeroed** by source tax; Net = Gross − tax − ED | ED is on the deposit balance, unaffected by income tax | ☐ |
| 2 | **FD annual compounding** | FD ৳1,00,000 · 10% · **1 year** | Gross maturity **৳1,10,000** (= P×1.10) | FD compounds annually, not quarterly | ☐ |
| 3 | FD annual, 2 years | FD ৳1,00,000 · 10% · **2 years** | **৳1,21,000** (P×1.10²) | | ☐ |
| 4 | **Sub-year FD pro-rated** | FD ৳1,00,000 · 10% · **3 months** | **৳1,02,500** (rate×3/12) | a 3-mo FD earns a quarter's interest, not a year | ☐ |
| 5 | Sub-year FD | FD ৳1,00,000 · 10% · **6 months** | **৳1,05,000** | | ☐ |
| 6 | **DPS recurring, pro-rated** | DPS ৳5,000/month · 11% · 5 years | Invested ৳3,00,000 · **gross interest ৳95,932** · future ~৳3.96L gross | a mid-year deposit earns only the months held, not a full year | ☐ |
| 7 | **WDS weekly** | WDS ৳500/week · 10.5% · 1 year | Weekly contributions pro-rated by weeks held | matches IDLC's WDS scheme | ☐ |
| 8 | **MBS simple payout** | MBS ৳5,00,000 · 10% | Monthly payout **৳4,167** (= P×10%/12); principal returned at maturity | simple monthly benefit, no compounding | ☐ |
| 9 | **FD 2× solver** | FD any amount · 12% · tap **2×** | Tenor snaps to **75 months (6y 3m)**; gross ≥ 2× principal | doubling time on an annual basis | ☐ |
| 10 | **FD 3× solver** | FD any amount · 12% · tap **3×** | Tenor ~**117 months**; gross ≥ 3× | | ☐ |
| 11 | **PSR rate** | Any deposit · toggle PSR off | Source tax rate 10% (filed) → **15%** (no proof) on interest | | ☐ |
| 12 | **Custom compounding** | Custom · change compounding Mo→Qtr→Semi→Yr | Maturity changes with each (the **only** product with a selectable compounding) | | ☐ |

## Cross-checks
- ☐ Web and iOS show the **same** numbers for cases 1–10.
- ☐ A previously-saved (whole-year, monthly/quarterly Custom) deposit gives the **same** number as before (those were deliberately left unchanged).

## Sign-off
- ☐ All product rules match IDLC's actual terms
- ☐ Owner approves the new deposit numbers for release
- ☐ Ready: merge PR #5 (web) + PR #13 (iOS); iOS needs a new App Store build + review

> Notes / discrepancies found:
>
