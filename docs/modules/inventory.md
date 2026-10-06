# Module spec: Masters & Inventory (Phase 2 · Sprints 2.1–2.3)

| | |
|---|---|
| **Status** | Phase 2 done, 5 Oct 2026: 2.1 masters, 2.2 inventory core, 2.3 imports / Tally / labels / physical count / PR item links |
| **Code** | `backend/src/modules/{masters,inventory,imports}/`, `database/src/schema/{masters,inventory}.ts`, `frontend/src/app/(app)/{masters,inventory}/` |
| **Tests** | `backend/test/unit/{valuation,imports}.test.ts`, `backend/test/e2e/{masters,inventory,imports,stock-counts}.e2e.test.ts`, `database/test/rls.test.ts` (ledger is append-only) |

## 1. Masters (Sprint 2.1)

- **Items**: auto codes (`ITM00001`), base / purchase / sales units with per-item conversions (1 BAG = 25 KG), barcodes, HSN + GST rate (incl. 40% slab), stock behaviour (batch, serial, expiry + shelf life, valuation method), reorder level / qty, industry attributes (JSON), custom fields.
- **Parties**: customers and vendors in one master (`CUS…` / `VEN…`), GSTIN with checksum validation (PAN derived), multiple addresses, contacts, encrypted bank accounts, MSME.
- **Setup**: units (with GST UQC), item groups (tree), warehouses (type, nettable, allow negative stock), price lists.
- New workspaces get default units, groups RM/PM/CON/SPR/SFG/FG/SRV and warehouses MAIN + QC (QC is not nettable).

## 2. Data model (Sprint 2.2)

```
stock_entries (1:1 with documents, doc type "stock_entry", series SE/{BRANCH}/{FY}/{SEQ})
  └── stock_entry_lines (qty in line unit, conversion factor, base qty, batch, serials)
stock_ledger      append-only, one row per item movement (app role has no UPDATE/DELETE)
stock_valuation   pool per item + warehouse: qty, value, FIFO cost layers. Locked FOR UPDATE while posting
stock_balances    qty per item + warehouse + batch (nil UUID = no batch). Used for availability
batches           per item; expiry = given date or mfg date + shelf life
serial_numbers    status in_stock / consumed / delivered / scrapped + current warehouse
```

## 3. Posting rules

`StockService.post()` is the only code that changes stock. It runs inside the document's transaction, so a failure rolls back the whole approval.

1. Pools are locked in sorted (item, warehouse) order to avoid deadlocks.
2. Item must be an active stock item; whole-number units reject fractions; batch / serial rules enforced.
3. **Availability** is checked per batch bucket unless the warehouse allows negative stock.
4. **Expired batches** can't be issued. They can leave only through an adjustment or a transfer to a scrap / rejected store.
5. **Valuation** (`valuation.ts`, exact decimals):
   - *Weighted average*: issues at value ÷ qty. The last unit out takes the remaining paise, so an empty pool always has value 0.
   - *FIFO*: receipts form layers and issues consume the oldest first.
   - Incoming stock with no rate uses the current valuation rate, then the item's standard cost.
6. Every movement writes a ledger row with the running position (balance qty / value / rate) for that item + warehouse.

| Purpose | Moves | Rate |
|---|---|---|
| Opening stock | + into target | required |
| Material receipt | + into target | optional (defaults to current rate) |
| Material issue | − from source | stock cost |
| Transfer | − source, + target at the same cost | stock cost |
| Adjustment | ± in one warehouse (reason required) | optional for +; stock cost for − |

**Cancellation** reverses each ledger row at its original value (FIFO layers are restored). If the stock a receipt brought in has already been used, the cancel is blocked with 409. Posted stock entries can't be amended: cancel and re-create instead.

**Document hooks**: `DocumentsService.registerHooks(docType, { onApproved, onCancelled, amendable })`. Later vouchers (GRN, delivery note, production) will plug into the same mechanism.

## 4. API

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/inventory/stock-entries` | `inventory.stock.read` / `inventory.entries.manage` |
| GET/PUT/DELETE | `/inventory/stock-entries/:id` | read / manage |
| POST | `/inventory/stock-entries/:id/submit` | manage |
| POST | `/inventory/stock-entries/:id/cancel` | `inventory.entries.cancel` |
| GET | `/inventory/stock` (levels, reorder flags, totals) | read |
| GET | `/inventory/stock/:itemId` (by warehouse, by batch) | read |
| GET | `/inventory/ledger` (item, warehouse, voucher, date filters; cursor) | read |
| GET | `/inventory/batches?itemId&warehouseId` (FEFO order) | read |
| GET | `/inventory/batches/expiring?days=30` | read |
| GET | `/inventory/valuation` (by warehouse, by group) | read |

## 5. Imports (Sprint 2.3)

`/imports/{items|parties|opening-stock}/{preview|commit}` (multipart .xlsx / .csv) and `/imports/tally/{preview|commit}` (.xml). Templates: `GET /imports/:entity/template?format=xlsx|csv`.

- **Preview is a dry run**: the import runs for real inside a transaction that is then rolled back, so the preview applies exactly the same validation as saving (unique codes, GSTIN checksum, units, batches...). Each row runs in a savepoint, so one bad row doesn't stop the others.
- **Commit** repeats the run and keeps it only when there are no errors, or when `skipInvalid=true` (rows with errors are left out).
- **Idempotent**: existing records are reported as *skipped*: items match on code or exact name, parties on code or GSTIN. Re-uploading a corrected file only adds what's new.
- **Headers** are matched by label or common aliases ("Item Name", "UOM", "HSN/SAC", "GST %", "Kgs"...). Unknown columns are listed as ignored. The template's example row is skipped automatically.
- **Values**: Indian number formats (1,23,456.50, ₹), day-first dates (31-03-2026, 1-Apr-26, Excel serials), Yes/No, state names or GST codes.
- **Opening stock** creates one opening stock entry per warehouse (500 lines each), as drafts or posted (`post=true`).
- **Tally** (ERP 9 / TallyPrime "Export → Masters → XML", UTF-8 or UTF-16), imported in order: units → stock groups (≤3 levels) → godowns → stock items → Sundry Debtor/Creditor ledgers → opening stock per godown and batch.
  - GST rate and HSN come from the item, or are inherited from its stock group. `defaultGstRate` fills in the rest.
  - The item alias becomes the item code.
  - Alternate units become conversions: `DENOMINATOR` base units = `CONVERSION` alternate units. Check the result in the preview.
  - Other ledgers wait for accounting (Phase 4).

## 6. Physical stock count (Sprint 2.3)

Doc type `stock_count` (`PSC/{BRANCH}/{FY}/{SEQ}`), tables `stock_counts` + `stock_count_lines`.

1. **Create** for a warehouse, optionally one item group (with its sub-groups). Lines are snapshotted from `stock_balances` per item and batch. Options:
   - *Include items with no stock*, to find stock that was never recorded.
   - *Blind*: book quantities are hidden while counting.
   - Serialised items are excluded; adjust them with a stock entry instead.
2. **Count**: `POST /stock-counts/:id/counts` saves quantities line by line with no document version, so several counters can work at once. `POST /:id/lines` adds stock that was found but isn't on the sheet (a new batch or another item). The UI supports scan-to-find and Enter-to-next-line. There is a printable count sheet.
3. **Submit**: the document amount is the estimated absolute variance value, so approval rules can send large differences to a manager.
4. **Approval posts**: for each counted line, the posted difference is the counted quantity minus the book quantity **at approval**. Movements made after the sheet was printed are therefore not double-counted. Shortages are written off at stock cost; excess comes in at the current valuation rate. Uncounted lines are ignored. Cancelling reverses the posting.

## 7. Labels and PR item links (Sprint 2.3)

- `/print/labels` renders barcode or QR labels in the browser (bwip-js). It supports thermal rolls (50×25, 38×25, 75×50 mm) and A4 sheets (24-up, 65-up).
  - The barcode is the item's primary barcode (EAN-13 when valid), else the item code. The QR code carries `code|batch|expiry`.
  - Opened from an item (`?items=`) or from a posted receipt (`?entry=`: one label per unit received, up to 100).
- Purchase requisition lines can link to the item master (`itemId`, `uomId`). The server fills in the item code and unit code, and accepts only the item's base unit or a converted unit. Free-text lines remain for one-off purchases.

## 8. Known limits / next

- **Back-dated entries**: running balances follow posting order, not posting date. Before stock reports must be correct for any back date, add date-ordered reposting (Phase 4, with the accounting period lock).
- **Accounting**: stock postings don't create GL entries yet (Phase 4).
- **Imports** add new records only. Bulk *updates* of existing items (prices, reorder levels) via import are not supported yet.
- **Stock counts** don't cover serialised items yet.
