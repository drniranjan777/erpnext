# Module spec: Finance & Accounting (Phase 4)

| | |
|---|---|
| **Status** | Sprints 4.1 and 4.2 (7 Oct 2026) done: general ledger; receivables, payables, cash and bank |
| **Code** | `backend/src/modules/accounting/`, `database/src/schema/{accounting,banking}.ts` (migrations 0015–0017), `frontend/src/app/(app)/accounting/` |
| **Tests** | `backend/test/e2e/{accounting,money}.e2e.test.ts`, `backend/test/unit/bank-statement.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **4.1** ✅ | Chart of accounts (Schedule III) · cost centres · append-only general ledger · posting rules from every module · journal vouchers (manual, opening, reversing, recurring) · period lock · back-posting · trial balance, ledger, day book |
| **4.2** ✅ | Receipts and payments with bill-wise allocation, advances, on-account · cash, bank and contra vouchers · cheques / PDC · bank statement import and auto-reconciliation · customer statements, dunning, interest · payment proposals (due date, MSME), bank files · bad-debt write-off |
| 4.3 | GSTR-1 JSON, GSTR-3B, GSTR-2B reconciliation, GST set-off and challan · TDS / TCS returns (26Q / 27Q, 16A) · fixed assets: register, capitalisation, depreciation (Companies Act and Income-tax books), disposal |
| 4.4 | P&L, Balance Sheet (Schedule III), cash flow, ratios, comparatives · year-end close · budgets and budget control on PR / PO · multi-currency revaluation · maker-checker, auditor role, close checklist · AI: journal anomalies, cash-flow forecast |

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
