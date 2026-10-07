# Module spec: Process manufacturing and advanced planning (Phase 7)

| | |
|---|---|
| **Status** | Sprint 7.1 (7 Oct 2026) done: formulas and process batches |
| **Code** | `backend/src/modules/process/`, `database/src/schema/process.ts` (migration 0027), `frontend/src/app/(app)/process/`, batch panel in `frontend/src/app/(app)/manufacturing/work-orders/[id]/batch.tsx` |
| **Tests** | `backend/test/unit/formula-math.test.ts`, `backend/test/e2e/process.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **7.1** ✅ | Master formula (percent / fixed / potency basis, tolerances, co-products and by-products, stages with in-process parameters, versions and approval, cost roll-up, scaling); process batches as work orders made from a formula; dispensing with tolerance and potency adjustment; stage readings; theoretical vs actual yield |
| 7.2 | Co-product cost apportionment at receipt, packing bulk into pack sizes (packing formulas), blending of batches, shade correction, equipment status and cleaning logs |
| 7.3 | Demand planning (statistical forecast with seasonality), MRP: multi-level net requirements, lead-time offsetting, lot sizing (L4L, fixed, EOQ, min / max, period), safety stock, planned orders → requisitions / work orders / batches, pegging, exception messages |
| 7.4 | Capacity: rough-cut and detailed load by work centre; finite scheduling board (Gantt, drag and drop, sequence-dependent setups); kanban; engineering change requests / notices with impact on open orders and stock; drawing register |

## 1. Formulas (doc type `formula`, `FRM/{SEQ}`)

- **Header**:
  - The product, and the kind: *bulk* makes the product, *packing* packs a bulk item into a pack SKU.
  - A standard batch size, and an optional batch multiple (batches are made in multiples of it).
  - The theoretical yield %, and a regulatory declaration (INCI, nutrition, SDS reference).
- **Lines**:
  - **Ingredients** are dosed on one of three bases:
    - *percent* of the batch. A formula written fully in percent must add up to 100 % (±0.01).
    - *fixed* quantity per standard batch, scaled with the batch.
    - *potency*: the pure active per standard batch, at a standard potency. The quantity issued is weighed up for the lot's assay.
  - Each ingredient has a dispensing tolerance (± %) and the stage it goes in at.
  - **Co-products** carry a share of the batch cost. Together the shares must stay below 100 %.
  - **By-products** carry a recovery value.
- **Stages**: a work centre, minutes per standard batch (scaled with the batch), in-process parameters with limits, and instructions.
- **Lifecycle**: drafts are approved through the document workflow and are then frozen. *New version* copies a formula into a draft. Approving a default version closes the previous default the day before, as for BOMs.
- **Cost roll-up** (`POST /process/formulas/:id/cost {apply}`):
  - Ingredients at standard cost (else average cost, else last purchase rate), plus stage minutes at the work centre's labour + machine + overhead rate, less by-product recoveries.
  - Co-products take their share. The rest is spread over the expected output (batch × yield).
  - The cost is stored per unit on the formula. `apply` writes it to the item's standard cost.
- **Scaling**: `GET /process/formulas/:id/scale?qty` gives the quantities for any batch size.

## 2. Process batches (work orders of kind `batch`)

- **Creating a batch**: `POST /manufacturing/work-orders {kind: 'batch', formulaId?, batchNo?}`. Without a formula id, the item's default approved formula is used.
  - The quantity must be a multiple of the formula's batch multiple.
  - Ingredients become materials, keeping their basis, standard potency and tolerance. Co-products and by-products become expected outputs.
  - Stages become operations, with planned minutes scaled and their parameter limits.
- **Shared with work orders**: release (availability and reservation), receipts, WIP, absorption, variances, close and GL postings are the work-order machinery. The standard cost comes from the formula.
- **Dispensing** (`POST /process/batches/:id/dispense`) checks each weighing, then issues everything through one production entry and records it in `dispensings`.
  - **Target**: the remaining requirement. For potency-dosed ingredients it is `remaining × standard potency ÷ lot assay`, and the lot's assay is required.
  - **Tolerance**: a weighing outside ± tolerance % of the target is refused unless a reason is given. It is then recorded as an override.
  - **Several lots**: partial dispensing is tracked in standard-potency terms, so lots with different assays can be combined.
  - **Record**: each weighing keeps its lot, assay, target, weight, tolerance result, who weighed it and who checked it.
- **Stage readings**: a job card at a stage with parameters must carry a reading for every parameter. Readings outside the limits are saved but flagged, and the batch view lists them.
- **Output lot**: the receipt carries the batch number unless another is given.
- **Yield** (`GET /process/batches/:id`):
  - Input = ingredient quantity issued; theoretical output = input × formula yield %.
  - Actual yield % = output ÷ theoretical, and loss = theoretical − output.
  - The same view returns the dispensing record and the readings.

## Permissions

Formulas use `manufacturing.engineering.*`. Batches and dispensing use `manufacturing.production.*`. Stage readings come in with job cards (`manufacturing.shopfloor.record`).
