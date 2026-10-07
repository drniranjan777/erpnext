# Module spec: Quality management and maintenance (Phase 8)

| | |
|---|---|
| **Status** | Sprint 8.1 (7 Oct 2026) done. Builds on the 5.3 quality module (`docs/modules/quality.md`). |
| **Tests** | `backend/test/e2e/qms.e2e.test.ts` |
| **Code** | `backend/src/modules/quality/`, `backend/src/modules/maintenance/`, `database/src/schema/quality.ts`, `database/src/schema/maintenance.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **8.1** ✅ | **Quality control depth**: lot status (quarantine → under test → released / conditional / rejected) enforced on stock issue; QA release with an electronic signature (password re-entry + meaning, kept as a signature record); vendor- and customer-specific specifications; skip-lot sampling; vendor CoA reference and check on incoming lots; certificate of analysis print; retain samples; **non-conformance reports** with MRB disposition (use as is, rework, scrap, return, sort) and **cost of poor quality** |
| 8.2 | **CAPA** (5-Why, fishbone, 8D, effectiveness check, links to NCRs and complaints); **SPC** (X-bar R / S, I-MR, p, np, c, u charts, Cp / Cpk / Pp / Ppk, Western Electric rules) on inspection readings; **customer complaints**; **supplier quality** (scorecards from inspections and NCRs, SCAR, supplier audits, approved manufacturer list) |
| 8.3 | **Deviations and change control** (impact and risk assessment, approval); **calibration and MSA** (gauge master, calibration schedule and certificates, due alerts, gauge R&R); **internal audits** (plans, findings); **SOPs** with versions and training acknowledgement; **HSE** (incidents, hazardous waste register, EPR obligations, licences and permits with expiry alerts) |
| 8.4 | **Maintenance (EAM / TPM)**: asset hierarchy; breakdown requests (photo); preventive schedules by time, usage or meter; maintenance work orders with checklists, spares issue, labour and cost; downtime with MTTR / MTBF; tool and mould life triggers; critical spares; AMC contracts and visits with SLA; TPM (autonomous maintenance checklists, kaizen register, 5S audits, OEE losses) |

Exit target (V1.5): an IATF-style and a GMP-style pilot can complete a mock audit from system records alone.

## 1. Lot status and QA release (8.1)

- **Status**: every batch has a QC status, held in `batches.qc_status`. A lot is *released* unless QC holds it.

  | Status | When |
  |---|---|
  | quarantine | an incoming or final inspection is raised for the lot |
  | under test | the first readings are saved |
  | released / rejected | the inspection is decided (accepted or partly accepted → released; fully rejected → rejected) |
  | conditional | set by QA |

  Deleting an undecided inspection lifts its hold.
- **Enforcement**, in `StockService`, so every document obeys it:
  - A lot in *quarantine* or *under test* cannot leave on any voucher except:
    - stock transfers and adjustments (moves marked `allowHeld`);
    - stock counts;
    - the inspection itself;
    - debit notes (returns to the vendor).
  - A *rejected* lot cannot be delivered, invoiced, sent for job work or blended, but it can be issued to a rework order.
- **QA release with an electronic signature** (`POST /quality/lots/status`, permission `quality.release.sign`):
  - The signer re-enters their password and gives a reason.
  - A row in `e_signatures` records the signer, the meaning ("QA release", "Conditional release", "QA rejection", …), the old and new status, the time and the IP address. These rows are never updated or deleted.
  - `GET /quality/signatures/:entityId` lists them.
- **Lot list**: `GET /quality/lots`, by default every lot that is not released, with its stock.

## 2. Specifications, skip-lot, CoA, retain samples (8.1)

- **Vendor and customer specifications**: an incoming plan can be for one vendor, and a final plan for one customer.
  - The vendor's plan is preferred on its goods receipts.
  - The customer's plan is preferred for work orders made to that customer's order.
  - Otherwise the general plan applies. The inspection records whose specification was used.
- **Skip-lot** (incoming plans): `skip_lot_after` and `skip_every`.
  - Once the last *n* inspections of the plan (per vendor, for vendor plans) were all accepted, only one lot in *k* is inspected.
  - Skipped lots are logged in `skip_lots` and are not held.
  - A rejection (or a lot still pending) stops the skipping until *n* accepted lots come in again.
- **Vendor CoA**: incoming inspections record the vendor's certificate number and whether it was checked against our specification (`PUT /quality/inspections/:id/coa`, drafts only).
- **Certificate of analysis** (`/print/coa/:inspectionId`): for decided incoming and final lots. Per characteristic it shows the test, method, specification, result (mean and range, or pass count) and whether it conforms.
- **Retain samples** (`/quality/retain-samples`):
  - Each sample records the lot, quantity, location, drawn date and retain-until date.
  - Samples past their date are listed as due, and *dispose* records when and by whom.

## 3. Non-conformance and cost of poor quality (8.1)

- **NCR** (doc type `ncr`, `NCR/{FY}/{SEQ}`; permission `quality.ncr.manage`):
  - It records where the problem was found (incoming, in-process, final, customer, supplier, internal), the severity, the item and lot, the quantity affected, the defect, the description, the vendor or customer, and the containment.
  - *Raise NCR* on an inspection with rejects (or failing readings) pre-fills it. Incoming rejects default to *return to vendor*; others default to *scrap*; rework is carried over.
- **MRB disposition**: use as is, rework, scrap, return, sort.
  - Drafts may not dispose of more than the quantity affected.
  - Submitting requires the disposition to cover it exactly.
  - Approval through the document workflow is the MRB decision.
- **Cost of poor quality**, fixed at approval:
  - scrap, at the item's stock valuation rate (or standard / last purchase cost) unless entered;
  - plus rework, sorting and other costs;
  - less recoveries (debit notes, claims).

  Approved NCRs can then be closed. `GET /quality/copq?from&to` totals them by month, defect, where found, and vendor or customer.
