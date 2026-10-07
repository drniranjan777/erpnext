# Module spec: Process manufacturing and advanced planning (Phase 7)

| | |
|---|---|
| **Status** | Sprints 7.1–7.3 (7 Oct 2026) done: formulas and process batches; co-products, packing, blending, corrections, equipment cleaning; demand forecast and MRP |
| **Code** | `backend/src/modules/process/`, `backend/src/modules/planning/`, `database/src/schema/process.ts`, `database/src/schema/planning.ts` (migrations 0027–0029), `frontend/src/app/(app)/process/`, `frontend/src/app/(app)/planning/`, batch panel in `frontend/src/app/(app)/manufacturing/work-orders/[id]/batch.tsx` |
| **Tests** | `backend/test/unit/formula-math.test.ts`, `backend/test/unit/mrp-engine.test.ts`, `backend/test/e2e/process.e2e.test.ts`, `backend/test/e2e/process-ops.e2e.test.ts`, `backend/test/e2e/planning.e2e.test.ts`; benchmark `backend/scripts/mrp-bench.mjs` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **7.1** ✅ | Master formula (percent / fixed / potency basis, tolerances, co-products and by-products, stages with in-process parameters, versions and approval, cost roll-up, scaling); process batches as work orders made from a formula; dispensing with tolerance and potency adjustment; stage readings; theoretical vs actual yield |
| **7.2** ✅ | Co-product cost apportionment at receipt, packing bulk into pack sizes (packing formulas), blending of batches, shade correction, equipment status and cleaning logs |
| **7.3** ✅ | Demand planning (statistical forecast with seasonality), MRP: multi-level net requirements, lead-time offsetting, lot sizing (L4L, fixed, EOQ, min / max, period), safety stock, planned orders → requisitions / work orders / batches, pegging, exception messages |
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

## 3. Co-products, packing, blending, corrections, cleaning (7.2)

- **Co-products at receipt**: co-product lines are received with the main output, and the batch's cost is shared out.
  - At standard: the main output is valued at its standard cost, and the batch pool is grossed up by the co-products' share (`main ÷ (1 − share)`).
  - At actual: the pool is the WIP taken, and the main output keeps `(1 − share)` of it.
  - Each co-product gets `share × pool`. WIP is cleared accordingly, and a batch at standard closes with no variance when the actuals match.
- **Packing**: a packing formula (kind *packing*) turns bulk plus packaging into a pack SKU, so a packing order is a batch of the pack item.
  - `GET /process/packing/options?bulkItemId` lists the pack sizes and the bulk per pack.
  - `POST /process/packing {bulkItemId, batchNo, lines: [{formulaId, packs}]}` checks the bulk is in stock, then creates draft packing orders that carry the bulk lot number.
- **Blends** (doc type `blend`, `BLD/{FY}/{SEQ}`): lots of one batch-tracked item are combined into a new lot.
  - The new lot is valued at the cost of the lots that went in, so the books do not move. It takes the earliest expiry of its lots unless one is given.
  - Traceability treats a blend as a transformation: backward from the new lot to its lots, forward from a lot into the blend.
- **Corrections** (`POST /process/batches/:id/correction`): an addition outside the formula (shade, viscosity, pH).
  - The item is added to the batch's materials and issued, and the dispensing record shows the reason and the checker.
  - Only while the batch is in process.
- **Process equipment**: machines flagged *must be cleaned before each batch*.
  - Starting a job card on one refuses if it is *in use* or *not cleaned*, and asks for a *product-change* clean when the last product differs.
  - Starting marks it in use (with the product); stopping marks it dirty.
  - Cleanings (`POST /process/equipment/:id/clean`) record the kind (minor, major, product change), who cleaned, who verified, and the swab or rinse result.

## 4. Demand forecast (7.3)

- **History**: approved and completed sales order lines (base units), by the month of the order, up to the last complete month. A product launched inside the window is learnt from its first month with orders.
- **Methods** (`planning/forecast.ts`):
  - moving average (3 months), simple exponential smoothing, Holt's linear trend;
  - with 12+ months, seasonal naive (same month last year);
  - with 24+ months, additive Holt-Winters (12-month season).
- **Choice**: walk-forward backtest on the last 3 to 6 months. The method with the lowest mean absolute error wins; its MAE and MAPE are stored with the forecast. Forecasts are never negative.
- **Storage**: `demand_forecasts`, one row per item and month.
  - `qty` is what MRP uses and `stat_qty` is the statistical figure.
  - A planner's override sets `is_override`. Re-forecasting refreshes `stat_qty` but keeps the override; clearing the cell resets it. Past months cannot be changed.
- **API**: `POST /planning/forecasts/generate {horizon, historyMonths, itemId?}`, `GET /planning/forecasts`, `PUT /planning/forecasts {itemId, period, qty | null}`.

## 5. MRP (7.3)

- **Item parameters**: lead time, safety stock and MOQ stay on the item. `item_planning` adds the following:
  - *source*: automatic (make when the item has an approved default BOM, else batch when it has a formula, else buy), make, or buy;
  - *lot sizing*: lot for lot, fixed lot, EOQ (from the item's gross demand over the horizon, annualised, the cost per order, the standard or last purchase cost, and a holding % defaulting to 20), min / max (order up to the max when below safety stock), or period (cover the next *n* days);
  - *excluded*: leave the item out of MRP.
- **Demand**:
  - open approved sales order lines on their delivery date. An overdue order moves to today and is reported as a *late order*.
  - the forecast, from the current month to the end of the horizon, on the 1st of each month (today for the current month), less the open orders due in that month (forecast consumption);
  - materials still to issue on open work orders, at their planned start.
- **Supply**:
  - stock in nettable warehouses;
  - open approved purchase orders;
  - requisitions that are not cancelled or fully ordered, drafts included, so converted planned orders are not planned twice;
  - open work orders (batches at qty × yield);
  - firmed planned orders, whose components also count as demand.
- **Engine** (`planning/mrp-engine.ts`, pure). Items are taken in low-level-code order (Kahn's topological sort over BOMs and formulas). Structure loops are reported and those items are not exploded. For each item, by date:
  1. Receipts come in and demand goes out.
  2. When the projected balance falls below safety stock, later receipts are pulled in first (*bring forward*).
  3. Only then is a planned order created, due that day. Its release is the due date less the lead time; a release in the past becomes today and is flagged *expedite*.
  4. The quantity follows the lot rule, then the MOQ, then the multiple (a formula's batch multiple × yield).
  5. A make or batch order adds dependent demand to its components at its release date: quantity per unit from the BOM (scrap included, alternates by priority) or from the formula (per batch unit ÷ yield).
- **Pegging**: each planned order records what it covers (sales order, forecast month, parent planned order, safety stock or lot rounding), with links in the UI.
- **Exception messages**: expedite, past due (a receipt dated before today), late order, bring forward, push out (the receipt is not needed until later), cancel (not needed within the horizon), below safety stock, no BOM / formula, structure loop.
- **A run** (`POST /planning/mrp/runs {horizonDays, useForecast}`) is one transaction under an advisory lock.
  - It replaces every *planned* order; firmed and converted ones stay.
  - It stores the exceptions and the time-phased record of each item (`mrp_item_plans`, shown at `/planning/items/:id`).
  - The last ten runs are kept.
- **Planned orders** (`/planning/planned-orders`):
  - *firm* or *unfirm* them; editing the quantity or due date firms the order;
  - *convert* them. Buys become one draft purchase requisition (needs `purchase.requisitions.manage`). Makes become draft MTS work orders and batches become draft process batches at output ÷ yield, rounded to the batch multiple (both need `manufacturing.production.manage`).
  - Converted orders link to their document.
- **Performance** (`node backend/scripts/mrp-bench.mjs`): 10,000 items in three levels (2,000 → 1,000 → 7,000), 3,000 BOMs, four months of forecast, giving 28,021 planned orders and 17,000 exceptions in about 12 s end to end. Loading takes 0.1 s, planning 0.24 s, and writing the results 11 s. The target was under 2 minutes.

## Permissions

Formulas use `manufacturing.engineering.*`. Batches and dispensing use `manufacturing.production.*`. Stage readings come in with job cards (`manufacturing.shopfloor.record`).

Forecasts and MRP use `planning.mrp.read` and `planning.mrp.manage`. Converting planned orders also needs the right to raise the documents it creates.
