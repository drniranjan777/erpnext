# Module spec: Finance & Accounting (Phase 4)

| | |
|---|---|
| **Status** | Sprint 4.1 (7 Oct 2026) done: general ledger core |
| **Code** | `backend/src/modules/accounting/`, `database/src/schema/accounting.ts` (migration 0015), `frontend/src/app/(app)/accounting/` |
| **Tests** | `backend/test/e2e/accounting.e2e.test.ts` |

## Sprint plan

| Sprint | Scope |
|---|---|
| **4.1** ✅ | Chart of accounts (Schedule III) · cost centres · append-only general ledger · posting rules from every module · journal vouchers (manual, opening, reversing, recurring) · period lock · back-posting · trial balance, ledger, day book |
| 4.2 | Receipts and payments with bill-wise allocation, advances, on-account · cash, bank and contra vouchers · cheques / PDC · bank statement import and auto-reconciliation · customer statements, dunning, interest · payment proposals (due date, MSME), bank files · bad-debt write-off |
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
