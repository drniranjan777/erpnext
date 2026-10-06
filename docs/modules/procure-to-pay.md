# Module spec: Procure-to-Pay, Order-to-Cash & GST (Phase 3)

| | |
|---|---|
| **Status** | Sprint 3.1 done (6 Oct 2026): GST engine, purchase orders, goods receipts, PR → PO, reorder → PR |
| **Code** | `backend/src/modules/{gst,purchase}/`, `database/src/schema/purchase.ts`, `frontend/src/app/(app)/purchase/` |
| **Tests** | `backend/test/unit/gst-engine.test.ts`, `backend/test/e2e/purchase.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **3.1** ✅ | GST engine · company GSTIN editing · purchase order (goods / services, amend with revisions, tolerance, short-close) · GRN against PO (accept / reject, batches, serials) · requisition → PO · reorder list → requisition · PO and GRN print formats |
| 3.2 | Purchase invoice with 2-/3-way match (PO–GRN–invoice), ITC eligibility, RCM, TDS · purchase return & debit note · landed cost · MSME 45-day payment tracking · RFQ & comparative statement · vendor rating |
| 3.3 | Quotation · sales order (credit-limit / overdue check, reservation, ATP) · pick, pack & delivery note · tax invoice / bill of supply / export / SEZ · sales return & credit note · schemes and discount approval |
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
