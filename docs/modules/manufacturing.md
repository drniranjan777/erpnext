# Module spec: Discrete Manufacturing (Phase 5)

| | |
|---|---|
| **Status** | Sprint 5.1 (7 Oct 2026) done: engineering data |
| **Code** | `backend/src/modules/manufacturing/`, `database/src/schema/manufacturing.ts` (migration 0020), `frontend/src/app/(app)/manufacturing/` |
| **Tests** | `backend/test/unit/bom-math.test.ts`, `backend/test/e2e/manufacturing.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **5.1** ✅ | Work centres (capacity, hourly labour / machine / overhead rates) · machines · moulds, dies and tools with shot life · multi-level BOM with phantoms, alternates, scrap %, by-products · routing with operations and job-work steps · versions with effectivity and approval · explosion · standard cost roll-up · where-used |
| 5.2 | Work orders (MTS, MTO from sales orders, rework), release with availability check and reservation, material issue and backflush, job cards per operation, production receipt with scrap / by-products, WIP and actual costing with variances posted to the ledger |
| 5.3 | Lot / serial genealogy and as-built BOM; inspection plans (parameters, AQL sampling); incoming, in-process and final QC with accept / reject / rework |
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

## Permissions

`manufacturing.engineering.read`, `manufacturing.engineering.manage`.
