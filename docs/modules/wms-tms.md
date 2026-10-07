# Module spec: warehouse and logistics (WMS / TMS) (Phase 11)

| | |
|---|---|
| **Status** | In progress: 11.1–11.4 done |
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

Stock entry lines take a `binId` (from 11.3); GRN lines do not, so receipts land in RECV and are put away.

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

## 11.3 Inventory control and special stock (done)

Schema: added to `database/src/schema/wms.ts` (migration 0047), plus `stock_entry_lines.bin_id`. Code: `backend/src/modules/wms/control.service.ts`, `control.ts` (ABC, tank volume, floor life, replenishment; pure and unit tested). Pages: `/wms/counts`, `/wms/counts/[id]`, `/wms/slotting`, `/wms/tanks`, `/wms/reels`, `/wms/returnables`, `/wms/consignments`.

**Bins on stock entries**: a stock entry line can name a bin, which the posting uses (the source bin for a transfer). Counts and tank dips post their differences this way.

**ABC classes** (`GET /wms/abc` previews, `POST` saves on the storage profiles)
- Value issued per item in the last 12 months. Transfers and reversed vouchers don't count.
- An item is A while the running total before it is under 80 % of the total, B under 95 %, otherwise C. The top item is always A; items never issued are C.

**Cycle counts** (BC00001…)
- A bin is due when it holds stock, isn't in an open count, and was last counted longer ago than the interval for the highest class it holds: A 30, B 90, C 180 days (`/wms/count-settings`).
- "Start a count" takes up to N due bins, A first and the longest-uncounted first. Ad hoc counts take chosen bins.
- Lines are snapshotted per bin, item and batch. A blind count hides book quantities until it is posted. Items found that the books don't show in a bin are added as lines (a new batch number is allowed).
- Posting needs every line counted. The difference against the bin's quantity at posting time is posted as one stock adjustment (reason "Bin count BC…"), each line to its bin.
- Posting stamps the bins as counted and records accuracy: the share of lines with no difference.

**Pick faces and replenishment**
- A bin with a fixed item can have a min and max (`PUT /wms/bins/:id/pick-face`).
- "Plan replenishment" creates replenish tasks when a face plus what is on its way is below min. It tops the face up to max from other bins, first expiry first then walking order, skipping quantities promised to other open tasks.
- The tasks are confirmed like put-aways.

**Slotting suggestions**: items ranked by outbound bin moves in 90 days. The top fifth, where an empty ambient storage bin is nearer the dock, are paired with that bin. A report only; nothing moves.

**Tanks and silos**
- A tank is a bulk bin holding one item, with a capacity, a dip-to-litres calibration chart (linear interpolation), the stock unit (litres, or kg via density) and a tolerance %.
- A dip records the litres, the measured quantity, the book quantity in the tank's bin, the variance and whether it is within tolerance.
- `POST /wms/tanks/:id/dips/adjust` (also needs `inventory.entries.manage`) posts the variance as an adjustment to the tank's bin. It is refused when the tank holds more than one batch.

**Returnable packaging**: types (drums, pallets, crates…) with a deposit amount. Movements are sent to a party (+) or returned by it (−); returning more than the party holds is refused. Balances per party and type show the deposit value and how long they have been out.

**Reels and floor life** (J-STD-033)
- A reel has an ID, part, batch, place, quantity and MSL level (from the item profile unless given).
- Floor life: level 2 is one year, 2a four weeks, 3 168 h, 4 72 h, 5 48 h, 5a 24 h; level 6 must be baked before use.
- Open starts the clock and seal stops it. Use takes parts, and the reel is marked empty at zero. Bake resets the clock and is allowed only when sealed.
- An expired reel cannot be opened or used until baked.

**Consignment**: a warehouse holds either a vendor's stock at our site or our stock at a customer. The statement shows what is held now and what was issued out of that warehouse in a period, with its value: what we pay the vendor for, or bill the customer for.

## 11.4 Logistics (TMS-lite) (done)

Schema: `database/src/schema/tms.ts`, migration 0048. Code: `backend/src/modules/tms/` (`freight.ts`: rate matching, freight, GPS trail distance; pure and unit tested). Pages: `/tms`, `/tms/trips/[id]`, `/tms/setup`, `/tms/freight`, and the public driver page `/driver`. Permissions: `tms.setup.manage`, `tms.trips.manage`, `tms.freight.manage`; viewing needs `sales.deliveries.read`.

**Masters**
- Transporters are vendors, with their GST transporter ID (defaults to the GSTIN).
- Vehicles have a registration (normalised), whether owned or hired, a type (407, 17ft, 32ft_sxl…), capacity, transporter and driver.
- Rate contracts (FRC0001…) have a validity period and lanes. A lane has:
  - from city / to city / to state, each blank for any;
  - a vehicle type (blank for any);
  - a basis: per kg, per trip or per km;
  - an optional minimum charge and an optional charge per extra drop.
- The most specific lane that fits wins: a city beats a state beats any, and a named vehicle type beats any.

**Trips** (TR000001…)
- A trip takes posted, undelivered delivery notes, in drop order, that are not on another live trip. A vehicle (or a typed number and type) can't be loaded above its capacity.
- Weight is the sum of the delivery notes' gross weights. Freight comes from the transporter's contract valid on the trip date. The lane runs from the warehouse's city and state to the last drop, with the vehicle type; per-km lanes need the planned km.
- Stops copy the customer and shipping address. Delivery notes without a vehicle number get the trip's.
- Status goes planned → dispatched (with the odometer start) → completed (every stop delivered or failed; odometer end not below start), or a planned trip is cancelled.
- Expenses (toll, fuel, loading…) can be added until the trip is billed.

**Driver link**
- Dispatching issues a link `/driver?t=<token>` (the token carries the workspace and is stored hashed). It can be sent on WhatsApp, and "New driver link" replaces it. The link stops working when the trip is completed.
- The page needs no login. It lists the drops with call buttons and shares the phone's position every 2 minutes while open.
- At each drop: arrived; delivered, with the receiver's name, signature, an optional photo (shrunk on the phone) and the location; or not delivered, with a reason.
- A delivery records proof of delivery on the delivery note (`deliveredAt`, and "Received by …" as the POD note).
- `/public/trips/:token/*` routes are public (CORS open). Staff and integrations use `/tms/trips/:id/positions` (for example a GPS or FASTag feed with an API key).

**Tracking**: the trip shows the last position (with a map link), the distance along the GPS trail (ignoring jumps faster than 150 km/h), and the odometer distance.

**Freight bills** (FB00001…)
- Pick the transporter's completed, unbilled trips and enter what their bill claims for each.
- The bill is checked against the contract freight plus that trip's expenses; the same transporter bill number cannot be entered twice.
- Someone other than the person who entered it approves the bill (a reason is needed if it is above the contract) or disputes it with a reason. A disputed bill frees its trips to be billed again.

Not built: route optimisation across drops, live map view, e-way bill Part-B vehicle update from the trip, and FASTag/telematics provider integrations (the positions endpoint takes their feed).
