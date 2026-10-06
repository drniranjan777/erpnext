# Module spec: Reports, dashboards and AI Copilot (Phase 6)

| | |
|---|---|
| **Status** | Sprints 6.1–6.2 (7 Oct 2026) done: report catalogue; role dashboards |
| **Code** | `backend/src/modules/reports/`, `backend/src/modules/dashboards/`, `database/src/schema/analytics.ts` (migration 0024), `frontend/src/app/(app)/reports/`, `frontend/src/app/(app)/dashboards/`, `frontend/src/components/dashboard/` |
| **Tests** | `backend/test/e2e/reports.e2e.test.ts`, `backend/test/e2e/dashboards.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **6.1** ✅ | Report catalogue (62 reports): parameterised queries with totals, sorting, charts, Excel / CSV export and print-to-PDF; links to screens that are reports in their own right |
| **6.2** ✅ | Role-based dashboards (owner, plant head, sales, purchase, stores, production, finance, QA) with configurable widgets, drill-down and a TV mode for the shop floor |
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

## 2. Dashboards (6.2)

- **Widgets** (`dashboards/widgets.ts`): 30 of them, in three shapes.
  - **KPI**: a value, a line of context and a tone.
  - **Series**: weekly or daily bars.
  - **List**: top N, with links.
  - Each widget declares its permission and a drill-down (`href`) into the matching report or screen.
  - The finance widgets only read the books; they never create a chart of accounts.
- **Presets**: owner, plant head, sales, purchase, stores, production, finance, quality, shop-floor TV.
  - A preset lists only the widgets the viewer may see. The presets list shows those the viewer can mostly use.
- **Home dashboard**: the user's saved default, else the first preset they can see three-quarters of (owner → plant → finance → sales → …), else whatever widgets they can see.
- **Saved dashboards** (`dashboards` table):
  - Personal, or shared with everyone. Sharing needs `platform.customization.manage`.
  - Widgets are ordered and sized (small / half / full). Unknown widget keys are dropped on save.
  - One home dashboard per user.
- **Computation**: each widget runs in its own savepoint. One failure shows as *Could not load this widget* rather than blanking the page.
- **TV mode** (`/dashboards/tv?id|preset`): full screen with large type, a clock and the dashboard's own refresh (at least every 15 seconds; 30 s for the shop-floor TV preset).
- `GET /dashboards/widgets`, `GET /dashboards`, `GET /dashboards/view?id|preset`, `POST` / `PUT` / `DELETE /dashboards`.
