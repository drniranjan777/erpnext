# Module spec: CRM, distribution and after-sales service (Phase 10)

| | |
|---|---|
| **Status** | In progress: 10.1–10.2 done |
| **Code** | `backend/src/modules/crm/`, `backend/src/modules/dms/`, `backend/src/modules/service/`, `backend/src/modules/portal/`, `database/src/schema/crm.ts`, `dms.ts`, `service.ts`, `frontend/src/app/(app)/crm/`, `dms/`, `service/`, `frontend/src/app/portal/` |

## Sprint plan

| Sprint | Scope |
|---|---|
| 10.1 | **CRM core**: leads (manual, web-form capture with a public form key, CSV / IndiaMART-format import), duplicate check, rule-based lead scoring, assignment by territory, lead → customer + opportunity conversion; opportunities with a stage pipeline (Kanban), weighted forecast, won / lost with reason, quotation from an opportunity; activities (calls, meetings, tasks, notes, emails and WhatsApp logged) with follow-up reminders; territories; sales targets by person and month with achievement from won opportunities |
| 10.2 | **CPQ and customer schedules**: estimation engine for corrugated boxes (ply, GSM, flute, size, print), sheet-metal fabrication (weight-based) and furniture (size, finish), each with material, conversion and margin; quote templates; estimate → quotation; margin-based quotation approval; OEM delivery schedules / releases per item, schedule vs dispatch adherence, ASN from a delivery |
| 10.3 | **Distribution (DMS)**: distributors and retailers, distributor stock from primary sales less reported secondary sales, secondary sales capture, schemes (quantity / value slabs, free goods) with claims and settlement by credit note, beat plans and salesperson visits (geo check-in, photo, order capture), retailer loyalty points |
| 10.4 | **After-sales service**: tickets (email / phone / portal / WhatsApp) with SLA policies, breach and escalation, knowledge base, warranty registration by serial, installation and commissioning, service contracts (customer AMC) with visit schedules, field-service visits (spares used issued from stock, customer signature), RMA and repair |
| 10.5 | **Portals and AI**: customer portal (orders, invoices, payments, statement, tickets, schedules / ASN) and dealer portal (orders, scheme status, claims) with separate portal logins per party contact; AI: lead scoring explanation, next-best action, ticket classification and suggested replies (rule-based without an API key) |

Exit target: a DMS pilot with at least 20 distributors live; service SLA reports accurate.

## 10.1 CRM core (done)

Schema: `database/src/schema/crm.ts`, migration 0040. Code: `backend/src/modules/crm/`. Scoring and import parsing are in `scoring.ts`, pure and unit tested.

**Leads** (LD00001…)
- Sources: manual entry; CSV / XLSX import of IndiaMART, TradeIndia or JustDial exports (or a plain list); and public web forms.
- An import can be run again safely: a lead with the same source and portal enquiry id (`UNIQUE_QUERY_ID` and similar) is not created twice.
- A lead whose phone (last 10 digits) or email matches an open lead is flagged as a possible duplicate, not merged.
- The lead's state picks its territory; the territory owner is assigned unless an owner was given. A state belongs to only one territory.
- Score, 0–100, with its reasons shown on the lead (grades: A 70+, B 40+, C below):
  - source: referral 20; walk-in and exhibition 15; web, WhatsApp and email 10; portals 5
  - phone 10; business email 15 (personal email 5); company 10
  - value: ₹10 lakh or more 25, ₹1 lakh or more 15, any value 5
  - a clear requirement 10
  - 5 per completed interaction, up to 15
  - qualified +10, unqualified −30
- Lead statuses: new → contacted (automatically, on the first completed call, meeting, email or WhatsApp) → qualified / unqualified / lost (a reason is needed) → converted.
- **Convert**: picks an existing customer or creates one through `PartiesService.createTx` (GSTIN, address, the lead as primary contact), and optionally an opportunity. The lead's activities move to the customer. Converting needs `masters.parties.manage` as well.

**Public web forms**
- `POST /api/v1/public/crm/forms/:key/leads` takes JSON: name, plus email or phone, plus optional company, city, state, product and message.
- The key is the tenant id plus a random secret, so the request runs under that tenant's row security without a login.
- A hidden `website` field is a honeypot: anything in it is rejected.
- CORS allows any origin on `/api/v1/public/*` only (without credentials); the rest of the API keeps its origin list.
- The setup page gives a copy-paste `fetch` snippet.

**Activities**: call, meeting, task, note, email or WhatsApp, each linked to a lead, an opportunity or a customer. They are either done now or scheduled with a due time. My agenda shows open activities, overdue ones flagged; leads due for follow-up are listed too.

**Opportunities** (OP00001…)
- Default stages: Qualification 10 %, Needs analysis 25 %, Proposal 50 %, Negotiation 75 %, Won, Lost. Stages are editable and can be hidden.
- The board supports drag and drop. Dropping on Lost asks for a reason.
- **Quote** creates a draft sales quotation for the customer (`QuotationsService.createTx`, with the opportunity number as the enquiry reference). It sets the opportunity's value to the quotation's taxable total and moves it to the first stage of 50 % or more.
- Forecast: the open pipeline by month of expected close, total and weighted by probability, plus the win rate over the last year.
- Targets: per salesperson per month. Achievement is the value of opportunities won that month (sales invoices carry no salesperson yet).

**Permissions**: `crm.leads.read`, `crm.leads.manage`, `crm.opportunities.read`, `crm.opportunities.manage`, `crm.setup.manage`.

**UI**: `/crm` (summary, agenda, follow-ups, leads by source), `/crm/leads` (filters, import, bulk assign), `/crm/leads/:id` (score reasons, activities, qualify, convert), `/crm/pipeline` (board and forecast), `/crm/opportunities/:id`, `/crm/setup` (targets, territories, stages, web forms).

**Not built**: direct API pulls from IndiaMART / TradeIndia (their push and pull APIs need each customer's own key; file import covers it meanwhile), click-to-call telephony and email inbox sync.

## 10.2 CPQ and customer schedules (done)

Schema: `database/src/schema/cpq.ts`, migration 0041. The engines and the configurator are in `backend/src/modules/crm/estimate.ts`, pure and unit tested.

**Estimation engines**: each shows its working line by line. The price is set by a margin on price: price = cost ÷ (1 − margin).
- **Corrugated box (RSC)**:
  - Blank = 2 (L + W) + 35 mm glue flap by W + H + 6 mm trim.
  - Board GSM = the liners plus each flute's GSM × its take-up: A 1.5, B 1.35, C 1.45, E 1.25, F 1.2.
  - Box weight = blank area × board GSM, plus wastage.
  - Cost = weight × (paper ₹/kg + conversion ₹/kg) + print colours × ₹ per colour.
  - Checks the ply against the number of layers given.
- **Fabrication**:
  - Plate weight = L × W × t × density (MS and GI 7,850, SS 8,000, Al 2,700 kg/m³); sections are entered by weight.
  - Material = weight plus scrap, at ₹/kg by material.
  - Processes at minutes × shop rate; finishing at ₹ per kg; overheads as a % of direct cost.
- **Furniture** (a cabinet carcass):
  - Board area = sides + top / bottom + shelves + doors, plus wastage; back panel separately.
  - Finish on the visible faces (the doors on both sides).
  - Edge band on the front edges and around the doors; then hardware and labour.

**Estimates**
- Estimates (EST00001…) store their inputs and result.
- **Quote** creates a draft sales quotation with one line: the chosen item at the estimated price, with a description carrying the specification. The default (or chosen) quote template supplies the terms and the validity. A linked opportunity takes the quotation and its value.
- The existing approval rule `margin_below` (from 3.3) still governs submitting the quotation, using the item's cost.

**Configurator**
- Option groups on an item: required or optional, single or multiple choice. Each option has a price delta, and `excludes` / `requires` rules written as `GROUP.OPTION`.
- `POST /cpq/configure` checks a choice and prices it from the item's selling rate. Quoting a valid configuration saves it as an estimate and drafts the quotation; the line description lists the choices.

**Customer schedules**
- A monthly schedule (release) per customer and item, with the customer's part number. Saving again for the same customer, item and month makes a new revision and supersedes the previous one; the number is kept.
- File import columns: customer code or GSTIN, `item_code` or `customer_part_no`, date, qty.
- **Adherence** for a month, per schedule, against posted delivery notes:
  - quantity adherence = dispatched by today ÷ due by today, capped at 100 %;
  - on-time adherence = the share of schedule dates whose cumulative quantity had been dispatched by that date;
  - plus the shortfall and the excess.

**ASN**: made from a posted delivery note (one per delivery). It carries the transporter, vehicle, LR number and packages, and lines with the customer's part numbers taken from the schedules. Status goes from sent to received. Sending ASNs into an OEM's own portal format (EDI) is not built; the customer portal (10.5) will show them.

**Permissions**: `cpq.estimates.read`, `cpq.estimates.manage`, `sales.schedules.read`, `sales.schedules.manage`.

**UI**: `/crm/estimates` (the three engines with live calculation, quoting, quote templates), `/crm/configurator` (choose options, see the price, quote; edit option groups), `/sales/schedules` (adherence, schedules, ASNs; import).
