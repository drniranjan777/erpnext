# Module spec: HRMS and payroll (Phase 9)

| | |
|---|---|
| **Status** | In progress: 9.1 and 9.2 done |
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

## 9.2 Time and leave (done)

Schema: `database/src/schema/attendance.ts`, migration 0036. Rules: `backend/src/modules/hr/time/attendance-engine.ts`, which is pure and unit tested.

**Shifts and rosters**
- A shift has IST start and end times (an end at or before the start runs past midnight), a break, a grace period for late arrival, and the minutes worked for a half day and a full day. Overtime counts after `otAfterMinutes`, or 9 hours when that is blank (Factories Act s.51/s.59).
- A roster (`hr_shift_assignments`) gives an employee one shift, or a rotation of up to 6 shifts changing every N days, plus their weekly offs. A new roster replaces any from its start date and closes the one running then. Without a roster, the day is the calendar day and Sunday is off.
- Holidays apply to one location or to all of them. A restricted holiday is not a day off.

**Punches**
- Every punch is unique per employee and second, so repeated device pushes are ignored.
- Sources:
  - `POST /hr/attendance/punches`: devices or middleware with an API key holding `hr.attendance.manage`, up to 2,000 punches per call.
  - `POST /hr/attendance/punches/import`: a CSV/XLSX file with `employee_code` plus `punch_time`, or separate date and time columns. Times are read as IST, in `YYYY-MM-DD HH:MM` or `DD/MM/YYYY HH:MM`.
  - `POST /hr/attendance/mobile`: the employee's phone (`/hr/punch`) sends latitude, longitude, accuracy and a selfie. The distance to the work location's geofence is recorded. A punch outside the fence is still accepted, but flagged for HR (`?flagged=true`).
- Each new punch reprocesses its date and the day before (for night shifts).

**Daily attendance** (`attendance_days`)
- `POST /hr/attendance/process` recomputes up to 62 days, and never touches days that payroll has locked.
- A punch belongs to the shift window, which runs from 4 hours before the start to 8 hours after the end.
- Worked time is first-in to last-out, less the break once the span passes 5 hours (s.55).
- Statuses:
  - present: worked at least a full day
  - half_day: worked at least a half day
  - absent: less than a half day
  - missed_punch: a single punch; not payable until regularised
  - weekly_off, holiday: payable
  - leave: payable when the leave type is paid
- Late minutes count from the shift start once the grace period is passed.
- Overtime counts beyond the threshold in whole quarter hours.
- Weekly overtime beyond 48 hours that the daily rule has not already counted is added in the monthly summary.
- Work on an off day earns comp-off: 1 day for a full day worked, 0.5 for a half. It is credited to the active comp-off leave type.

**Muster roll**: `GET /hr/attendance/month` returns each employee's day codes plus payable days, LOP days, overtime hours and late days. Payroll (9.3) reads it.

**Regularisation**: a request for a missed or wrong in/out time, within the last 62 days. The reporting manager or HR approves it, never the employee. Approval adds `regularisation` punches and reprocesses the day.

**Leave**
- `leave_ledger` holds every credit and debit, and the balance is their sum. A `ref_key` makes accrual runs and postings idempotent.
- Accrual types:
  - monthly: a twelfth of the quota; employees who join after the 15th start the next month
  - yearly: credited in January, or pro rata in the month of joining
  - per_days_worked: Factories Act s.79 earned leave; topped up to one day per N days worked so far in the year, recomputed on each run
- Applications:
  - Weekly offs and holidays are skipped unless the type counts them (the sandwich rule); half first or last days are supported.
  - The balance check includes pending applications.
  - Gender-specific types and overlapping applications are refused.
- Approval by the manager or HR debits the leave (`availed`). Cancelling approved leave credits it back (`reversal`); once the leave has started, only HR can cancel. Both actions reprocess the days already past.
- Year end keeps up to the carry-forward limit, encashes up to `encashMax` when the type is encashable, and lapses the rest. Encashment entries are read by payroll and F&F.
- Opening balances and adjustments go through `POST /hr/leave/adjust`.

**Self-service**: `hr.self.use` lets a linked employee punch, apply for leave and request regularisation for themselves, and decide requests from their direct reports. `GET /hr/me` returns their record and today's punches.

**Permissions**: `hr.attendance.read`, `hr.attendance.manage`, `hr.leave.read`, `hr.leave.manage`, `hr.self.use`.

**UI**: `/hr/punch`, `/hr/attendance` (muster roll, process, import), `/hr/shifts` (shifts, roster, holidays), `/hr/regularisations`, `/hr/leave`, `/hr/leave/types` (types, accrual, year end, opening balances).
