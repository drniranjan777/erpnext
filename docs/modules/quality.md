# Module spec: Quality and traceability (Sprint 5.3)

| | |
|---|---|
| **Status** | Sprint 5.3 (7 Oct 2026) done |
| **Code** | `backend/src/modules/quality/`, `database/src/schema/quality.ts` (migration 0022), `frontend/src/app/(app)/quality/` |
| **Tests** | `backend/test/unit/aql.test.ts`, `backend/test/e2e/quality.e2e.test.ts` |
| **Permissions** | `quality.inspections.read` (inspections, plans, traceability), `quality.inspections.manage` (plans, readings, decisions) |

## 1. Inspection plans

- **A plan is per item and stage**: *incoming*, *in-process* (optionally tied to an operation number) or *final*.
- **Characteristics**:
  - measured, with lower and upper limits, a unit and a method or instrument;
  - or pass / fail.
  - A characteristic marked *critical* rejects the lot on any failure.
- **Sampling**:
  - **AQL**: ISO 2859-1 / IS 2500-1 normal single sampling. The lot size and inspection level (S-1 … S-4, I, II, III) give the code letter (Table I). The master table (II-A) gives the sample size and the accept / reject numbers, following its arrows.
  - **Fixed** sample.
  - **100%**.
  - `GET /quality/sampling?lot&aql&level` shows the plan for any lot. Example: a lot of 500 at AQL 1.0, level II → letter H, 50 samples, Ac 1, Re 2.

## 2. Inspections (doc type `quality_inspection`, `QI/{FY}/{SEQ}`)

**Raised automatically, as drafts:**

| Stage | When | Lot |
|---|---|---|
| Incoming | a goods receipt is approved and the item has an active incoming plan | the accepted quantity, in the receiving store (use a *quarantine* store to hold it) |
| In-process | a job card stops with good pieces at an operation flagged for inspection, or one with an in-process plan | the card's good quantity, on the line |
| Final | a production receipt is posted and the item has a final plan | the output, in the target store |

Lots can also be raised by hand: customer returns, stock on hand, a second opinion.

**Readings**: `PUT …/readings` saves a value or a pass / fail per sample and characteristic.
- A sample with any failure counts as one defective.
- The lot is suggested for acceptance up to Ac and for rejection at Re. Any critical failure means reject.

**Decision** (`POST …/submit`): split the lot into accepted, rejected and rework. The three must add up to the lot. Approval rules apply. Then:
- **Incoming / final**:
  - Accepted goods move to the release store, e.g. out of quarantine.
  - Rejected and rework goods move to the chosen store. Rejects need one.
  - Batches move at their valuation, so the ledger does not change.
  - **Final rework** also creates a draft rework work order for the parent order, from the rejected store.
- **In-process**: rejected pieces leave the flow. The operation's good quantity drops and its rejects rise, so later operations and the receipt cannot count them. Rework stays at the operation.
- Serial-numbered lots are decided without moving warehouses; transfer them with their serials.

## 3. Traceability

Built from the stock ledger. Each movement carries its batch and serials, and transfers between stores (including inspection moves) are looked through.

- **Backward** (`GET /quality/trace/backward?itemId&batchNo|serialNo`): where a lot came from.
  - A goods receipt, with the vendor.
  - Or the work order that made it, with every lot that order consumed (net of returns), recursively. Up to 8 levels deep.
- **Forward** (`GET /quality/trace/forward?…`): where a lot went.
  - Work orders and what they made, recursively.
  - Deliveries and invoices, with the customer.
  - Returns to vendors, job workers.
  - Plus where it is in stock now.
- **As-built** (`GET /quality/as-built/:workOrderId`): the lots and serials a work order consumed and made. It is shown on the work order page.
- Genealogy is per work order: every lot consumed by an order is linked to every lot it made.
