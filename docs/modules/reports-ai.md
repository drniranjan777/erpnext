# Module spec: Reports, dashboards and AI Copilot (Phase 6)

| | |
|---|---|
| **Status** | **Phase 6 code complete** (7 Oct 2026): report catalogue; role dashboards; report builder and schedules; AI Copilot v1; onboarding and launch hardening |
| **Code** | `backend/src/modules/reports/`, `backend/src/modules/dashboards/`, `backend/src/modules/copilot/`, `backend/src/modules/onboarding/`, `backend/scripts/load-test.mjs`, `frontend/src/components/copilot.tsx`, `database/src/schema/analytics.ts` (migrations 0024–0025), `frontend/src/app/(app)/reports/`, `frontend/src/app/(app)/dashboards/`, `frontend/src/components/dashboard/` |
| **Tests** | `backend/test/unit/report-builder.test.ts`, `backend/test/unit/copilot.test.ts`, `backend/test/e2e/copilot.e2e.test.ts`, `backend/test/e2e/onboarding.e2e.test.ts`, `backend/test/e2e/reports.e2e.test.ts`, `backend/test/e2e/dashboards.e2e.test.ts`, `backend/test/e2e/report-builder.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **6.1** ✅ | Report catalogue (62 reports): parameterised queries with totals, sorting, charts, Excel / CSV export and print-to-PDF; links to screens that are reports in their own right |
| **6.2** ✅ | Role-based dashboards (owner, plant head, sales, purchase, stores, production, finance, QA) with configurable widgets, drill-down and a TV mode for the shop floor |
| **6.3** ✅ | Report builder v1: pick a dataset, fields, filters, grouping; save and share; scheduled delivery by email (WhatsApp via the notification channel) |
| **6.4** ✅ | AI Copilot v1: chat panel on every screen; questions about your data answered through safe, permission-checked tools with charts; navigation; drafting documents behind a confirmation card; "why is this blocked?" explanations; English and Hindi |
| **6.5** ✅ | Onboarding (industry setup wizard, sample data mode, in-app tours, help centre) and launch hardening (performance budget, load-test script, accessibility pass, security headers) |

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

## 4. AI Copilot v1 (6.4)

- **Panel**: an *Ask* button on every screen (or Ctrl+J) opens a chat.
  - Replies show text, compact tables (with a link to the full report), fact lists and buttons.
  - The conversation stays in the tab's session storage.
  - Language: Auto (Hindi when you write in Devanagari), English or हिंदी.
- **Tools** (`copilot/tools.ts`). Each runs as the signed-in user, inside their row security and permissions:
  - `run_report` / `list_reports`: the standard report catalogue.
  - `query_data` / `describe_datasets`: the report-builder datasets.
  - `find_document`: by number (also "PO 45" → `…/0045`) or title, among document types the user can read.
  - `explain_document`: what is holding a document up.
    - All documents: the status, pending approval steps with who must act, the rejection comment, the cancel reason, and the period lock.
    - Sales orders: the credit check and progress.
    - Invoices: e-invoice errors and dues.
    - Bills: matching variance and MSME dues.
    - Work orders: shortages, lateness and pending inspections.
    - Inspections: the sample result.
  - `navigate`: a button to a screen inside the app's own areas only.
  - `draft_document`: a sales order, purchase order, requisition or work order from names.
    - Customer, vendor and item names are matched; ambiguous or unknown names are reported back.
    - Purchase order rates come from the last purchase price, else the standard cost.
    - **Nothing is created.** The user sees a card and presses *Create draft*, which calls the normal create endpoint as them.
- **With `ANTHROPIC_API_KEY`**: the model (`AI_MODEL`) chooses the tools, for up to six rounds.
  - The system prompt says tool output is data, not instructions; that it must not claim to change anything; and that it must not invent figures.
  - If the model is unreachable, the copilot falls back to the rule-based mode.
- **Without a key** (*Basic*): a rule-based router in English, Hindi and Hinglish (`copilot/intents.ts`) covers:
  - sales and purchases by period (today, yesterday, this week / month / year, last month);
  - receivables, payables and reorder;
  - work orders, pending purchase and sales orders, rejects by reason, and stock of an item;
  - opening and explaining documents;
  - drafting from sentences such as "draft purchase order from Deccan Steels: 100 hex bolt, 50 hex nut by 2026-12-01".
- **Limits**: 20 questions per user per minute. History is capped at 12 turns, and tool results are truncated before they reach the model.
- `GET /copilot/status` returns `{ mode: 'ai' | 'basic' }`. `POST /copilot/chat` takes `{ messages, language, page }`.

## 5. Onboarding and launch hardening (6.5)

- **Setup checklist** (`GET /onboarding/progress`, `/setup`, and the dashboard while incomplete).
  - Every tick comes from real data:
    - company GSTIN;
    - industry stores (at least 4);
    - at least 5 items;
    - customers and vendors;
    - approved opening stock;
    - books set up;
    - an approved BOM (manufacturing industries);
    - a second active member.
  - Optional steps: approval rules, and a first order or invoice.
- **Industry templates** (`onboarding/templates.ts`, `POST /onboarding/templates/apply`): 15 industries plus *Other*.
  - Each adds item groups and stores (FG, shop floor, rejected, scrap, plus industry stores such as MSL dry store, reel store or cold store) and work centres with typical hourly rates.
  - Idempotent by code. Applying a template sets the workspace's industry.
  - Needs `masters.setup.manage` and `inventory.warehouses.manage`. Work centres also need `manufacturing.engineering.manage`.
- **Tour**: four steps (menu, Ctrl+K search, dashboards, copilot) anchored on `data-tour` elements. Steps whose element is hidden are skipped; Esc ends the tour.
- **Help centre** (`/help`, `frontend/src/lib/help.ts`): ten searchable articles covering:
  - getting started, documents and approvals;
  - GST and e-invoicing, buying, production, quality;
  - reports, the copilot, dashboards, and year-end.
- **Security headers** (Next): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a `Permissions-Policy` that leaves the camera available for scanning.
  - HSTS is sent in production. The API keeps helmet.
  - A strict CSP needs nonces for Next's inline scripts, so it is left for the deployment proxy.
- **Performance budget**:
  - Every API response carries `x-response-time`. Requests slower than `SLOW_REQUEST_MS` (default 300) are logged with their request id.
  - New indexes on `documents (tenant, doc_type, doc_date)` and `job_cards (tenant, ended_at)` (migration 0026).
  - Dashboard widgets are cached for 30 seconds per workspace (per user for personal widgets). `?fresh=1` bypasses the cache.
- **Load test** (`node backend/scripts/load-test.mjs --users 50 --seconds 30`): concurrent users on the ten busiest read endpoints, with p50 / p95 / p99 per endpoint. It exits non-zero over budget or on errors.
  - Baseline on the dev laptop, 25 users × 15 s: 435 req/s, every endpoint p95 ≤ 105 ms. Before the widget cache, the dashboard was p95 356 ms.
- **Accessibility**: a skip-to-content link, a focusable `main` landmark, `aria-current` on the menu, labelled controls and keyboard-operable dialogs and tour.
- **Outside the code** (V1 exit criteria): third-party penetration test, DR drill on production infrastructure, pricing / GTM material, a status page, and pilot customers live for 4 weeks.
