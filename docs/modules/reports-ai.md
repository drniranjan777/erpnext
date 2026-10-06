# Module spec: Reports, dashboards and AI Copilot (Phase 6)

| | |
|---|---|
| **Status** | Sprint 6.1 (7 Oct 2026) done: standard report catalogue |
| **Code** | `backend/src/modules/reports/`, `frontend/src/app/(app)/reports/`, `frontend/src/app/print/reports/` |
| **Tests** | `backend/test/e2e/reports.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **6.1** ✅ | Report catalogue (62 reports): parameterised queries with totals, sorting, charts, Excel / CSV export and print-to-PDF; links to screens that are reports in their own right |
| 6.2 | Role-based dashboards (owner, plant head, sales, purchase, stores, production, finance, QA) with configurable widgets, drill-down and a TV mode for the shop floor |
| 6.3 | Report builder v1: pick a dataset, fields, filters, grouping; save and share; scheduled delivery by email (WhatsApp via the notification channel) |
| 6.4 | AI Copilot v1: chat panel on every screen; questions about your data answered through safe, permission-checked tools with charts; navigation; drafting documents behind a confirmation card; "why is this blocked?" explanations; English and Hindi |
| 6.5 | Onboarding (industry setup wizard, sample data mode, in-app tours, help centre) and launch hardening (performance budget, load-test script, accessibility pass, security headers) |

Not in code: the third-party penetration test, the DR drill on production infrastructure, pricing and GTM material, and the pilot customers in the V1 exit criteria.

## 1. Report catalogue (6.1)

- **Definitions** live in `reports/catalogue/*.ts`. Each report has a key, a title, a category, the permission it needs, typed parameters, typed columns and one SQL query.
- **Security**: queries run in the caller's tenant transaction, so row-level security applies. Parameters are bound, never spliced in.
- **Parameters**: types are `date`, `number`, `select`, `item`, `party`, `warehouse`.
  - Defaults: `fy_start` (1 April), `month_start`, `today`.
  - Every value is checked. A period cannot end before it starts. Required parameters are enforced.
- **Dates** use the India date (`now() at time zone 'Asia/Kolkata'`), not the database session's date.
- **Results**: rows (up to 10,000; beyond that the result is flagged as truncated), totals for summed columns, and an optional chart (category × value).
  - Numbers come back as strings, to keep decimals exact.
- **Export**: `GET /reports/:key/export?…&format=xlsx|csv`.
  - Excel: title, filters, a frozen header, Indian number formats and a totals row.
  - CSV: UTF-8 with a BOM.
  - Print / PDF: `/print/reports/:key`, A4 landscape.
- **Link reports** point to existing screens: statements, ageing, GST returns, the TDS register, fixed assets, the stock ledger, scrap trends and vendor performance.

| Area | Query reports |
|---|---|
| Sales | register, by customer (net of credit notes), by item, by state, margin by item, pending orders, delivered not invoiced, credit notes, quotation conversion, outstanding invoices |
| Purchase | register, pending orders, by vendor (net of debit notes), by item (min / avg / max rate), received not billed, debit notes, outstanding bills, MSME 45-day dues, price history |
| Inventory | stock summary, value by group, movement (opening / in / out / closing), FIFO ageing buckets, slow and non-moving, batch expiry, reorder (net of open POs), serial register |
| Production | work order status, plan vs actual, production by item, material consumption, job card log, OEE (availability × performance × quality), WIP, closed-order variances, tool life |
| Quality | inspection register, supplier quality |
