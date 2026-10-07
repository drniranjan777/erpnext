export interface HelpArticle {
  slug: string;
  title: string;
  area: string;
  summary: string;
  sections: { heading?: string; text?: string; steps?: string[] }[];
  links?: { label: string; href: string }[];
}

/** Help centre articles. Plain text, so they render the same everywhere and search simply. */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    area: "Basics",
    summary: "From sign-up to your first invoice in an afternoon.",
    sections: [
      {
        steps: [
          "Add your company GSTIN and address under Settings → Companies.",
          "Open Set up your workspace and apply your industry template: it adds stores, item groups and work centres.",
          "Add items, customers and vendors, or import them from Excel or Tally under Masters → Import.",
          "Enter opening stock with a stock entry of purpose Opening stock.",
          "Set up the books under Accounts → Settings with your start date. The chart of accounts is created for you.",
          "Invite your team under Settings → Users and give each person a role.",
        ],
      },
      { text: "The checklist on the dashboard ticks each step when it is really done, so you always know what is left." },
    ],
    links: [{ label: "Set up your workspace", href: "/setup" }],
  },
  {
    slug: "documents-and-approvals",
    title: "Drafts, approvals and cancelling",
    area: "Basics",
    summary: "How every document moves from draft to posted.",
    sections: [
      { text: "Every document starts as a draft you can edit or delete. Submitting gives it a number and either approves it straight away or sends it for approval, if an approval rule matches." },
      { heading: "Approvals", text: "Approvers see waiting documents under Approvals and in their notifications. A rejected document goes back to draft with the reason in its activity." },
      { heading: "After approval", text: "Approved documents post stock and accounts and cannot be edited. To correct one, cancel it with a reason and create a new one; the postings are reversed." },
    ],
    links: [{ label: "Approval workflows", href: "/settings/approval-workflows" }],
  },
  {
    slug: "gst-invoicing",
    title: "GST invoices, e-invoices and e-way bills",
    area: "Sales",
    summary: "Tax is worked out for you; IRN and e-way bills are a click away.",
    sections: [
      { text: "CGST + SGST or IGST is chosen from your GSTIN and the place of supply. HSN, rates and cess come from the item." },
      { heading: "E-invoice", text: "From an approved invoice, generate the IRN. The signed QR prints on the invoice. Cancel within 24 hours if needed." },
      { heading: "E-way bill", text: "Generate it from the invoice or delivery with vehicle and distance; validity is one day per 200 km." },
      { heading: "Returns", text: "GSTR-1, GSTR-3B with set-off, GSTR-2B matching and the HSN summary are under GST." },
    ],
    links: [{ label: "GSTR-1", href: "/gst/gstr1" }],
  },
  {
    slug: "purchase-cycle",
    title: "Buying: requisition to payment",
    area: "Purchase",
    summary: "Requisition, order, goods receipt, bill, payment, with three-way matching.",
    sections: [
      {
        steps: [
          "Raise a purchase requisition, or let the reorder report raise one.",
          "Convert it into a purchase order for a vendor; approval rules and budgets apply.",
          "Record the goods receipt against the order: accepted and rejected quantities, batches.",
          "Enter the vendor's bill against the receipt; rates are matched against the order.",
          "Pay from Accounts → Payments, bill by bill. MSME bills show their 45-day limit.",
        ],
      },
    ],
    links: [{ label: "Pending purchase orders", href: "/reports/pending-purchase-orders" }],
  },
  {
    slug: "production",
    title: "Making things: BOMs and work orders",
    area: "Production",
    summary: "Bills of materials, releasing work orders, booking the shop floor and closing.",
    sections: [
      { heading: "Engineering", text: "Define work centres with hourly rates, then a BOM with components, scrap %, routing and job-work steps. Approving it fixes the standard cost." },
      { heading: "Work orders", text: "Create a work order (or make to order from a sales order). Releasing checks materials against stock less other orders' reservations." },
      { heading: "Shop floor", text: "Issue materials, book job cards (time, good and rejected pieces) on the shop-floor board or the tablet kiosk, receive output, then close the order: what is left in WIP becomes a production variance." },
    ],
    links: [
      { label: "Work orders", href: "/manufacturing/work-orders" },
      { label: "Shop-floor kiosk", href: "/manufacturing/kiosk" },
    ],
  },
  {
    slug: "planning",
    title: "Forecasting and MRP",
    area: "Planning",
    summary: "Forecast demand, run MRP, act on exception messages and turn planned orders into requisitions and work orders.",
    sections: [
      { heading: "Forecast", text: "“Forecast from history” looks at monthly sales orders and, for each item, picks the method that would have predicted its recent months best: moving average, smoothing, trend, or trend with seasonality once there are two years of history. Overtype any month to override it; re-forecasting keeps your figure." },
      { heading: "Item settings", text: "On each item's planning page set make or buy, lead time, safety stock, minimum order and the lot rule: lot for lot, fixed lot, economic order quantity, min / max or a number of days per order." },
      {
        heading: "Running MRP",
        steps: [
          "Demand is open sales orders, the forecast less orders already booked for the month, and materials still to issue on open work orders.",
          "Supply is stock in nettable stores, open purchase orders, requisitions, work orders and firmed planned orders.",
          "Items are planned level by level: a planned order for a product creates demand for its components on its release date (due date less lead time).",
          "Later receipts are brought forward before anything new is planned; the result is a list of planned orders and exception messages.",
        ],
      },
      { heading: "Acting on the plan", text: "Firm a planned order (or change its quantity or date) to keep it in the next run. Convert selected orders: buys become one draft requisition, makes become draft work orders and formula items draft process batches. Each planned order shows what it is for: a sales order, the forecast, or a parent's planned order." },
    ],
    links: [
      { label: "MRP planning", href: "/planning" },
      { label: "Demand forecast", href: "/planning/forecast" },
    ],
  },
  {
    slug: "quality",
    title: "Quality inspections and traceability",
    area: "Quality",
    summary: "AQL sampling, inspection decisions and tracing any batch.",
    sections: [
      { text: "Inspection plans set what to check and how many to sample (ISO 2859-1 AQL, a fixed number or 100%). Lots are raised on goods receipt, after flagged operations and on production receipt." },
      { text: "Record readings; the lot is suggested for acceptance or rejection. Your decision moves the stock: out of quarantine, or to the rejected store, with a rework order if needed." },
      { heading: "Traceability", text: "Trace a batch or serial backward to vendor lots, or forward to work orders and customers." },
    ],
    links: [{ label: "Traceability", href: "/quality/traceability" }],
  },
  {
    slug: "reports",
    title: "Reports, the report builder and schedules",
    area: "Reports",
    summary: "Sixty-odd ready reports, your own reports, and email delivery.",
    sections: [
      { text: "Every standard report has filters, totals, sorting and export to Excel, CSV or PDF (print)." },
      { heading: "Report builder", text: "Choose the data, columns, filters, period and grouping. Save it for yourself, or share it if you are an administrator." },
      { heading: "Schedules", text: "Have any report emailed daily, weekly or monthly as an attachment, at a time you choose." },
    ],
    links: [
      { label: "Reports", href: "/reports" },
      { label: "Build a report", href: "/reports/builder" },
    ],
  },
  {
    slug: "copilot",
    title: "Using the copilot",
    area: "Basics",
    summary: "Ask questions in English or Hindi; it looks things up and drafts for you.",
    sections: [
      { text: "Press Ask (or Ctrl+J) on any screen. Try “sales this month”, “overdue invoices”, “why is WO/26-27/0003 stuck?” or “draft purchase order from Deccan Steels: 100 hex bolt”." },
      { text: "The copilot sees only what you are allowed to see. It never changes anything by itself: drafts appear as a card, and nothing is created until you press the button." },
      { text: "Without an AI key it answers the common questions; with one, it handles free-form questions too." },
    ],
  },
  {
    slug: "dashboards",
    title: "Dashboards and TV mode",
    area: "Reports",
    summary: "Role dashboards, your own layout, and a big screen for the shop floor.",
    sections: [
      { text: "Your home dashboard is picked from your role. Choose another under the dashboard menu, or press Customise to build and save your own." },
      { text: "TV mode shows any dashboard full-screen with large numbers and refreshes itself, for a screen on the shop floor." },
    ],
    links: [{ label: "Dashboards", href: "/dashboards" }],
  },
  {
    slug: "year-end",
    title: "Month-end and year-end close",
    area: "Accounts",
    summary: "Checklist, period locks, closing the year.",
    sections: [
      { text: "Accounts → Close shows the checklist: unposted documents, bank reconciliation, depreciation, GST returns." },
      { text: "Lock a period once it is final; postings dated in it are refused. Year-end close moves profit to reserves with a closing journal." },
    ],
    links: [{ label: "Close", href: "/accounting/close" }],
  },
];
