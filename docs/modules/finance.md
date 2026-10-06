# Module spec: Finance & Accounting (Phase 4)

| | |
|---|---|
| **Status** | Phase 4 complete (7 Oct 2026): sprints 4.1–4.4 |
| **Code** | `backend/src/modules/accounting/`, `database/src/schema/{accounting,banking,returns}.ts` (migrations 0015–0019), `frontend/src/app/(app)/accounting/` |
| **Tests** | `backend/test/e2e/{accounting,money,returns,statements}.e2e.test.ts`, `backend/test/unit/{bank-statement,tax-assets,insights}.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **4.1** ✅ | Chart of accounts (Schedule III) · cost centres · append-only general ledger · posting rules from every module · journal vouchers (manual, opening, reversing, recurring) · period lock · back-posting · trial balance, ledger, day book |
| **4.2** ✅ | Receipts and payments with bill-wise allocation, advances, on-account · cash, bank and contra vouchers · cheques / PDC · bank statement import and auto-reconciliation · customer statements, dunning, interest · payment proposals (due date, MSME), bank files · bad-debt write-off |
| **4.3** ✅ | GSTR-1 JSON, GSTR-3B, GSTR-2B reconciliation, GST set-off and challan · TDS / TCS returns (26Q / 27Q, 16A) · fixed assets: register, capitalisation, depreciation (Companies Act and Income-tax books), disposal |
| **4.4** ✅ | P&L, Balance Sheet (Schedule III), cash flow, ratios, comparatives · year-end close · budgets and budget control on PR / PO · multi-currency revaluation · maker-checker, auditor role, close checklist · AI: journal anomalies, cash-flow forecast |

## 1. Chart of accounts

Each company gets a default chart the first time it posts, or when the accounting pages are opened. The chart (`accounting/chart-template.ts`) is laid out on Schedule III:

- equity
- non-current and current liabilities, including duties and taxes
- non-current and current assets
- revenue
- other income
- expenses

**Two kinds of account**

- **Groups** hold accounts.
- **Posting accounts** hold entries. New accounts inherit their nature and Schedule III report line from their group.

**System accounts** (`system_key`) are the accounts the posting rules use:

- receivable / payable (control accounts: every entry names the party)
- stock
- GRNI
- COGS
- PPV
- output, input and RCM GST
- TDS payable
- accruals

Rules:

- System accounts can be renamed or moved, but not deactivated.
- Stock and GRNI only take entries from documents. Journals cannot touch them.

Items can name their own income / expense account by code (`items.income_account_code`, `expense_account_code`). Otherwise their type decides the account.

## 2. General ledger

- `gl_entries` holds one row per account line.
  - Each row records the company, branch, voucher (document), party, cost centre and against-voucher (the bill it belongs to).
  - Amounts are in INR, debit / credit.
  - The table is append-only: the app role cannot update or delete it.
- `LedgerService.post` refuses a voucher that does not balance to the paisa. It also refuses:
  - a group account;
  - a control-account line without a party;
  - a date in a locked period.
- Cancelling a document writes mirror rows (`is_reversal`). They are dated as the original, or today if that period is locked.

## 3. Posting rules (`posting-rules.service.ts`)

`DocumentsService.addListener` runs the rules after each module's own approval or cancel hook, in the same transaction. Stock values come from the stock ledger, so the books and the stock valuation agree.

| Document | Entries |
|---|---|
| Goods receipt | Dr Stock · Cr GRNI (stock value received) |
| Purchase invoice | Dr GRNI (expected value) + PPV (rate variance) for received goods; Dr expense for services / non-stock · Dr input CGST/SGST/IGST/cess (eligible) or ITC-not-available · Cr RCM payable on reverse charge · Cr vendor (bill total) · Dr vendor / Cr TDS payable · round-off |
| Debit note | Dr vendor · Cr input GST · Cr Stock (value that left) · rest to PPV |
| Landed cost | Dr Stock (absorbed) + COGS (on goods already used) · Cr landed cost accrued |
| Bill of Entry | Dr Stock (duty capitalised) + COGS (rest of BCD + SWS) + input IGST / cess · Cr customs duty payable |
| Delivery note | Dr COGS · Cr Stock |
| Sales invoice | Dr customer · Cr sales (domestic / export / services, or the item's account) · Cr output GST (not on reverse charge) · Dr COGS / Cr Stock for goods sent with the invoice · round-off |
| Credit note | Dr sales returns + output GST · Cr customer (against the invoice) · Dr Stock / Cr COGS for returns |
| Stock entry | Dr/Cr Stock against opening balance (opening stock), materials consumed (issue), stock adjustments (receipt, adjustment, transfer differences) |
| Stock count | Stock ↔ stock adjustments |
| Job-work receipt | Dr Stock (job charges in the product value) · Cr job-work charges accrued |
| Journal | As entered |

Each rule has one balancing line, normally round-off. Any difference beyond ₹1 is refused as a rule error, not rounding.

**Back-posting.** *Books & periods → Post them now* posts approved documents dated from the books' start that have no entries, oldest first. It is idempotent, and is meant for documents approved before accounting existed.

## 4. Journal vouchers (`journal_entry`, `JV/{FY}/{SEQ}`)

- Lines carry account, party (required on receivable / payable), cost centre, debit or credit, and narration.
- Debits must equal credits.
- Approval rules and maker-checker work as for other documents.
- **Opening balances**: kind `opening`.
- **Reversing**: on approval, a mirror journal dated `reverse_on` is created and submitted.
- **Recurring** (monthly / quarterly / yearly, optionally until a date): each approval schedules the next copy with a self-rescheduling job. Copies post on their own date.

## 5. Period lock and books

`accounting_settings` per company:

- `books_from` defaults to the current financial year's start.
- `locked_until` cannot be in the future.
- On or before the lock date nothing posts: documents and journals are both refused with 409.

## 6. Reports

- **Trial balance** (`GET /accounting/trial-balance?from&to`): opening, debit, credit and closing per account, rolled up the tree. It shows whether debits equal credits.
- **Ledger** (`GET /accounting/ledger?accountId|partyId&from&to`): opening, entries with running balance and against-bill, and a link to each voucher.
- **Day book** (`GET /accounting/day-book?from&to`): vouchers with their entries.

## Permissions

`accounting.accounts.read/manage`, `accounting.journals.manage/cancel`, `accounting.settings.manage`.

## 7. Receipts, payments and contra (Sprint 4.2)

Doc types: `receipt` (`RV/{FY}/{SEQ}`), `payment` (`PV`), `contra` (`CV`). Table: `money_vouchers`.

**Voucher fields**

- Bank / cash account: an account with `account_type` bank or cash, created under *Bank accounts*.
- A party, or a counter account (other income / expense).
- Mode: NEFT, RTGS, IMPS, UPI, cheque, cash, card or DD.
- Amount, plus bank charges and, on receipts, the TDS the customer deducted.

**Settlement**

- **Bill-wise allocation** (`money_allocations`) settles sales invoices (receipts) or purchase bills (payments). It updates `received_amount` / `paid_amount`.
- *Oldest first* settles whatever is not allocated by hand.
- Anything left over stays **on account**. The ledger tags it with the voucher itself (`against_voucher_id`).
- **Receipt settled amount** = amount + TDS + bank charges.

**Ledger entries**

| Voucher | Entries |
|---|---|
| Receipt | Dr bank, bank charges, TDS receivable · Cr customer (per bill, plus on account) |
| Payment | Dr vendor (per bill, plus on account) · Cr bank (amount + charges) · Dr bank charges |
| Contra | Dr the other bank / cash account · Cr this one |

**Related actions**

- **Advance adjustment** (`POST /accounting/money/:kind/:id/adjust`) posts a journal that moves the on-account amount onto a bill. A voucher with adjustments cannot be cancelled until those journals are.
- **Cheques** are `pending` until marked cleared or bounced. Bounced cancels the voucher and reopens the bills.
- **Write-off** (`POST /accounting/write-off`) is a receipt against the bad debts account, settling the invoice.
- Purchase bills now carry `debited_amount`, which approved debit notes update. Outstanding = net payable − paid − debited.

## 8. Receivables and payables

- **Ageing** (`GET /accounting/ageing?side&asOf&buckets=30,60,90`): party-wise outstanding by days past due, plus unadjusted advances.
- **Statement of account** (`/accounting/statement/:partyId`): ledger with running balance, open bills, advances. Printable.
- **Interest** on overdue invoices: simple interest at a yearly rate from the due date.
- **Payment reminders** (`POST /accounting/dunning`): one email per customer listing overdue invoices. Event `accounting.payment_reminder`, sent to the party's email. Customers without an email are reported back as skipped.
- **Payment proposal and run**:
  - The proposal lists bills due by a date, MSME micro / small first.
  - A run creates one posted payment per vendor.
  - `GET /accounting/bank-file?ids&format=generic|hdfc` downloads the NEFT / RTGS upload file. RTGS is used from ₹2 lakh. Vendor account numbers are decrypted only for the file.

## 9. Bank reconciliation

- **Import** (`POST /accounting/bank/:accountId/statement`):
  - CSV / XLSX: the bank's preamble is skipped. The header is found by a date column plus withdrawal / deposit, debit / credit, or amount + Dr/Cr columns. Balances keep their sign.
  - MT940: `:61:` lines with their `:86:` narrative.
  - Lines already imported (same date, amount and narration) are skipped.
- **Auto-matching** against unreconciled ledger entries of the bank account. Cancelled vouchers are excluded. The rules, strongest first:
  1. Same amount, and a cheque / UTR / voucher number in the narration.
  2. Same amount within 3 days, when exactly one entry fits.
  3. Same amount within 10 days, when exactly one entry fits.
- Each entry matches once. `bank_reconciliations` links entry ↔ line, since the ledger stays append-only.
- **Manual**: match one line to one or more entries (the sum must equal the line), undo, or ignore.
- **Record**: creates and posts a receipt / payment for a line missing from the books (charges, interest), then matches it.
- **BRS** (`GET /accounting/bank/:id/brs?asOf`): balance as per books, less deposits not credited, plus payments not presented, gives the expected bank balance. That is compared with the statement balance, and statement lines not yet in the books are shown.

## 10. GST returns (Sprint 4.3)

Code: `compliance/gst-returns.service.ts`, `compliance/gst-setoff.ts`. Pages: GST → GSTR-1, GSTR-3B, GSTR-2B reconciliation.

### GSTR-1 (`GET /gst/gstr1?period=YYYY-MM[&download=true]`)

JSON in the GSTN offline-tool layout, built from posted invoices and credit notes of the month.

| Section | What goes in |
|---|---|
| `b2b` | Registered customers; SEZ as SEWP / SEWOP |
| `b2cl` | Unregistered customers, inter-state, invoice above ₹1 lakh |
| `b2cs` | All other B2C, by supply type / state / rate; credit notes on these are netted in |
| `exp` | Exports, WPAY / WOPAY |
| `cdnr` | Credit notes to registered customers |
| `cdnur` | Credit notes on B2CL invoices and exports |
| `hsn` | HSN summary, B2B and B2C separately |
| `doc_issue` | Documents issued |

Items are grouped by rate. Bills of supply and exempt lines are left out.

### GSTR-3B (`GET /gst/gstr3b?period`)

| Table | Source |
|---|---|
| 3.1 (a)–(e) | Sales net of credit notes: taxable, zero-rated, nil / exempt, non-GST. Plus reverse-charge inward supplies. |
| 3.2 | Inter-state supplies to unregistered persons, by state |
| 4(A) | Import IGST / cess from Bills of Entry; reverse-charge ITC; all other eligible ITC |
| 4(B) | ITC reversed by debit notes |
| 4(D) | Ineligible ITC, s.17(5) |
| 5 | Exempt / non-GST inward supplies |

**Set-off** (`computeSetOff`) uses the tax ledgers' balances at the period end, so unused credit carries forward. The order (s.49A / rule 88A):

1. IGST credit pays IGST.
2. What is left of the IGST credit pays CGST / SGST, going first where their own credit falls short.
3. CGST credit pays CGST, then IGST.
4. SGST credit pays SGST, then IGST.

CGST and SGST credit never cross. Cess credit pays only cess. Reverse-charge tax is paid in cash.

**Post set-off** (`POST /gst/gstr3b/settle`) posts a journal dated the period end:

- Dr output tax and RCM payable.
- Cr input credit, by the amounts utilised.
- Cr *GST payable (cash ledger)* for the cash part.

The cash part is then paid with a payment voucher against GST payable.

### GSTR-2B (`POST /gst/gstr2b` with the portal JSON, `GET /gst/gstr2b?period`)

The portal's documents are matched to bills:

- **B2B invoices** match on vendor GSTIN + normalised invoice number, where `SP/0012` = `sp-12`. Taxable value and each tax must agree within ₹1. Each document gets one status:
  - **matched**;
  - **mismatch**, with the differences listed;
  - **missing in books**.
- **Imports (IMPG)** match Bills of Entry on BE number.
- **Bills in the books but not in 2B** are listed with their *ITC at risk*.
- An accountant can mark each line *accept*, *follow up* or *defer ITC*.

## 11. TDS (Sprint 4.3)

- `GET /accounting/tds?fy&quarter&form=26Q|27Q[&format=csv]`
  - Deductions from posted bills for the quarter, by section. 27Q holds overseas vendors.
  - Shows deposits and the balance still to deposit.
  - Lists deductees without a PAN (s.206AA).
  - CSV gives the deductee rows for the return utility.
- **Record challan** (`POST /accounting/tds/challans`): a payment from the bank against TDS payable, with BSR code, challan serial and deposit date (ITNS 281). Stored in `tds_challans`.
- **Form 16A data** (`GET /accounting/tds/16a/:vendorId`): per deductee, the quarter's transactions and challans, to check against TRACES.

## 12. Fixed assets (Sprint 4.3)

Code: `accounting/assets.service.ts`, `accounting/depreciation.ts`. Pages under `/assets`.

- **Categories**: asset account, method (SLM / WDV), Schedule II useful life, residual %, Income-tax block rate. Defaults: plant 15 yrs / 15%, furniture 10 / 10%, vehicles 8 / 15%, computers 3 / 40%.
- **Add asset**: cost, purchase and put-to-use dates, location, custodian, serial number. *Move cost from* posts a journal from CWIP, or from the account the bill was booked to. Each asset gets a QR tag (code | name).
- **Depreciation run** (`POST /assets/depreciation {to}`):
  - Day-based (365-day year), from the day after the last charge. Never below the residual value.
  - SLM = (cost − residual) / life.
  - WDV rate = 1 − (residual / cost)^(1 / life), assuming at least 5% residual.
  - One journal posts Dr depreciation / Cr accumulated depreciation. Per-asset rows are kept in `asset_depreciation`.
  - Cancelling the journal takes the charge back off the assets.
- **Disposal** (`POST /assets/:id/dispose`):
  1. Depreciation is charged up to the disposal date.
  2. A journal posts Dr accumulated depreciation + bank (sale amount), Cr asset cost.
  3. The balance goes to *Profit / loss on sale of assets*.
- **Transfer**: location / custodian.
- **Income-tax schedule** (`GET /assets/it-schedule?fy`): per block, opening WDV, additions (≥180 / <180 days), sales, depreciation, closing. Half rate applies on additions used under 180 days. Sales come off the full-rate part first. This is a report only; it is not posted.
- System accounts *GST payable* and *Profit / loss on sale of assets* were added to the chart. Charts of existing companies get them automatically the first time a posting needs them (`LedgerService.addMissingTemplateAccounts`).

## 13. Financial statements (Sprint 4.4)

Code: `accounting/statements.service.ts`. Page: Accounting → Financial statements. Click a line to see its accounts, and an account to open its ledger.

### Statement of Profit and Loss

Schedule III Part II, over `from`–`to`, compared with the same period a year earlier.

- Lines: revenue from operations; other income; cost of materials and goods; employee benefits; finance costs; depreciation; other expenses; profit before tax.
- Year-end closing journals are left out, so a closed year still shows its P&L.

### Balance Sheet

Schedule III Part I, as of a date, compared with a year earlier.

- Shareholders' funds include the unclosed surplus in P&L.
- Reclassification:
  - Customers with credit balances → *other current liabilities*.
  - Vendors with debit balances → *short-term loans and advances*.
  - Overdrawn banks → *short-term borrowings*.
- Shows whether both sides agree.

### Cash flow

Indirect method:

| Section | Built from |
|---|---|
| Operating | Profit before tax, plus depreciation, less profit on asset sales, plus working-capital changes |
| Investing | Net PPE movement plus depreciation, plus profit on sales, plus the CWIP change |
| Financing | Share capital, other reserve movements, borrowings |

It reconciles to the change in cash and bank, and reports any difference.

### Ratios

Current, quick, debt / equity, gross and net margin, ROE, and debtor / creditor / inventory days.

## 14. Close (Sprint 4.4)

- **Month-end checklist** (`GET /accounting/close-checklist?period`):
  - Approved documents not in the ledger.
  - Drafts and pending approvals.
  - Bank statements imported and matched.
  - GRNI older than 30 days.
  - Depreciation to the month end.
  - GST set-off posted.
  - TDS still to deposit.
  - Postings to opening balance difference.
  - Period lock.
- **Revaluation** (`POST /accounting/revalue`): open foreign-currency bills restated at the closing rate. The difference goes to the payable (bill-wise) against exchange gain / loss, through a reversing journal dated the next day.
- **Year-end** (`POST /accounting/year-end {fy, lock}`):
  - A journal of kind `closing`, dated the last day of the year, moves every income and expense balance to retained earnings. It can optionally lock the year.
  - Closing the same year twice is refused. Cancelling the journal reopens the year.

## 15. Budgets (Sprint 4.4)

- Tables `budgets` (company, FY, name, control `none | warn | block`) and `budget_lines` (account, optional cost centre, month 1 = April, amount). Annual amounts are spread evenly; the rounding goes in March.
- **Budget vs actual** per account and month, from the ledger.
- **Budget control** runs on purchase-order submission, through `DocumentsService.addValidator`.
  - Only non-stock lines count, using the item's expense account or the services / expenses default.
  - It totals this year's actual + open approved orders + this order against the annual budget.
  - `block` refuses the submission. `warn` adds an activity note and lets it through.

## 16. Controls and insights (Sprint 4.4)

- **Auditor** system role: every `*.read` permission, including the audit trail.
- Maker-checker on journals and money vouchers uses the existing approval rules: add a rule for `journal_entry`, `receipt` or `payment`.
- **Journal anomalies** (`GET /accounting/anomalies`), over manual journal lines (not closing, reversal or repeat journals):
  - Amount more than 3σ above the account's history.
  - Round amounts of ₹1 lakh or more.
  - Entered on a Sunday or outside 07:00–21:00 IST.
  - Back-dated by more than 30 days.
  - A user's first posting to an account (≥ ₹50,000).
  - Also: cash payments above ₹10,000 (s.40A(3)).
- **Cash forecast** (`GET /accounting/cash-forecast?weeks`):
  - Starts from today's bank + cash.
  - Open receivables are expected by due date, shifted by the customer's average payment delay. Overdue amounts fall in week 1.
  - Open payables go out by due date.
  - Weekly closing balance, with the lowest point flagged.
