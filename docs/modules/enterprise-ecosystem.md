# Module spec: Enterprise scale and ecosystem (Phase 15)

| | |
|---|---|
| **Status** | In progress: 15.1 done |
| **Plan** | `docs/PHASE_PLAN.md`, Phase 15 |

Phase 15 brings larger customers, partners and an ecosystem. Most of it is software built and tested here. Some parts are not code and stay with the business: the SOC 2 Type II report, ISO 27001 certification, partner certification, the first enterprise tenant, and store listings of native apps. The sprints below also say where an outside service needs credentials that do not exist in development; the integration is then built against a local sandbox adapter, the same way the GST network was in Phase 3.

## Sprint plan

| Sprint | Scope |
|---|---|
| 15.1 | **Enterprise finance**: inter-company transactions mirrored into the other company's books, inter-company reconciliation, consolidation of a group (eliminations, goodwill, non-controlling interest) in Ind AS (Schedule III Division II) layout, treasury (term loans with EMI schedules, fixed deposits, LC / BG under bank facilities, monthly interest accruals), cost allocation from service cost centres |
| 15.2 | **Project systems**: projects with a WBS, budgets by WBS and cost type, milestones and milestone billing, resource planning, project procurement and time booked to WBS elements, actual cost, earned value (CPI / SPI) |
| 15.3 | **PLM-lite and document management**: item lifecycle stages with gated transitions, design BOM vs manufacturing BOM, CAD file vault with metadata, versions and check-out; central document store with folders, versions, full-text search, retention policies and legal hold, digital signing through a signing provider (local sandbox; Aadhaar eSign / DSC adapters later) |
| 15.4 | **White-label and partners**: branding (logo, colours, product name), custom domain with DNS verification, email and SMS sender identities, partners (resellers / implementers), partner-managed tenants, commissions on subscription revenue, partner portal |
| 15.5 | **Marketplace and automation**: connector framework and app marketplace (install, configure, run, logs) with connectors for Tally, Shopify, marketplace orders, IndiaMART leads, Shiprocket, bank host-to-host and payment gateways (sandbox adapters where credentials are needed), a typed public SDK, and low-code workflow automation (trigger → conditions → actions) |
| 15.6 | **Enterprise platform**: single sign-on (OIDC; SAML metadata), SCIM 2.0 user and group provisioning, sandbox tenants copied from production, tenant export / import for migration and data residency, deployment kit (container images, Helm chart), read-replica routing and table partitioning |
| 15.7 | **POS and mobile**: showroom / factory-outlet point of sale (offline, barcode, tenders, B2C GST invoice, returns, day close), and the mobile app shell for owners (dashboards, approvals) as an installable app |

Exit target (from the phase plan): an enterprise tenant with 1,000 users and 5 companies live, a SOC 2 Type II report, 10 marketplace connectors, 5 certified implementation partners.

## 15.1 Enterprise finance (done)

Migration 0065 adds `intercompany_links`, `intercompany_transactions`, `consolidation_groups`, `treasury_instruments` and `allocation_rules` (schema `enterprise.ts`). The chart template gains system accounts that existing companies receive on first use: inter-company receivables (5440) and payables (3370), inter-company income (6550) and charges (9596), term loans (2110), interest accrued on borrowings (3380), interest on term loans (8530), fixed deposits (5520), interest accrued on deposits (5530), margin money (5540) and investments in subsidiaries (4300). Code: `backend/src/modules/enterprise/` (`finance-rules.ts` is pure and unit tested). Permissions: `finance.group.manage`, `finance.group.read`, `finance.treasury.manage`, `finance.treasury.read`. Pages: `/accounting/intercompany`, `/accounting/consolidation`, `/accounting/treasury`, `/accounting/allocations`.

**Inter-company.** Each company of the group is linked to the party that stands for it in the other companies' books. A transaction (charge, sale, loan, repayment, other) is posted at once in both: the sender is owed by the receiver (inter-company receivable against the receiver's party, with inter-company income or the chosen account), and the receiver owes the sender (inter-company payable, with inter-company charges or the chosen account). Loans and repayments move money, so a bank account is required in each company. The reconciliation shows, for each pair, what each company holds against the other on a date; the two should cancel out.

**Consolidation** (Ind AS 110, full consolidation; Schedule III Division II layout). A group has a parent and subsidiaries, each with the share held, the cost of the investment and the acquisition date. The statements add the members' balances line by line after removing every ledger line against a group company's party and the other side of inter-company journals. The parent's investment is replaced by goodwill (cost less the parent's share of the subsidiary's net assets on acquisition; a negative figure is a capital reserve). The non-controlling interest is its share of each subsidiary's net assets in equity, and its share of the subsidiary's profit below the profit line. Owners' equity is share capital of the parent and other equity. Year-end closing journals are left out of the profit and loss. If inter-company balances do not match, the difference left after elimination is shown. Not covered yet: unrealised profit on inter-company stock, other currencies, associates and joint ventures (equity method).

**Treasury.** Term loans (EMI or bullet) with their repayment schedule, outstanding principal and next instalment; fixed deposits compounded quarterly or monthly, or at simple interest, with today's value and maturity value; non-fund facilities with the LCs and BGs drawn on them (an LC or BG is refused if the facility does not have room), margin money and expiry within 30 days. Posting the month's interest makes one journal per instrument (loans: interest on term loans against interest accrued; deposits: interest accrued against interest income), once per instrument and month.

**Cost allocation.** A rule moves the expenses booked to a service cost centre in a month to the cost centres it serves, account by account, by weights (percentage, floor area, head count, machine hours); the split adds up to the paisa. Each rule runs once per month.
