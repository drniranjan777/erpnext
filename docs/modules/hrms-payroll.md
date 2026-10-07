# Module spec: HRMS and payroll (Phase 9)

| | |
|---|---|
| **Status** | In progress: 9.1 done |
| **Code** | `backend/src/modules/hr/`, `backend/src/modules/payroll/`, `database/src/schema/hr.ts`, `database/src/schema/payroll.ts`, `frontend/src/app/(app)/hr/` |

## Sprint plan

| Sprint | Scope |
|---|---|
| 9.1 | **Core HR**: departments, designations, grades, work locations (state, for PT / LWF); employee master (personal, job, statutory IDs and bank encrypted at rest and masked, family and nominees, documents); reporting lines and org chart; transfers, promotions, confirmations with history; letters from templates |
| 9.2 | **Time and leave**: shifts and rotation; attendance from biometric devices (push API / file import) and geo-fenced mobile punches with a selfie; daily attendance (present, half day, absent, late, overtime under the Factories Act); regularisation; comp-off; holiday lists per location; leave types, accrual, carry-forward, encashment; leave applications with approval |
| 9.3 | **Payroll**: salary structures and components; monthly payroll run (attendance-based LOP, overtime, piece-rate from job cards, arrears, loans and advances, reimbursements); PF (ECR), ESI, PT by state, LWF, TDS on salary (old / new regime); payslips; bank salary file; GL posting |
| 9.4 | **Talent**: manpower requisition, applicants and interviews, offer approval; onboarding checklist; goals / KRAs and appraisal with increments into payroll; training calendar and the shop-floor skill matrix; exit, clearance, full and final settlement (gratuity, leave encashment, notice) |
| 9.5 | **Contract labour and self-service**: contractors and contract workers (CLRA), their attendance and wage check; ESS / MSS (payslips, leave, attendance, claims, approvals); statutory registers and forms (Factories Act, Shops Act); HR answers in the Copilot |

Exit target: a payroll for ≥ 500 employees across 2 states reconciles with the current vendor for 2 cycles.

## 9.1 Core HR (done)

**Organisation masters** (`hr_departments`, `hr_designations`, `hr_grades`, `hr_locations`): code + name, active flag, employee counts. Departments nest and carry a cost centre; designations sit in a grade; grades carry a level and salary band; locations carry the GST state code (it drives PT and LWF in 9.3) and an optional geofence (latitude, longitude, radius) for mobile punches in 9.2. API: `GET|POST /hr/org/:kind`, `PUT /hr/org/:kind/:id`.

**Employee master** (`employees`): codes run EMP0001, EMP0002 and so on. It holds personal details, addresses, emergency contact, job placement, category and employment type, notice days, payroll flags (PF, ESI, PT, LWF, tax regime), UAN, ESIC number and bank. Family members and nominees are stored with their share.
- PAN, Aadhaar and the bank account number are AES-256-GCM encrypted. The API returns only masked forms (ABXXX1234F, last 4).
- `POST /hr/employees/:id/reveal` returns the full value. It needs `hr.employees.sensitive`, and every call is written to the audit log.
- IDs are validated:
  - Aadhaar: Verhoeff check digit
  - PAN, IFSC: format
  - UAN: 12 digits
  - ESIC: 10 or 17 digits
- Placement fields (department, designation, grade, location, manager) cannot be changed by edit. They change only through `POST /employees/:id/move` (transfer, promotion or re-designation), which records the before and after in `employee_events` and refuses a reporting loop.
- `confirm` ends probation. `exit` with a future date puts the employee on notice; with today's date or earlier, it marks them exited.

**Documents**: multipart upload (`kind`, `title`, `expiryDate`, then the file). Files are stored as attachments with entity type `employee`. The generic `/documents/attachments` download refuses anything not attached to a document.

**Letters**: templates use `{{placeholder}}` fields. The known placeholders (`employee.name`, `designation`, `doj`, `company`, `today`, …) are filled from the record; any other placeholder is asked for when the letter is issued. An issued letter keeps its rendered text (`employee_letters`) and prints at `/print/letters/:id`.

**Permissions**: `hr.employees.read`, `hr.employees.manage`, `hr.employees.sensitive`, `hr.masters.manage`, `hr.letters.manage`.

**UI** (nav section "People"):
- `/hr`: headcount by department, location, category and gender
- `/hr/employees`: list, new, profile with actions, edit
- `/hr/org`: organisation masters
- `/hr/org-chart`
- `/hr/letters`: letter templates
