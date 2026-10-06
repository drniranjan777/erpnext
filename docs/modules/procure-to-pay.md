# Module spec: Procure-to-Pay, Order-to-Cash & GST (Phase 3)

| | |
|---|---|
| **Status** | Sprints 3.1 (6 Oct 2026), 3.2 and 3.3 (7 Oct 2026) done: procure-to-pay and order-to-cash complete |
| **Code** | `backend/src/modules/{gst,purchase,sales}/`, `database/src/schema/{purchase,sales}.ts`, `frontend/src/app/(app)/{purchase,sales}/` |
| **Tests** | `backend/test/unit/{gst-engine,valuation}.test.ts`, `backend/test/e2e/{purchase,billing,sales}.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **3.1** ✅ | GST engine · company GSTIN editing · purchase order (goods / services, amend with revisions, tolerance, short-close) · GRN against PO (accept / reject, batches, serials) · requisition → PO · reorder list → requisition · PO and GRN print formats |
| **3.2** ✅ | Purchase invoice with 2-/3-way match (PO–GRN–invoice), ITC eligibility, RCM, TDS · purchase return & debit note · landed cost · MSME 45-day payment tracking · RFQ & comparative statement · vendor rating |
| **3.3** ✅ | Quotation · sales order (credit-limit / overdue check, reservation, ATP) · pick, pack & delivery note · tax invoice / bill of supply / export / SEZ · sales return & credit note · schemes and discount approval |
| 3.4 | e-Invoice (IRN via GSP sandbox, signed QR) · e-Way Bill · job work (ITC-04) · import PO & Bill of Entry · HSN summary · OCR purchase invoice → draft |

## 1. GST engine (`gst/gst-engine.ts`)

Pure functions, unit-tested for every scenario below.

- **Place of supply**:
  - Outward supplies: the ship-to state, or `96` for exports.
  - Inward supplies: our receiving state.
- **Inter-state** (IGST) when the supplier's state ≠ place of supply. SEZ and exports are always inter-state.
- **Intra-state** splits into CGST + SGST. In union territories without a legislature (04, 25, 26, 31, 35, 38, 97) the second component is UTGST.
- **No GST on the document** in these cases:
  - Composition supplier (bill of supply).
  - Unregistered supplier, unless reverse charge applies.
  - Imports: IGST is paid on the Bill of Entry.
  - Exports or SEZ supplies under LUT (zero-rated).
- **Reverse charge**: the tax is computed but not added to the supplier's total. It is shown as "GST we pay".
- **Rounding**: each tax component is rounded per line to the paise (half-up). The document total is rounded to the rupee, with the difference shown as round-off. Cess is supported.
- **Our state** comes from the branch GSTIN or state, else the company's (`pricing.ts → ownGstRegistration`). Companies can now add or change their GSTIN after signup (`PUT /org/companies/:id`). Without one, everything is treated as inter-state and the PO page warns about it.

## 2. Purchase order (doc type `purchase_order`, `PO/{BRANCH}/{FY}/{SEQ}`)

- **Vendor snapshot**: GSTIN, state, registration type and billing address are stored on the PO, so it prints the same after the master changes.
- **Lines**: item, unit (base or converted; whole-number units enforced), quantity, rate, discount %. HSN, GST rate and cess come from the item. Live GST preview via `POST /purchase/orders/preview-tax`.
- **Delivery warehouse** defaults to the company's MAIN store (goods POs).
- **Tolerance %**: how far GRNs may exceed the ordered quantity.
- **Amendment**: approved → draft revision n+1, with a snapshot in revisions. Lines keep their ids so receipts stay linked. A line with receipts can't change item or unit, can't drop below the received quantity, and can't be removed. The vendor can't change.
- **Cancel** is blocked once goods are received. **Short-close** (approved → completed) stops further receipts.
- **Status**: completed automatically when every line is fully received; back to approved if a GRN is cancelled (unless short-closed).
- **Requisition links**: PO lines can point at approved requisition lines. The requisition's `orderedQty` is recomputed from approved or completed POs on approval, amendment and cancellation, converted to the requisition line's unit.

## 3. Goods receipt (doc type `goods_receipt`, `GRN/{BRANCH}/{FY}/{SEQ}`)

- Only against an approved, open PO. Accepted quantity = received − rejected; a rejection needs a reason.
- A PO line can be split over several batches.
- **On approval**:
  1. The PO row is locked (no two GRNs can both use the tolerance).
  2. Tolerance is re-checked.
  3. Accepted stock is posted at the PO's **net rate** (after discount, before GST, since GST is recoverable input tax) per base unit.
  4. PO line received/rejected quantities are updated.
  5. `items.last_purchase_rate` is set.
  6. The PO status is synced.

  Service items record the receipt without stock movement.
- **Cancel** reverses the stock and the PO quantities. GRNs are not amendable.
- Header carries supplier invoice no./date, challan, gate entry, vehicle, transporter and LR, ready for the purchase invoice match in 3.2.

## 4. Replenishment

`POST /purchase/requisitions/from-reorder` drafts a requisition for every stock item where nettable stock plus quantity still to receive on approved POs is at or below the reorder level.

- **Quantity**: the larger of the shortfall and the reorder quantity, raised to the minimum order quantity if one is set.
- **Unit**: the item's purchase unit, rounded up for whole-number units.

`POST /purchase/orders/from-requisition` turns an approved requisition's outstanding item-linked lines into a draft PO for one vendor. The rate is taken from the requisition estimate, else the last purchase rate, else the standard cost.

## 5. Purchase invoice (doc type `purchase_invoice`, `PINV/{BRANCH}/{FY}/{SEQ}`)

- **Matching**:
  - Three-way: a line bills a posted GRN line, in its unit, for at most accepted − billed.
  - Two-way: a line bills a service PO line.
  - None: expense or non-stock items without an order.
  - Stock items must go through a GRN.

  The document's `matchType` is the weakest of its lines.
- **Rate variance**: per line, taxable value − quantity × the PO/GRN net rate. Above the tolerance (default 1%), submitting needs a `varianceNote`.
- **Duplicates**: the same vendor + supplier invoice number (case-insensitive) is refused unless the earlier bill is cancelled. Bill dates can't be in the future.
- **GST**: inward pricing as for the PO. Each line can be marked ITC-ineligible (s.17(5) blocked credits); totals are split into `itcEligibleTax` / `itcIneligibleTax`.
- **TDS** (`gst/tds.ts`): 194C, 194J, 194J(a), 194H, 194I(a/b), 194Q.
  - The rate depends on the 4th PAN letter (P/H = individual or HUF).
  - TDS is worked out on the value before GST and rounded to the rupee.
  - `netPayable` = bill total − TDS. The section defaults from the vendor and can be overridden, with a rate override for lower-deduction certificates.
- **Due date**: invoice date + credit days (bill → PO → vendor). For micro and small enterprises it is capped at 45 days (15 days if nothing was agreed), per MSMED s.15 and Income-tax s.43B(h). The list has "To pay" and "MSME dues" views with days to due or overdue.
- **On approval**:
  1. The lines being billed are locked and over-billing is re-checked.
  2. GRN and PO `billedQty` are updated.
  3. Stock is **revalued** by the rate variance plus GST that can't be claimed (value-only ledger rows, see below).
- **Cancel** is blocked while debit notes exist; it reverses billed quantities and the revaluation. Bills are not amendable.

## 6. Debit note (doc type `debit_note`, `DN/{FY}/{SEQ}`, GST document ≤ 16 chars)

- Raised against an approved bill, with the same GST treatment (vendor registration, place of supply, reverse charge).
- **Return**: quantity ≤ billed − returned, at the bill's net rate (can be lower). Stock leaves the receiving warehouse at its current valuation, and the bill line's `returnedQty` is updated.
- **Price adjustment**: a reduction per unit for up to the billed quantity. Stock still on hand is revalued down.
- The printed debit note shows the original invoice reference and amount in words.

## 7. Landed cost (doc type `landed_cost`)

- Charges (freight, customs duty, insurance, CHA, loading, octroi, other) are entered before GST, optionally with the charging vendor and bill reference.
- They are spread over the stock lines of one or more posted GRNs by value, quantity or net weight. Splits are exact to the paise, with the remainder on the last line.
- **On approval**: value is added to stock. Only the share still on hand is absorbed: amount × min(1, on hand ÷ quantity received). The rest is `unabsorbed` and goes to cost of goods consumed when accounting arrives (Phase 4).
- **Value-only stock movements**: `StockService.revalue()` writes ledger rows with qty 0. FIFO spreads the value over the layers per unit, and `reverseVoucher` undoes them.

## 8. Sourcing

- **RFQ** (doc type `rfq`):
  - Items with quantities in the purchase unit, plus invited vendors. Approval = issued.
  - **Email vendors** uses the vendor-facing notification event `purchase.rfq_sent`, hidden from user preferences.
  - Quotes are recorded per vendor: rate, discount, lead time, credit days, terms, other charges, validity.
- **Comparison**: net rate per line; lowest highlighted; vendor totals including other charges; terms; track record.
  - The suggestion scores price 70% (lowest ÷ offer), acceptance 20% and on-time delivery 10%. Vendors with no history count as 100.
- **Award**: per line. One draft PO per vendor, carrying the quote rate, discount, credit days and terms. The RFQ completes when every line is awarded.
- **Vendor performance** (`/purchase/vendor-performance`), per vendor:
  - orders and value;
  - acceptance % (accepted ÷ received over GRN lines);
  - on-time % (GRN date ≤ PO expected date) and average delay;
  - amount billed above PO rates;
  - score = 60% quality + 40% delivery.
- **Approved vendor list** (`item_vendors`): maintained on the item. A PO from a vendor not on a non-empty list shows a warning; it is not blocked. PO approval records the vendor's last net rate per base unit.

## Known limits

- Payments, vendor ledgers and GL postings (including TDS, input tax credit, reverse-charge liability and the unabsorbed landed cost) come with accounting in Phase 4. `paidAmount` is in place for that.
- Vendors can't yet submit quotes themselves through a portal link; quotes are entered by the buyer. Planned with the supplier portal (Phase 15).

## Order-to-cash (Sprint 3.3)

Code: `backend/src/modules/sales/`, schema `database/src/schema/sales.ts` (migrations 0011, 0012), pages under `frontend/src/app/(app)/sales/`, print at `/print/sales/[id]`.

### Pricing (`sales/common.ts → priceSelling`, `POST /sales/preview`)

- A blank rate takes the customer's price list (`parties.price_list_id`), else the default list, picking the largest quantity break the line reaches. Tax-inclusive lists are converted to the pre-GST rate.
- GST is outward: place of supply is the ship-to state (`96` for exports); SEZ and exports under LUT are zero-rated. The invoice type follows: tax invoice, bill of supply (composition / exempt), export, SEZ.
- Each line keeps the list rate, the item's current cost (valuation) and the discount below list. The header keeps cost, margin % and the largest discount %. These are the facts for approval rules.

### Approval conditions

Approval rules gained an optional condition (`approval_rules.condition`, `condition_value`). The rule matches only when the condition holds:

- `discount_above`: largest line discount below list > value %.
- `margin_below`: document margin < value %.
- `credit_exceeded`: the customer's credit check failed.

### Quotation (`sales_quotation`, `QTN`)

Priced like an order, valid until a date, approved by discount / margin rules. An approved, unexpired quotation converts once into a draft sales order (`POST /sales/quotations/:id/order`); the quotation then completes.

### Sales order (`sales_order`, `SO`)

- **Credit check on submit**: exposure = receivables (after credit notes) + open orders + this order, against the customer's credit limit. Any overdue bill also fails it. The result is stored on the order (`credit_check`).
- If it fails:
  - an approval rule with condition `credit_exceeded` routes it for approval; otherwise
  - a user with `sales.orders.credit_override` must give a reason (403 until they do; the reason is logged in the activity); otherwise
  - the submission is refused (409).
- **Reservation / ATP**: approved, undelivered order quantity counts as reserved. `GET /sales/atp` returns on hand (nettable stores or one warehouse), reserved, available, on order and the next receipt date. It is shown on the order form.
- Amend with revisions (the customer cannot change); cancel only while nothing is delivered or invoiced; short-close otherwise.
- Status completes when every stock line is delivered and every line is invoiced.

### Delivery note (`delivery_note`, `DLV`)

Against an approved order, from a dispatch warehouse, with batch pick (FEFO suggested) and serials. Posting moves stock out at valuation cost (`cost_value` kept per line for margin and returns). Proof of delivery (receiver, date, note) can be recorded on a posted delivery. A delivery cannot be cancelled once invoiced.

### Sales invoice (`sales_invoice`, `INV/{FY}/{SEQ}`)

- Lines bill a posted delivery line, an order line (services, or goods dispatched with the invoice: **invoice-cum-challan**, stock leaves on approval from the chosen warehouse), or nothing (direct sale). `GET /sales/invoices/billable` lists what is open for a customer.
- Due date = invoice date + credit days (invoice → order → customer). Outstanding = total − received − credited.
- The print format is GST-compliant (rule 46): supplier and recipient GSTIN, place of supply, HSN-wise tax summary, amount in words, reverse-charge flag, signature block.
- Cancel is refused when credit notes or receipts exist, or when an IRN was generated (Sprint 3.4).

### Credit note (`credit_note`, `CN/{FY}/{SEQ}`)

Against an approved invoice, using the invoice's own GST treatment:

- **Return**: goods come back into a chosen warehouse (e.g. quality hold) at the cost they left at; returned quantity is tracked per invoice line.
- **Price adjustment**: reduces what is owed, no stock.

Approval adds to the invoice's `credited_amount`, which reduces outstanding and credit exposure.

### Receivables

`GET /sales/receivables`: outstanding per customer aged by due date (not due, 1–30, 31–60, 61–90, over 90). Page: Sales → Receivables.

### Permissions

`sales.quotations.read/manage`, `sales.orders.read/manage/cancel/credit_override`, `sales.deliveries.read/manage/cancel`, `sales.invoices.read/manage/cancel` (credit notes use the invoice permissions).
