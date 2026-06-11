# InCalc — Banking Calculator Suite

A single-file, offline-capable web app of banking calculators built for Bangladesh banking practice (IDLC / SME context). No build step, no backend, no tracking — open `index.html` and it works.

**Live:** https://clauding-lab.github.io/interest-calc/

## Calculators

| Tab | What it does |
|---|---|
| **Deposit** | Interest projection for FD, DPS, WDS, MBS and custom deposits, with NBR excise duty and source tax (TDS) deductions, and a net-receivable figure. |
| **Loan** | EMI, total interest, amortization schedule, prepayment savings, and an effective-rate analysis for advance EMIs / cash security. |
| **DSCR/DBR** | Debt-service coverage and debt-burden ratios from an income statement plus existing and proposed obligations, with an IRR-based effective rate. |
| **Settlement IRR** | XIRR on a loan settlement: upload the working Excel (or start blank), enter receivables/waivers and the payment schedule, get the annualized return. |
| **Compare** | Two deposit/loan scenarios side by side. |

## Tech

- One `index.html` (markup + CSS + JS inline). No framework, no bundler.
- `sw.js` — service worker (network-first for the page, cache-first for assets) makes it an installable, offline-capable PWA.
- `manifest.json` + icons — PWA shell.
- Two CDN libraries, pinned with Subresource Integrity: **Chart.js 4.4.1** (charts) and **SheetJS 0.20.3** (Excel import on the Settlement tab).

## Running locally

It needs `http(s)` (not `file://`) for the service worker:

```sh
ruby -run -ehttpd . --port=8080   # then open http://localhost:8080
# or: python3 -m http.server 8080
```

## Regulatory values

Tax rates, the processing-fee rate, and the display FX rate live in one `CONFIG` block near the top of the `index.html` script. Excise-duty slabs live in `getED()` with a fiscal-year comment. **Re-check both after every Bangladesh national budget.**

## Disclaimer

Calculations are illustrative. Verify against official figures and consult a qualified advisor before relying on any output for a real decision.

## License

MIT — see [LICENSE](LICENSE).
