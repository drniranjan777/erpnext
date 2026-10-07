# Module spec: AI agents, voice and predictive intelligence (Phase 12)

| | |
|---|---|
| **Status** | In progress: 12.1 done |
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
