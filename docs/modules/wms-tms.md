# Module spec: warehouse and logistics (WMS / TMS) (Phase 11)

| | |
|---|---|
| **Status** | In progress: 11.1–11.2 done |
| **Code** | `backend/src/modules/wms/`, `backend/src/modules/tms/`, `backend/src/modules/inventory/bins.ts`, `database/src/schema/wms.ts`, `tms.ts`, `frontend/src/app/(app)/wms/`, `tms/` |

## Approach

Stock stays valued and checked per item, warehouse and batch, as in Phase 2. WMS adds a **bin sub-ledger** under that, for the warehouses where WMS is switched on.

- `StockService.post()` and `reverseVoucher()` are still the only code that changes stock. For a WMS warehouse they also move bin stock in the same transaction, so the bins of a warehouse always add up to its stock.
- Incoming stock goes to the bin named on the move, otherwise to the warehouse's receiving bin. Put-away then moves it to storage.
- Outgoing stock comes from the bin named, otherwise from the dispatch bin (goods already picked), then from storage bins in pick order.
- Moves between bins of one warehouse change only bin stock. They have no value effect, so they need no voucher.

Warehouses without WMS work exactly as before.

## Sprint plan

| Sprint | Scope |
|---|---|
| 11.1 | **Locations and bin stock**: zones (storage condition: ambient, cold, frozen, hazardous, quarantine, bonded) and bins (aisle / rack / shelf / position, type, weight / volume / quantity capacity, pick sequence, fixed item, blocked); item storage profiles (condition, UN hazard class, unit weight and volume, ABC class); switching WMS on for a warehouse; bin stock kept by the stock posting; bin-to-bin moves; put-away rules (fixed bin, consolidate, condition, hazard compatibility, ABC, nearest empty) with put-away tasks confirmed by scan; bin labels (QR); utilisation heat map; mobile scan screen |
| 11.2 | **Inbound and outbound**: dock appointments; receiving by scan; cross-docking to dispatch; pick lists and waves from sales orders (single, batch and zone picking), FEFO with minimum remaining shelf life at dispatch, pick path by walking sequence; pack station with cartons and GS1 SSCC labels; dispatch loading check |
| 11.3 | **Inventory control and special stock**: ABC cycle counts by bin; min / max replenishment of pick bins from reserve; slotting suggestions by velocity; tanks and silos (dip readings with calibration charts); returnable packaging (drums, bins, pallets, crates) with balances per customer / vendor; MSL floor-life timers; reels; consignment stock |
| 11.4 | **Logistics (TMS-lite)**: transporters and rate contracts (per kg, per trip, per km by lane and vehicle type), freight calculation, vehicles, trip sheets with stops, delivery tracking (status and GPS pings), proof-of-delivery (photo, signature, name), freight invoice reconciliation |
| 11.5 | **3PL and AI**: client-owned stock in shared warehouses, storage (pallet-days) and handling billing; AI: demand-driven replenishment, slotting and pick-path optimisation reports; offline scan queue for handhelds; RFID gate-read ingestion (pilot) |

Not planned: photo damage detection (pilot only, needs a vision model), FASTag tracking APIs (needs a commercial provider; the tracking endpoint takes positions from any source).

Exit target: picking productivity up 25 % at a pilot; inventory accuracy 99.5 % after two cycle counts.

## 11.1 Locations and bin stock (done)

Schema: `database/src/schema/wms.ts`, migration 0045. Code: `backend/src/modules/inventory/bins.ts` (the bin sub-ledger, called by `StockService`), `backend/src/modules/wms/` (`putaway.ts` holds the rules, pure and unit tested). Pages: `/wms`, `/wms/bins`, `/wms/tasks`, `/wms/scan`, `/wms/heatmap`, `/wms/items`, `/print/bin-labels`. Permissions: `wms.setup.manage` and `wms.tasks.execute`; lookups need `inventory.stock.read`.

**Switching bins on** (`POST /wms/warehouses/:id/enable`)
- The warehouse must not allow negative stock.
- Creates the RECV (receiving) and DISP (dispatch) zones and bins, and moves the current stock into RECV.
- It cannot be switched off afterwards.

**Bin stock**
- `wms_bin_stock` holds quantity per bin, item and batch. `wms_bin_ledger` records every bin movement: posting, reversal, move, put-away, enable.
- `StockMove.binId` lets a posting name a bin. Without one:
  - receipts go to RECV;
  - issues are taken from DISP first, then storage bins in pick order. Quarantine-zone bins, blocked bins and RECV are used last.
- Cancelling a voucher undoes whatever it still nets per bin. Issues go back to the bin they came from; receipts are taken out wherever they now are, their own bin first. Running the reversal again changes nothing.
- `GET /wms/warehouses/:id/reconcile` lists any item and batch where bins and warehouse stock differ. The e2e test checks it stays empty.

**Locations**
- Zones have a use (storage, receiving, dispatch, staging, quarantine) and a storage condition (ambient, cold, frozen, hazardous, quarantine, bonded).
- Bins have:
  - a code: aisle-rack-shelf(-position), e.g. A-01-1;
  - a type;
  - optional limits on weight, volume and quantity (a quantity limit makes it a single-item bin);
  - a pick sequence (walking order);
  - an optional fixed item, and a blocked flag with a reason.
- "Create a block" generates aisles × racks × shelves (× positions) with a serpentine pick sequence: up one aisle, down the next.
- A bin that holds stock cannot be made inactive.

**Item storage profile**: storage condition, UN hazard class, weight and volume per unit, ABC class, and the least shelf life accepted at dispatch (used in 11.2).

**Put-away rules** (`suggestPutaway`)
- A bin qualifies only if:
  - its zone has the item's condition (a hazard class means hazardous storage);
  - lots on QC hold go to a quarantine zone, if there is one;
  - it is not another item's fixed bin;
  - it holds no hazard class that must be kept apart (simplified IMDG / OISD segregation: explosives apart from everything; oxidisers and peroxides apart from flammables and corrosives; water-reactives apart from corrosives; toxic gases apart from flammables and oxidisers);
  - it has room by weight, volume and quantity. Quantities already planned into a bin by open tasks count as used.
- Preference order: the fixed bin; a bin holding the same batch; a bin holding the same item; an empty bin (nearest the dock, or farthest for C items); then a shared bin with room.
- A quantity that does not fit in one bin is split. Whatever fits nowhere becomes a task with no bin, for the operator to choose.

**Tasks** (WT000001…)
- "Plan put-away" creates tasks for everything in RECV not already planned.
- A task is confirmed by scanning the bin actually used. Any suitable bin is accepted; the suggested one is kept for comparison.
- Unsuitable bins are refused. Overfilling needs a reason.
- Confirming a smaller quantity leaves the rest in RECV for the next plan.
- Bin-to-bin moves (`POST /wms/moves`) follow the same checks and need no voucher, since they don't change value.

**Screens**
- Scan: type or scan a bin to see its contents and move them; or look up where an item is.
- Heat map: per aisle, how full each bin is or how many moves it had in 30 days.
- Bin labels: 75 × 50 mm with a QR code of the bin code.

Not yet: naming a bin on GRN or stock entry lines from the screens. The API supports `binId` on postings; receipts land in RECV and are put away.

## 11.2 Inbound and outbound (done)

Schema: added to `database/src/schema/wms.ts`, migration 0046. Code: `backend/src/modules/wms/flow.service.ts`, `outbound.ts` (SSCC and pick allocation, pure and unit tested). Pages: `/wms/docks`, `/wms/receiving`, `/wms/waves`, `/wms/waves/[id]`, `/wms/loading`, `/print/sscc/[id]`; GS1 settings are on `/wms`.

**Docks**
- Doors are for unloading, loading or both.
- Appointments (DA000001…) book a door for a time slot. A slot that overlaps a live booking on the same door is refused, and so is a door used in the wrong direction.
- Status goes booked → arrived → in progress → done, or no-show / cancelled.

**Scanning**: `GET /wms/warehouses/:id/resolve?code=` says what a scanned code is: a bin code, a carton SSCC (with or without the (00) prefix), an item barcode or an item code.

**Receiving by scan**
- Pick an approved purchase order with something pending, then scan each unit or type counts, with batch and dates for batch items.
- "Make the GRN" creates a draft GRN through the normal purchase flow (permission `purchase.receipts.manage`); a linked dock appointment moves to in progress.
- When the GRN is submitted, the goods land in RECV.

**Cross-docking**: when put-away is planned, the quantity that open sales orders still need, beyond the stock already in storage and dispatch, goes straight to DISP. Lots on QC hold are never cross-docked.

**Waves and picking**
- `/wms/warehouses/:id/pickable` lists approved, open orders shipping from this warehouse (or with none set) that still have something to deliver and are not already in a live wave.
- A wave (WV00001…) takes one or more orders. Each order line's open quantity counts what has been delivered and what is on draft delivery notes, and is converted to base units.
- Allocation (`allocate`):
  - first expiry first out, then walking order;
  - only storage and staging bins;
  - skips blocked bins, lots on QC hold, expired lots, and lots with less remaining shelf life than the item's minimum (storage profile);
  - quantities already promised to other open picks are respected.
  - Shortfalls are saved on the wave with the reason, e.g. "40 below the minimum shelf life".
- Modes:
  - order: order by order;
  - batch: one walk for all orders, sorted by bin;
  - zone: grouped by zone, and a zone's picks can be assigned to one picker.
  - The task's path number follows that order.
- A pick is confirmed by scanning the bin taken from (another bin with the stock also works) and the quantity taken; a smaller quantity records a short pick. The goods move to DISP. When no pick is open, the wave becomes "picked".
- Picks cannot be confirmed through the put-away screen.

**Packing**
- Cartons and pallets (`wms_packages`) are opened per order. Each gets an 18-digit SSCC: extension digit + GS1 company prefix + serial + GS1 mod-10 check digit. A prefix must be set first.
- Items are added up to what was picked for the order and not yet packed, filled batch by batch. A carton is then closed with its gross weight.
- The logistic label (100 × 150 mm) shows from / to, order and customer PO, carton n of m, the contents with batches and expiry, and the SSCC as GS1-128.

**Delivery notes from a wave**
- When the wave is picked and every carton is closed, "Make delivery notes" creates one draft delivery note per order. Its lines carry exactly the batches and quantities picked, converted back to the order unit, with the carton count and weight.
- Submitting the delivery note issues the stock from DISP, where the picks are.

**Loading check**
- Scan each carton of a delivery onto the vehicle. Cartons of another delivery, open cartons and cartons already loaded are refused.
- The screen shows how many are still to load.
