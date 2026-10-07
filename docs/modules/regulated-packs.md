# Module spec: Regulated industry packs and validation (Phase 14)

| | |
|---|---|
| **Status** | In progress: 14.1 done |
| **Code** | `backend/src/modules/gmp/`, `database/src/schema/gmp.ts`, `frontend/src/app/(app)/gmp/` |

Phase 8 already provides: lot status with QA release under electronic signature, specifications and CoA, NCR / CAPA / SCAR, complaints, SPC, supplier quality and approved manufacturers, deviations with risk and change control, calibration and MSA, internal audits, SOPs and training, HSE incidents, the hazardous waste register, EPR targets, and licences with renewal tracking. Phase 7 provides formulas, dispensing with tolerances, machine cleaning, process batches and engineering change. Phase 14 builds the packs on top of these.

## Sprint plan

| Sprint | Scope |
|---|---|
| 14.1 | **Part 11 controls and batch release**: one electronic signature service for every module (password each time, meaning, reason, signer name, content hash, hash chain, no edits or deletes), chain verification, line clearance signed by production and verified by QA (and required before a job starts), electronic batch record review by exception with a signed QA decision, environmental monitoring of clean rooms against EU GMP Annex 1 limits |
| 14.2 | **Pharma GMP II**: stability studies (protocols, conditions, pull schedule, results, out-of-specification, shelf-life estimate), annual product quality review, GS1 serialisation (SGTIN) with aggregation to cartons and pallets and an export file, QR codes for API labels, DPCO ceiling-price checks |
| 14.3 | **Validation package**: URS and functional specification from the system's module catalogue, GAMP 5 risk assessment, IQ / OQ / PQ protocols with execution records and evidence, traceability matrix, and the pack as a document set |
| 14.4 | **Automotive (IATF 16949)**: APQP projects and gates, PPAP workspace (18 elements, submission levels, PSW), PFMEA / DFMEA with AIAG-VDA action priority, control plans linked to the FMEA, layered process audits, customer-specific requirements, EDI with OEMs (DELFOR / DELJIT in, DESADV / INVOIC out) |
| 14.5 | **Food safety**: HACCP plan builder, CCP monitoring by hand and from sensors, allergen matrix and changeover rules, mock and real recalls with trace times, supplier food-safety approval, label content (nutrition, veg / non-veg mark, allergens), FSSAI annual return data |
| 14.6 | **Chemical HSE, textile, electronics, EPR and sustainability**: SDS (16 sections) and GHS labels, hazardous inventory limits by location, permit to work, PESO licences; buyer POs, tech packs, sampling and certificates (GOTS, OEKO-TEX); RoHS / REACH declarations, conflict minerals, BIS registrations; EPR certificates, BRSR-lite, Scope 1 / 2 / 3 carbon footprint |

Exit target (from the phase plan): a pharma pilot passes an audit on system records; an auto pilot submits PPAP to an OEM from the system; the validation package is reviewed by an external CSV consultant.

## 14.1 Part 11 controls and batch release (done)

Migration 0059 adds `gmp_settings`, `line_clearances`, `batch_reviews`, `em_locations`, `em_samples`, and the columns `signer_name`, `record_hash` and `chain_hash` to `e_signatures`. The application role can no longer update or delete `e_signatures` (as for `audit_logs`). Code: `backend/src/modules/gmp/` (`rules.ts` is pure and unit tested; `esign.service.ts` is global). Permissions: `gmp.lineclearance.sign`, `gmp.batchrecords.review`, `gmp.environment.manage`, `gmp.settings.manage`. Pages: `/gmp`, `/gmp/line-clearance`, `/gmp/batch-reviews` (and `/:id`), `/gmp/environment`.

**Electronic signatures** (`ESignService`, used by lot status changes and every 14.x signature):
- the signer re-enters their password every time;
- the signature records who, when, the meaning ("Line clearance verified (QA)", "Batch record reviewed: approved for release"…), the reason and the client IP, and keeps the signer's name as it was (manifestation);
- the signed content is stored with its SHA-256 hash (keys sorted, so the hash depends only on content);
- each signature's chain hash covers the previous signature's chain hash and its own id, signer, record, meaning, content hash and time. Signatures are written one at a time per workspace so the chain has a single order;
- `GET /gmp/signatures/verify` recomputes the chain and reports any signature whose content was changed or after which a signature was changed or removed. Signatures made before the chain existed are counted but not checked.

**Line clearance.** Production records the clearance for a work order (machine, area, previous product and batch) by ticking every checklist item and signing; QA verifies (or fails, with a reason) by signing — and must be a different person. The checklist is set per workspace (five standard items by default). When the workspace requires it, the machine terminal refuses to start a job without a QA-verified clearance for that work order (and machine) in the last 12 hours (settable).

**Batch record review by exception.** Opening a review for a work order collects everything that went differently from the master instructions:
- start checks that failed or warned, first-off pieces rejected or never approved, in-line checks out of limits, recipe parameters that ran outside their limits (from the machine's signals during the job), recipes that could not be sent to the machine;
- rejected quantities by operation, machine alarms raised while the batch ran, deviations linked to the work order (open ones are major), missing QA-verified line clearance, quality inspections not completed or not accepted, and machine cleanings before the batch that were not verified.
Each exception must be assessed with a comment; the exceptions are recomputed when QA signs, and anything new must be assessed too. The decision (approved for release, or rejected) is signed with a conclusion. A batch with no exceptions needs no detailed review.

**Environmental monitoring.** Locations have a grade (A–D, ISO 5–8, or not classified) and the parameters monitored (settle plates, active air, contact plates, particles ≥ 0.5 µm and ≥ 5.0 µm, temperature, humidity, pressure differential). Each parameter has an optional alert limit and an action limit; without its own action limit a location uses the EU GMP Annex 1 (2022) limit for its grade, in operation or at rest. Results are judged ok, alert or action; an action-limit result raises an unplanned deviation (category environment) linked to the result and, if given, the batch. The overview shows each location's latest results and its excursions in the last 30 days; there is a trend per parameter.
