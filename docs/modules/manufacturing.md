# Module spec: Discrete Manufacturing (Phase 5)

| | |
|---|---|
| **Status** | Sprints 5.1–5.3 (7 Oct 2026) done: engineering data; work orders, shop floor and production costing; traceability and QC ([quality.md](quality.md)) |
| **Code** | `backend/src/modules/manufacturing/`, `database/src/schema/manufacturing.ts` (migrations 0020, 0021), `frontend/src/app/(app)/manufacturing/` |
| **Tests** | `backend/test/unit/bom-math.test.ts`, `backend/test/unit/production-math.test.ts`, `backend/test/e2e/manufacturing.e2e.test.ts`, `backend/test/e2e/production.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **5.1** ✅ | Work centres (capacity, hourly labour / machine / overhead rates) · machines · moulds, dies and tools with shot life · multi-level BOM with phantoms, alternates, scrap %, by-products · routing with operations and job-work steps · versions with effectivity and approval · explosion · standard cost roll-up · where-used |
| **5.2** ✅ | Work orders (MTS, MTO from sales orders, rework), release with availability check and reservation, material issue and backflush, job cards per operation, production receipt with scrap / by-products, WIP and actual costing with variances posted to the ledger |
| **5.3** ✅ | Lot / serial genealogy and as-built BOM; inspection plans (parameters, AQL sampling); incoming, in-process and final QC with accept / reject / rework. Spec: [quality.md](quality.md) |
| 5.4 | Tablet shop-floor screens, barcode-driven job cards, offline PWA, scrap-trend insights |

## 1. Resources

- **Work centres** (`work_centers`). Each has:
  - kind: machine, line, manual or sub-contract;
  - hours per day and units in parallel, which give daily capacity;
  - efficiency %;
  - cost per hour for labour, machine and overhead, which routing costs use;
  - optionally, a shop-floor store for WIP.
- **Machines** belong to a work centre: make, model, serial, capacity.
- **Tools** are moulds, dies, fixtures and gauges:
  - cavities;
  - expected life in shots;
  - shots used (production will count them in 5.2);
  - service interval, flagged when maintenance is due;
  - the machine the tool is fitted to.

  *Maintained* restarts the service counter.

## 2. Bill of materials (doc type `bom`, `BOM/{SEQ}`)

- Each BOM is for one item, per a quantity (e.g. per 100). It records drawing number and revision.
- Lines are components, by-products or scrap, each in the component's base unit.
  - **scrap %** is the extra quantity of the component consumed.
  - **phantom**: a never-stocked assembly. Its own BOM is exploded in place, and it must have an approved BOM.
  - **alternate group + priority**: only the first alternate counts for requirements and cost.
  - **operation**: where the component is issued (for backflushing).
  - **recovery rate** (by-products / scrap): value credited per unit.
- Routing: operation sequence, work centre, optional tool, setup minutes per batch, run minutes per unit, in-process inspection flag. A **job-work** step needs the job worker and a rate per unit.
- **Lifecycle**:
  - A draft is approved through the document workflow (approval rules apply). Approved BOMs are frozen.
  - **New version** copies a BOM into a draft (`version + 1`, `previous_version_id`).
  - When a default version is approved, the previous default is closed (`effective_to` = the day before) and the new one starts `effective_from` (default: the approval date).
  - Circular structures are refused on submission. An item cannot be its own component.
- **Explosion** (`GET /manufacturing/boms/:id/explode?qty&levels=single|all`):
  - Requirement = line qty ÷ BOM qty × quantity × (1 + scrap %).
  - *single* explodes phantoms only, giving what is issued.
  - *all* walks every sub-assembly that has a default BOM (indented BOM).
- **Cost roll-up** (`POST /manufacturing/boms/:id/cost {apply}`), per unit, bottom-up:
  - **Materials**: sub-assemblies at their own rolled-up cost; purchased items at standard cost, else average stock cost, else last purchase rate.
  - **Operations**: (setup ÷ BOM qty + run) minutes × the work centre's rates.
  - **Job work**: the job-work rate.
  - **Less**: by-product recoveries.

  The cost is stored on the BOM. `apply` writes it to the item's standard cost; this is refused while any component has no cost.
- **Where used** (`GET /manufacturing/boms/where-used/:itemId`).

## 3. Work orders (doc type `work_order`, `WO/{FY}/{SEQ}`)

- **Kinds**:
  - *make to stock*;
  - *make to order*: linked to a sales order line. **Make to order** on an approved sales order (`POST /manufacturing/work-orders/from-sales-order/:id`) drafts one order per open line whose item has an approved BOM. It skips lines that are already planned.
  - *rework*: issues the item itself, usually from the rejected store. A BOM is optional and only lends its routing. It is costed at actual.
- **On creation**, the BOM (the default version unless one is chosen) is copied onto the order:
  - **Materials**: component requirements with scrap, phantoms exploded in place, the first alternate only, and the operation each is issued at. Expected by-products and scrap are copied too.
  - **Operations**: planned minutes = setup + run × quantity. Job-work steps keep their job worker and rate.
- **Release** = submit (approval rules apply):
  - The availability check compares outstanding components with stock in the source store, less what other open orders have **reserved** (their unissued requirements). `GET …/availability` shows it.
  - Shortages refuse the release unless `force` is sent. The shortages are then recorded on the order.
  - On approval the **standard cost** is fixed for variance analysis: from the BOM roll-up, with the item's standard cost as the unit cost when one is set. Each material also gets a standard rate.
- **Stages**: planned → released → in progress (first booking) → completed (made ≥ ordered) → closed.
  - Cancelling is only possible while nothing has been booked. After that the order is closed instead.

## 4. Shop floor: job cards

- A job card is one sitting at an operation: operator, machine and tool, start and stop, good and rejected quantities (rejects need a reason).
  - `POST /manufacturing/job-cards/start` and `…/:id/stop`.
  - `POST /manufacturing/job-cards` books a finished sitting in one go.
- **Time**: minutes are the time between start and stop unless given. They are costed at the work centre's labour, machine and overhead rates.
- **Job-work operations**: no time; charge = (good + rejected) × the job-work rate. The card can reference the job-work challan the goods went out on.
- **Tools**: shots = ⌈pieces ÷ cavities⌉, added to the tool's count (which drives the maintenance and life flags).
- **Flow**:
  - An operation cannot book more than the previous operation passed as good.
  - The first operation cannot book more than the order quantity + 10%.
  - An operation is done once good + rejected reach the order quantity.
- The **shop-floor board** (`GET /manufacturing/shop-floor`) lists open operations of released orders, most urgent first, with running cards. Filter by work centre.

## 5. Production entries (doc type `production_entry`, `PE/{FY}/{SEQ}`)

Each entry is posted the moment it is made; mistakes are corrected with further entries.

| Entry | Stock | Ledger |
|---|---|---|
| **Issue** (`…/issue`, lines or `all` outstanding) | out of the source store at valuation; batch items without a batch take FEFO batches; serial items need serials | Dr WIP, Cr stock |
| **Return** (`…/return`, up to what was issued) | back into the source store | Dr stock, Cr WIP |
| **Receipt** (`…/receive`) | backflushed materials out; by-products / scrap in at recovery rates; good output into the target store; rejects into a chosen store, or scrapped | stock net against WIP; time absorbed Dr WIP / Cr *labour and overheads absorbed*; job work Dr WIP / Cr *job-work charges accrued* |
| **Close** (`…/close`) | none | absorbs what is left; WIP balance → *production variances* |

- **Backflush** (orders flagged *backflush*): at each receipt, components are issued up to their standard for everything made so far (good + rejected), never taking back over-issues.
- **Output value**:
  - At the standard unit cost.
  - Without one (rework, or an uncosted BOM), at actual: the WIP balance spread over what is still to come, or all of it on the receipt that finishes the order.
  - Stocked rejects carry the same unit value.
- **Limits**: a receipt cannot exceed what passed the last operation. Output cannot run more than 10% over the order.
- **Closing**: running job cards must be stopped first. The document becomes *completed* and nothing more can be booked.
- **New system accounts** are added to existing charts automatically: `5120 Work in progress` (`wip`), `7500 Production variances` (`production_variance`) and `7600 Labour and overheads absorbed` (`production_absorbed`).

## 6. Costing and variances (`GET …/costing`)

For what has been made, actual against standard (positive = adverse):

- **Material usage**: Σ (issued − standard quantity for the output) × standard rate.
- **Material price**: the rest of the material difference.
- **Conversion**: absorbed time against the standard operation cost.
- **Job work**: charges against the standard.
- **By-products**: standard recovery against what was actually recovered.
- **Other**: the standard unit cost differing from the BOM roll-up, and rounding.

The report also shows the WIP balance, time booked but not yet absorbed, and the actual cost per unit. Planned and actual minutes are shown per operation.

## Permissions

- `manufacturing.engineering.read`, `manufacturing.engineering.manage`.
- `manufacturing.production.read`: work orders, entries, costing, the board.
- `manufacturing.production.manage`: create, release, issue, receive, close.
- `manufacturing.shopfloor.record`: job cards.
