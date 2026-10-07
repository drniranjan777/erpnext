# Module spec: Reports, dashboards and AI Copilot (Phase 6)

| | |
|---|---|
| **Status** | Sprints 6.1–6.3 (7 Oct 2026) done: report catalogue; role dashboards; report builder and scheduled delivery |
| **Code** | `backend/src/modules/reports/`, `backend/src/modules/dashboards/`, `database/src/schema/analytics.ts` (migrations 0024–0025), `frontend/src/app/(app)/reports/`, `frontend/src/app/(app)/dashboards/`, `frontend/src/components/dashboard/` |
| **Tests** | `backend/test/unit/report-builder.test.ts`, `backend/test/e2e/reports.e2e.test.ts`, `backend/test/e2e/dashboards.e2e.test.ts`, `backend/test/e2e/report-builder.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **6.1** ✅ | Report catalogue (62 reports): parameterised queries with totals, sorting, charts, Excel / CSV export and print-to-PDF; links to screens that are reports in their own right |
| **6.2** ✅ | Role-based dashboards (owner, plant head, sales, purchase, stores, production, finance, QA) with configurable widgets, drill-down and a TV mode for the shop floor |
| **6.3** ✅ | Report builder v1: pick a dataset, fields, filters, grouping; save and share; scheduled delivery by email (WhatsApp via the notification channel) |
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

## 3. Report builder and schedules (6.3)

- **Datasets** (`reports/builder/datasets.ts`): sales invoice lines, purchase bill lines, stock on hand, stock movements, job cards, production receipts, inspections and open invoices.
  - Each dataset has a permission, a FROM clause, a base condition, an optional date column and its fields.
  - A field is a **dimension** or a **measure**. Measures have a default aggregate.
  - The SQL expressions live only in code; users never write SQL.
- **Spec**: dataset, fields, filters, period, grouping, per-measure aggregates (sum, avg, min, max, count), sort and a row limit of up to 10,000.
  - **Filters**: is, is not, contains, is one of, comparisons, empty / not empty. Values are checked by type and always bound.
  - **Periods**: fytd, mtd, last month, Indian quarter-to-date, last 7 / 30 / 90 days, today, last FY, all, custom.
  - **Grouping**: one row per combination of the dimensions, with aggregated measures. Totals appear only where they add up (sums and counts).
- **Saved reports** (`saved_reports`): personal or shared. Sharing needs `platform.customization.manage`.
  - Run by id (`GET /report-builder/saved/:id/run`).
  - Export to Excel / CSV through the same renderer as the standard reports.
- **Schedules** (`report_schedules`): a standard report (with relative dates such as month start → today, or last month) or a saved report.
  - Daily, weekly on a weekday, or monthly on day 1–28, at an hour in India time.
  - Emailed as an Excel or CSV attachment.
  - **Jobs**: each run is a job at the next run time, deduplicated by schedule and time. A job that no longer matches the schedule (edited, paused or deleted) does nothing.
  - **Access**: runs use the owner's current permissions. Lost access is recorded as a failure (*The owner no longer has access to this report*).
  - **Send now** delivers immediately without moving the schedule.
- **Endpoints**:
  - Builder: `GET /report-builder/datasets`, `POST /report-builder/run`, `POST /report-builder/export`, and CRUD under `/report-builder/saved`.
  - Schedules: CRUD under `/report-schedules`, plus `POST /report-schedules/:id/run`.
