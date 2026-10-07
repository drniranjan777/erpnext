# Module spec: AI agents, voice and predictive intelligence (Phase 12)

| | |
|---|---|
| **Status** | In progress: 12.1–12.4 done |
| **Code** | `backend/src/modules/agents/`, `database/src/schema/ai.ts`, `frontend/src/app/(app)/ai/` |

## Sprint plan

| Sprint | Scope |
|---|---|
| 12.1 | **Agent framework and AI Inbox**: scheduled and on-demand agents, recommendations with evidence and a proposed action, approve / dismiss with a reason, actions run through the normal services with the approver's permissions, guardrails (automatic execution within amount limits as the person who allowed it), full action log, kill switch, per-agent evaluation; Inventory and Purchase agents |
| 12.2 | **Business agents**: Sales (order and quote follow-ups, overdue reminders, cross-sell), Finance (MSME dues, duplicate / unusual bills, cash-flow outlook), Production (material shortages for upcoming work orders, schedule risk), Maintenance (PM due, spares), Quality (recurring NCRs, supplier rejection trends), HR (attendance anomalies), Compliance (statutory due dates, licence expiries, e-invoice failures), Customer support (first response on new tickets) |
| 12.3 | **Voice**: speech in the browser (English, Hindi, Telugu, Tamil, Marathi, Kannada, Gujarati, Bengali), a command grammar for ERP actions in English, Hindi and Hinglish ("Line 2 par 5,000 units ka production order banao"), confirm-before-acting drafts, spoken replies, and an accuracy evaluation set |
| 12.4 | **Document AI and prediction**: more document types (delivery challans, bank statements, quotations, CoA, e-way bills), demand forecasting v2 with model selection by backtest, purchase price forecasts, collection prediction and cash-flow, conversational "why" analysis (margin decomposition) |
| 12.5 | **AI governance**: per-workspace AI policy (features on/off, external model use, consent, PII masking), model and version registry, usage and cost metering with plan budgets, evaluation runs for intents and classifiers |

Exit target: at least 60 % of AI Inbox recommendations accepted at pilots; voice command accuracy at least 90 % in Hindi and English on the ERP vocabulary; AI cost per workspace within the plan budget.

## 12.1 Agent framework and AI Inbox (done)

Schema: `database/src/schema/ai.ts`, migration 0050. Code: `backend/src/modules/agents/` (`framework.ts` holds the scheduling, guardrail and stock maths, pure and unit tested). Pages: `/ai/inbox`, `/ai/agents`. Permissions: `ai.inbox.use` and `ai.agents.manage`.

**Agents**
- Each agent is a definition: code, what it watches, tunable thresholds, and a `run()` that reads the workspace's data under its row security and returns findings. Agents are rule-based: they need no AI key.
- An agent is switched on per workspace, hourly, daily at an IST hour, or weekly on Monday. Runs are jobs on the `agents.run` queue that schedule the next one. "Run now" runs at once.
- Every run is recorded (`ai_runs`): findings, new recommendations, automatic executions, errors.

**Recommendations (AI Inbox)**
- A finding becomes a recommendation with a severity, a title and body, its evidence ("why"), an optional link, a confidence and an optional proposed action.
- It carries the permission needed to see and decide it, so people see only what they could act on anyway.
- Each finding has a dedupe key. It is not raised again while open, for 14 days after a dismissal, or for 7 days after it was done. Open ones the agent no longer finds are marked expired, as are ones past their expiry.
- Approving runs the proposed action, or simply accepts a finding that has none. Dismissing needs a reason, which feeds the evaluation.

**Actions** (`actions.service.ts`)
- Actions go through the same services people use, so numbering, validation, approval workflows and audit apply.
- Agents only create drafts or send messages:
  - `create_requisition` (`purchase.requisitions.manage`): a draft purchase requisition;
  - `draft_stock_transfer` (`inventory.entries.manage`): a draft transfer entry;
  - `email_party`: an email to the party (event `agent.message`).
- The approver must hold the action's permission.

**Guardrails**
- Per agent:
  - "act without waiting for approval", only up to an amount and never above a maximum;
  - the agent's thresholds.
- Automatic execution runs as the person who switched it on (stored as the agent's actor), with their current permissions.

**Audit**: every executed action, approved or automatic, successful or failed, is in `ai_action_log` with the params and result.

**Kill switch**: stops every run (it is recorded as skipped) and every execution, for the whole workspace, until resumed.

**Evaluation** (`GET /ai/evaluation`): per agent and finding kind over a period, showing:
- raised, done (and how many automatically), dismissed, expired;
- acceptance % (accepted or executed out of those decided; the pilot target is 60 %);
- hours to decide;
- the top dismissal reasons.

**Inventory agent**
- Stock-out risk: days of cover from the last 60 days of real issues (transfers and reversed vouchers excluded) against the item's lead time plus 7 days. Critical if cover is shorter than the lead time.
- Batches expiring within 60 days (critical within 15).
- Slow stock: worth ₹50,000 or more and not issued for 180 days.
- Rebalancing: a warehouse that used more than it holds in 30 days while another holds the item unused. Proposes a draft transfer.

**Purchase agent**
- Reorder: stock + open PO quantity + open requisitions at or below the reorder level. Proposes a requisition for the reorder quantity (or up to twice the level), with the cheapest vendor of the last year as a suggestion and the estimated rate.
- POs more than 2 days past their expected date: proposes an email to the vendor asking for a dispatch date.
- PO prices in the last 30 days more than 10 % above the item's 6-month average.

## 12.2 Business agents (done)

Code: `backend/src/modules/agents/definitions/` (`sales.ts`, `finance.ts`, `operations.ts` (production, maintenance, quality), `people.ts` (HR, compliance), `support.ts`). `statutoryDue()` in `framework.ts` is pure and unit tested. A new action, `reply_ticket` (`service.tickets.manage`), sends a ticket reply. All agents use the 12.1 inbox, guardrails and evaluation; the e2e test runs every agent on a fresh workspace.

**Sales agent**
- Orders past their expected date.
- Approved quotations lapsing within 5 days with no order. Proposes a follow-up email.
- Customers with invoices overdue by more than 7 days: one reminder per customer, listing the invoices.
- Cross-sell: items that at least 3 customers bought together in a year, suggested to customers who bought one but not the other.

**Finance agent**
- MSME (micro / small) vendor bills within 7 days of, or past, 45 days from the invoice date. Paying later attracts MSMED Act interest and an s.43B(h) tax disallowance.
- Possible duplicate bills: the same vendor bill number, or the same amount within 10 days.
- Bills more than 3× the vendor's yearly average.
- A monthly outlook when payables due in 30 days exceed collections due, with the overdue receivables that would close the gap.

**Production agent**
- Work orders starting within 7 days whose open material needs exceed stock across nettable stores. Proposes a requisition for the shortfall.
- Work orders past their planned end.

**Maintenance agent**
- PM schedules due within 3 days, or overdue.
- Critical spares below their minimum. Proposes a requisition.

**Quality agent**
- The same defect category on an item 3 or more times in 60 days with no open CAPA.
- Suppliers whose incoming lots were rejected (fully or partly) more than 5 % of the time in 90 days (at least 3 lots).

**HR agent**
- Employees absent 3 or more days running (weekly offs and holidays don't break a streak).
- Late on 5 or more days in 30.
- Probations ending within a week without confirmation.

**Compliance agent**
- Statutory dates within 5 days, or up to 3 days overdue, each shown to the people with the matching permission: TDS deposit (7th), GSTR-1 (11th), PF / ESI (15th), GSTR-3B (20th), and quarterly TDS returns (31 Jul / 31 Oct / 31 Jan / 31 May). Government extensions are not modelled.
- Licences within their renewal lead time.
- Sales invoices whose e-invoice (IRN) failed.

**Customer support agent** (hourly)
- Tickets with no first response after 30 minutes get a drafted reply (category, warranty / contract cover, the best matching knowledge-base article, the resolution target). Approving sends it to the customer, which records the first response.
- Flags tickets whose wording suggests a higher priority than logged.

WhatsApp is not used for sending: messages go by email until a WhatsApp Business provider is connected.

## 12.3 Voice (done)

Code: `backend/src/modules/voice/` (`grammar.ts`, the command grammar; `eval-set.ts`, the evaluation set; both pure and unit tested), `frontend/src/components/voice-button.tsx` (on every screen, above the copilot button), page `/ai/voice`. Migration 0051 adds `ai_voice_logs`.

**Speech**
- Recognised in the browser with the Web Speech API (Chrome / Edge / Android): English, Hindi, Telugu, Tamil, Marathi, Kannada, Gujarati and Bengali (`xx-IN`).
- Replies are spoken with the browser's speech synthesis in the same language.
- Where speech is not available, commands can be typed. No audio leaves the device; only the transcript is sent.

**Understanding** (rule-based, no AI key needed)
- The transcript is normalised first:
  - Devanagari digits and keywords become Latin;
  - spoken numbers become digits: "paanch hazaar" / "पांच हजार" / "five thousand" → 5000, also "do sau pachaas", "dedh hazaar", "do lakh";
  - Indian digit grouping is removed.
- Three commands are recognised, with quantity, unit, item and production line:
  - production (work) order: "Line 2 par 5,000 units ka production order banao", "create a production order for 1200 hex bolts on line 1";
  - purchase requisition: "50 kg resin mangwao", "raise an indent for 200 bags of cement";
  - stock question: "hex bolt ka stock kitna hai", "how much stock of resin".
- Anything else goes to the copilot (which uses the model when a key is set). Commands in the other six languages are understood through the copilot model.

**Resolving**
- Items are matched by name or code (singular and plural).
- "Line 2" is matched to a work centre by name or code (L2, LINE2…). When no item is said, the item of the last work order run on that line is proposed, with a note.
- Warehouses come from that last order, or else the main store.

**Confirm before acting**
- A command never acts on its own. It returns a summary (item, quantity, line, start) and a spoken question.
- "Yes" creates a draft work order or requisition, checking the person's permission (`manufacturing.production.manage` / `purchase.requisitions.manage`).
- Missing or unknown details are asked back.

**Accuracy**
- The evaluation set holds 42 phrases (English, Hindi in Devanagari, Hinglish) across the three commands and non-commands. The unit test requires 90 % or more overall and in English and Hindi separately, the Phase 12 exit criterion.
- In use, every command is logged: understood, executed as heard, corrected on the confirm screen, cancelled, fallback or failed. The page shows "confirmed as heard" over the last 30 days alongside the evaluation score and any phrases not yet understood.

## 12.4 Document AI and prediction (done)

Code: `backend/src/modules/docai/` (`extractors.ts`, pure and unit tested), `backend/src/modules/predict/` (`analytics.ts`, pure and unit tested), and the forecasting additions in `planning/forecast.ts`. Migration 0052 adds `ai_doc_captures`. Permissions: `ai.documents.use` and `ai.insights.read`. Pages: `/ai/documents`, `/ai/insights`.

**Document AI**
- Recognises the document type from its text, or takes the type chosen by the user, and reads:
  - delivery challans: number, date, from / to GSTIN, vehicle, purpose (supply, returnable, job work, on approval), PO reference, item lines;
  - e-way bills: 12-digit EWB number, generated / valid-until dates, GSTINs, document number and date, vehicle, value, distance;
  - certificates of analysis: product, batch, manufacture / expiry dates, and each test with its specification and result. Results are judged against ranges ("6.5 - 7.5"), minimums ("NLT 98", "Min"), maximums ("NMT", "≤") and "complies"; failures are listed and the CoA is marked as failing.
  - vendor quotations: number, date, vendor GSTIN, validity (days or date), delivery days, payment terms, priced lines;
  - bank statements: date, narration, debit, credit, balance per row, with the running balance checked.
- Supplier bills are pointed to the Phase 4 bill capture.
- Text (pasted, .txt or .csv) is read directly. PDFs, scans, photos and handwriting are transcribed by the model when `ANTHROPIC_API_KEY` is set, then read the same way; without a key they are refused with a clear message.
- What was read is matched to records: parties by GSTIN, line items by name, documents by number, and incoming inspections by CoA batch.
- An e-way bill is checked against the sales invoice it names (EWB number, vehicle, value); differences become warnings.
- Captures are kept for review.
  - Applying a quotation updates the vendor's last rate for each matched item (`purchase.orders.manage`).
  - Applying a CoA attaches it to the incoming inspection of that batch, marked verified only if every result passes (`quality.inspections.manage`).
  - Other types are for checking. Bank statements are imported through bank reconciliation.

**Forecasting v2** (`planning/forecast.ts`)
- Croston's method (Syntetos–Boylan corrected) is tried for intermittent demand: 30 % or more months with no demand.
- Every forecast now carries an 80 % range: forecast ± 1.28 × the back-test RMSE, widening with √(months ahead), never below zero.
- Method selection by back-test is unchanged.

**Collections** (`GET /insights/collections`)
- Each customer's typical payment delay is the median days late over the last year's fully paid invoices; customers with fewer than 3 use the overall median.
- Every open invoice gets an expected date (due date + delay, not before today) and is bucketed into weeks. Invoices expected 60+ days late are at risk.

**Purchase price outlook** (`GET /insights/prices`): monthly average price paid per base unit for the 10 biggest-spend items (or one item) over 18 months. Gaps carry the last price forward; the forecast uses the same method selection, for 3 months with a range.

**Why** (`POST /insights/why`)
- Reads questions like "why did margin drop in Q2?", "why are sales down last month", "margin in August vs July".
- Periods: financial-year quarters, month names, last / this month, last quarter. The comparison is the period before unless two are named.
- Margin is split into selling-price, cost and product-mix effects in three steps that add up to the change, naming the items behind the cost and price effects and the lower-margin items that grew.
- Sales are split into price, volume, new and lost items, with the biggest movers.
