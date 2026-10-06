/**
 * Built-in print templates (Handlebars). Tenants start from these in the print
 * designer. Available helpers: money, qty, date, datetime, eq, gt, upper, inc, words (rupees in words).
 */

export const BASE_CSS = `
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #000; margin: 0; }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 14px; margin: 0; text-transform: uppercase; letter-spacing: .04em; }
.header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; }
.right { text-align: right; }
.mono { font-family: Consolas, "Courier New", monospace; }
.muted { color: #555; }
.label { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
.wide { grid-column: span 3; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 16px; }
table.lines th { text-align: left; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 6px 5px 0; }
table.lines td { border-bottom: 1px solid #ccc; padding: 5px 6px 5px 0; vertical-align: top; }
table.lines .num { text-align: right; font-variant-numeric: tabular-nums; }
table.lines tfoot td { border-bottom: 2px solid #000; font-weight: 700; }
.signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 48px; text-align: center; }
.signatures .line { border-top: 1px solid #000; padding-top: 4px; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px; }
.box { border: 1px solid #ccc; padding: 8px 10px; }
.totals { margin-left: auto; width: 46%; margin-top: 10px; border-collapse: collapse; }
.totals td { padding: 3px 0; }
.totals .grand td { border-top: 2px solid #000; font-weight: 700; font-size: 13px; }
.footer { margin-top: 28px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 10px; color: #777; }
`;

export const DEFAULT_TEMPLATES: Record<string, string> = {
  purchase_requisition: `<div class="header">
  <div>
    <h1>{{company.name}}</h1>
    {{#if branch}}<div>{{branch.name}}</div>{{/if}}
    {{#if company.gstin}}<div class="muted">GSTIN: {{company.gstin}}</div>{{/if}}
  </div>
  <div class="right">
    <h2>Purchase Requisition</h2>
    <div class="mono">{{doc.displayNumber}}</div>
    <div>Status: {{doc.statusLabel}}</div>
  </div>
</div>

<div class="grid">
  <div><div class="label">Date</div>{{date doc.docDate}}</div>
  <div><div class="label">Required by</div>{{date requiredBy}}</div>
  <div><div class="label">Priority</div>{{upper priority}}</div>
  <div><div class="label">Department</div>{{#if department}}{{department}}{{else}}—{{/if}}</div>
  <div><div class="label">Requested by</div>{{doc.createdBy}}</div>
  <div><div class="label">Fiscal year</div>{{doc.fiscalYear}}</div>
  {{#if purpose}}<div class="wide"><div class="label">Purpose</div>{{purpose}}</div>{{/if}}
  {{#each customFields}}<div><div class="label">{{label}}</div>{{value}}</div>{{/each}}
</div>

<table class="lines">
  <thead><tr><th>#</th><th>Item / description</th><th class="num">Qty</th><th>Unit</th><th class="num">Est. rate</th><th class="num">Amount</th></tr></thead>
  <tbody>
    {{#each lines}}
    <tr>
      <td>{{lineNo}}</td>
      <td>{{description}}{{#if remarks}}<div class="muted">{{remarks}}</div>{{/if}}</td>
      <td class="num">{{qty quantity}}</td>
      <td>{{uom}}</td>
      <td class="num">{{money estimatedRate}}</td>
      <td class="num">{{money estimatedAmount}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot><tr><td colspan="5" class="num">Estimated total</td><td class="num">{{money doc.amount}}</td></tr></tfoot>
</table>

{{#if notes}}<p><strong>Notes</strong><br>{{notes}}</p>{{/if}}

<div class="signatures">
  <div><div style="height:36px"></div><div class="line"><strong>{{doc.createdBy}}</strong><div class="label">Requested by</div></div></div>
  {{#each approvals}}
  <div><div style="height:36px"></div><div class="line"><strong>{{actedBy}}</strong><div class="label">Approved: {{name}} · {{date actedAt}}</div></div></div>
  {{else}}
  <div><div style="height:36px"></div><div class="line"><strong>{{#if (eq doc.status "approved")}}Auto-approved{{else}}&nbsp;{{/if}}</strong><div class="label">Approved by</div></div></div>
  {{/each}}
</div>

<div class="footer">Printed by {{printedBy}} on {{datetime printedAt}} · NextGen ERP</div>`,
  purchase_order: `<div class="header">
  <div>
    <h1>{{company.name}}</h1>
    {{#if company.legalName}}<div>{{company.legalName}}</div>{{/if}}
    {{#if company.gstin}}<div class="muted">GSTIN: {{company.gstin}}</div>{{/if}}
  </div>
  <div class="right">
    <h2>Purchase Order</h2>
    <div class="mono">{{doc.displayNumber}}</div>
    <div>Date: {{date doc.docDate}}</div>
    {{#if doc.expectedDate}}<div>Delivery by: {{date doc.expectedDate}}</div>{{/if}}
  </div>
</div>

<div class="parties">
  <div class="box">
    <div class="label">Supplier</div>
    <strong>{{vendor.name}}</strong> <span class="muted">({{vendor.code}})</span>
    {{#if vendor.address.line1}}<div>{{vendor.address.line1}}{{#if vendor.address.line2}}, {{vendor.address.line2}}{{/if}}</div>
    <div>{{vendor.address.city}}{{#if vendor.address.pincode}} – {{vendor.address.pincode}}{{/if}}</div>{{/if}}
    {{#if vendor.gstin}}<div>GSTIN: <span class="mono">{{vendor.gstin}}</span></div>{{else}}<div class="muted">Unregistered</div>{{/if}}
    {{#if doc.vendorQuoteRef}}<div>Your quotation: {{doc.vendorQuoteRef}}</div>{{/if}}
  </div>
  <div class="box">
    <div class="label">Deliver to</div>
    {{#if deliveryWarehouse}}<strong>{{deliveryWarehouse.name}}</strong> <span class="muted">({{deliveryWarehouse.code}})</span>
    {{#if deliveryWarehouse.address.line1}}<div>{{deliveryWarehouse.address.line1}}, {{deliveryWarehouse.address.city}}</div>{{/if}}{{else}}As advised{{/if}}
    <div>Place of supply: {{doc.placeOfSupply}}</div>
    {{#if doc.paymentTerms}}<div>Payment: {{doc.paymentTerms}}</div>{{else}}{{#if doc.creditDays}}<div>Payment: {{doc.creditDays}} days credit</div>{{/if}}{{/if}}
  </div>
</div>

<table class="lines">
  <thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Disc %</th><th class="num">Taxable</th><th class="num">GST %</th><th class="num">Amount</th></tr></thead>
  <tbody>
    {{#each lines}}
    <tr>
      <td>{{lineNo}}</td>
      <td>{{description}}<div class="muted mono">{{itemCode}}</div>{{#if deliveryDate}}<div class="muted">By {{date deliveryDate}}</div>{{/if}}</td>
      <td class="mono">{{hsnCode}}</td>
      <td class="num">{{qty qty}}</td>
      <td>{{uomCode}}</td>
      <td class="num">{{money rate}}</td>
      <td class="num">{{#if (gt discountPct 0)}}{{discountPct}}{{/if}}</td>
      <td class="num">{{money taxableValue}}</td>
      <td class="num">{{gstRate}}</td>
      <td class="num">{{money lineTotal}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>

<table class="totals">
  <tr><td>Taxable value</td><td class="right">{{money doc.taxableTotal}}</td></tr>
  {{#if (gt doc.cgstTotal 0)}}<tr><td>CGST</td><td class="right">{{money doc.cgstTotal}}</td></tr><tr><td>{{stateTaxLabel}}</td><td class="right">{{money doc.sgstTotal}}</td></tr>{{/if}}
  {{#if (gt doc.igstTotal 0)}}<tr><td>IGST</td><td class="right">{{money doc.igstTotal}}</td></tr>{{/if}}
  {{#if (gt doc.cessTotal 0)}}<tr><td>Cess</td><td class="right">{{money doc.cessTotal}}</td></tr>{{/if}}
  {{#if doc.reverseCharge}}<tr><td>GST payable by us (reverse charge)</td><td class="right">{{money doc.reverseChargeTax}}</td></tr>{{/if}}
  <tr><td>Round off</td><td class="right">{{money doc.roundOff}}</td></tr>
  <tr class="grand"><td>Order total</td><td class="right">{{money doc.grandTotal}}</td></tr>
</table>
<p><strong>{{words doc.grandTotal}}</strong></p>
{{#each doc.taxNotes}}<p class="muted">{{this}}</p>{{/each}}
{{#if doc.terms}}<p><strong>Terms &amp; conditions</strong><br>{{doc.terms}}</p>{{/if}}
{{#if doc.notes}}<p><strong>Notes</strong><br>{{doc.notes}}</p>{{/if}}
{{#each customFields}}<div><span class="label">{{label}}</span> {{value}}</div>{{/each}}

<div class="signatures">
  <div><div style="height:36px"></div><div class="line"><strong>{{doc.createdBy}}</strong><div class="label">Prepared by</div></div></div>
  {{#each approvals}}
  <div><div style="height:36px"></div><div class="line"><strong>{{actedBy}}</strong><div class="label">Approved: {{name}}</div></div></div>
  {{else}}
  <div><div style="height:36px"></div><div class="line"><strong>&nbsp;</strong><div class="label">Approved by</div></div></div>
  {{/each}}
  <div><div style="height:36px"></div><div class="line"><strong>For {{company.name}}</strong><div class="label">Authorised signatory</div></div></div>
</div>

<div class="footer">Please quote our PO number on your invoice and delivery challan. Printed by {{printedBy}} on {{datetime printedAt}} · NextGen ERP</div>`,
  debit_note: `<div class="header">
  <div>
    <h1>{{company.name}}</h1>
    {{#if company.legalName}}<div>{{company.legalName}}</div>{{/if}}
    {{#if company.gstin}}<div class="muted">GSTIN: {{company.gstin}}</div>{{/if}}
  </div>
  <div class="right">
    <h2>Debit Note</h2>
    <div class="mono">{{doc.displayNumber}}</div>
    <div>Date: {{date doc.docDate}}</div>
  </div>
</div>

<div class="parties">
  <div class="box">
    <div class="label">Issued to (supplier)</div>
    <strong>{{vendor.name}}</strong>
    {{#if vendor.gstin}}<div>GSTIN: <span class="mono">{{vendor.gstin}}</span></div>{{/if}}
  </div>
  <div class="box">
    <div class="label">Against your invoice</div>
    <strong class="mono">{{invoice.supplierInvoiceNo}}</strong> dated {{date invoice.supplierInvoiceDate}}
    <div>Reason: {{doc.reason}}</div>
    <div>Place of supply: {{doc.placeOfSupply}}</div>
  </div>
</div>

<table class="lines">
  <thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Taxable</th><th class="num">GST %</th><th class="num">Amount</th></tr></thead>
  <tbody>
    {{#each lines}}
    <tr><td>{{lineNo}}</td><td>{{description}}{{#if batchNo}}<div class="muted mono">Batch {{batchNo}}</div>{{/if}}</td><td class="mono">{{hsnCode}}</td><td class="num">{{qty qty}}</td><td>{{uomCode}}</td><td class="num">{{money rate}}</td><td class="num">{{money taxableValue}}</td><td class="num">{{gstRate}}</td><td class="num">{{money lineTotal}}</td></tr>
    {{/each}}
  </tbody>
</table>

<table class="totals">
  <tr><td>Taxable value</td><td class="right">{{money doc.taxableTotal}}</td></tr>
  {{#if (gt doc.cgstTotal 0)}}<tr><td>CGST</td><td class="right">{{money doc.cgstTotal}}</td></tr><tr><td>{{stateTaxLabel}}</td><td class="right">{{money doc.sgstTotal}}</td></tr>{{/if}}
  {{#if (gt doc.igstTotal 0)}}<tr><td>IGST</td><td class="right">{{money doc.igstTotal}}</td></tr>{{/if}}
  {{#if (gt doc.cessTotal 0)}}<tr><td>Cess</td><td class="right">{{money doc.cessTotal}}</td></tr>{{/if}}
  <tr><td>Round off</td><td class="right">{{money doc.roundOff}}</td></tr>
  <tr class="grand"><td>Total debited</td><td class="right">{{money doc.grandTotal}}</td></tr>
</table>
<p><strong>{{words doc.grandTotal}}</strong></p>
{{#if (eq doc.kind "return")}}<p class="muted">Goods returned{{#if doc.vehicleNo}} by vehicle {{doc.vehicleNo}}{{/if}}. Please issue a credit note for the above.</p>{{else}}<p class="muted">Price adjustment. Please issue a credit note for the above.</p>{{/if}}

<div class="signatures">
  <div><div style="height:36px"></div><div class="line"><strong>{{doc.createdBy}}</strong><div class="label">Prepared by</div></div></div>
  <div></div>
  <div><div style="height:36px"></div><div class="line"><strong>For {{company.name}}</strong><div class="label">Authorised signatory</div></div></div>
</div>
<div class="footer">Printed by {{printedBy}} on {{datetime printedAt}} · NextGen ERP</div>`,
  purchase_invoice: `<div class="header">
  <div><h1>{{company.name}}</h1><div class="muted">Purchase bill voucher</div></div>
  <div class="right"><h2>Purchase Invoice</h2><div class="mono">{{doc.displayNumber}}</div><div>Entered: {{date doc.docDate}}</div></div>
</div>
<div class="grid">
  <div><div class="label">Vendor</div>{{vendor.name}}{{#if vendor.gstin}}<div class="mono muted">{{vendor.gstin}}</div>{{/if}}</div>
  <div><div class="label">Supplier invoice</div><span class="mono">{{doc.supplierInvoiceNo}}</span> · {{date doc.supplierInvoiceDate}}</div>
  <div><div class="label">Due</div>{{date doc.dueDate}}</div>
  <div><div class="label">Match</div>{{doc.matchType}}</div>
  <div><div class="label">ITC eligible / not</div>{{money doc.itcEligibleTax}} / {{money doc.itcIneligibleTax}}</div>
  <div><div class="label">TDS</div>{{#if doc.tdsSection}}{{doc.tdsSection}} @ {{doc.tdsRate}}% = {{money doc.tdsAmount}}{{else}}—{{/if}}</div>
</div>
<table class="lines">
  <thead><tr><th>#</th><th>Item</th><th>GRN</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Taxable</th><th class="num">GST %</th><th class="num">Amount</th><th class="num">Variance</th></tr></thead>
  <tbody>{{#each lines}}<tr><td>{{lineNo}}</td><td>{{description}}<div class="muted mono">{{itemCode}}</div></td><td class="mono">{{grnNumber}}</td><td class="num">{{qty qty}} {{uomCode}}</td><td class="num">{{money rate}}</td><td class="num">{{money taxableValue}}</td><td class="num">{{gstRate}}</td><td class="num">{{money lineTotal}}</td><td class="num">{{money rateVariance}}</td></tr>{{/each}}</tbody>
</table>
<table class="totals">
  <tr><td>Taxable value</td><td class="right">{{money doc.taxableTotal}}</td></tr>
  <tr><td>GST</td><td class="right">{{money doc.taxTotal}}</td></tr>
  {{#if doc.reverseCharge}}<tr><td>GST under reverse charge (we pay)</td><td class="right">{{money doc.reverseChargeTax}}</td></tr>{{/if}}
  <tr><td>Round off</td><td class="right">{{money doc.roundOff}}</td></tr>
  <tr><td>Bill total</td><td class="right">{{money doc.grandTotal}}</td></tr>
  <tr><td>Less TDS</td><td class="right">{{money doc.tdsAmount}}</td></tr>
  <tr class="grand"><td>Payable</td><td class="right">{{money doc.netPayable}}</td></tr>
</table>
{{#if doc.varianceNote}}<p><strong>Rate variance:</strong> {{doc.varianceNote}}</p>{{/if}}
<div class="footer">Printed by {{printedBy}} on {{datetime printedAt}} · NextGen ERP</div>`,
  goods_receipt: `<div class="header">
  <div>
    <h1>{{company.name}}</h1>
    {{#if branch}}<div>{{branch.name}}</div>{{/if}}
  </div>
  <div class="right">
    <h2>Goods Receipt Note</h2>
    <div class="mono">{{doc.displayNumber}}</div>
    <div>Date: {{date doc.docDate}}</div>
  </div>
</div>

<div class="grid">
  <div><div class="label">Supplier</div>{{vendor.name}}{{#if vendor.gstin}}<div class="mono muted">{{vendor.gstin}}</div>{{/if}}</div>
  <div><div class="label">Purchase order</div>{{doc.purchaseOrder.number}}</div>
  <div><div class="label">Received into</div>{{doc.warehouse.code}} · {{doc.warehouse.name}}</div>
  <div><div class="label">Supplier invoice</div>{{#if doc.supplierInvoiceNo}}{{doc.supplierInvoiceNo}} · {{date doc.supplierInvoiceDate}}{{else}}—{{/if}}</div>
  <div><div class="label">Challan / gate entry</div>{{#if doc.challanNo}}{{doc.challanNo}}{{else}}—{{/if}}{{#if doc.gateEntryNo}} · GE {{doc.gateEntryNo}}{{/if}}</div>
  <div><div class="label">Vehicle / LR</div>{{#if doc.vehicleNo}}{{doc.vehicleNo}}{{else}}—{{/if}}{{#if doc.lrNo}} · LR {{doc.lrNo}}{{/if}}</div>
</div>

<table class="lines">
  <thead><tr><th>#</th><th>Item</th><th>Batch</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Rejected</th><th class="num">Accepted</th><th>Unit</th><th class="num">Value</th></tr></thead>
  <tbody>
    {{#each lines}}
    <tr>
      <td>{{lineNo}}</td>
      <td>{{itemName}}<div class="muted mono">{{itemCode}}</div>{{#if rejectionReason}}<div class="muted">Rejected: {{rejectionReason}}</div>{{/if}}</td>
      <td class="mono">{{batchNo}}{{#if expiryDate}}<div class="muted">exp {{date expiryDate}}</div>{{/if}}</td>
      <td class="num">{{qty orderedQty}}</td>
      <td class="num">{{qty receivedQty}}</td>
      <td class="num">{{qty rejectedQty}}</td>
      <td class="num">{{qty acceptedQty}}</td>
      <td>{{uomCode}}</td>
      <td class="num">{{money amount}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot><tr><td colspan="8" class="num">Accepted value (before GST)</td><td class="num">{{money doc.amount}}</td></tr></tfoot>
</table>
{{#if doc.notes}}<p><strong>Notes</strong><br>{{doc.notes}}</p>{{/if}}

<div class="signatures">
  <div><div style="height:36px"></div><div class="line"><strong>{{doc.createdBy}}</strong><div class="label">Received by (stores)</div></div></div>
  <div><div style="height:36px"></div><div class="line"><strong>&nbsp;</strong><div class="label">Inspected by (QC)</div></div></div>
  <div><div style="height:36px"></div><div class="line"><strong>&nbsp;</strong><div class="label">Store in-charge</div></div></div>
</div>

<div class="footer">Printed by {{printedBy}} on {{datetime printedAt}} · NextGen ERP</div>`,
};

/** Sample data used to preview a template when the workspace has no documents yet. */
export const SAMPLE_CONTEXT: Record<string, Record<string, unknown>> = {
  purchase_order: {
    company: { name: 'Sample Industries Pvt Ltd', legalName: null, gstin: '36AABCS1234E1ZU' },
    vendor: { name: 'Sharma Polymers', code: 'VEN00001', gstin: '36AABCD1234E1Z9', address: { line1: 'Plot 14, IDA Jeedimetla', city: 'Hyderabad', pincode: '500055' } },
    deliveryWarehouse: { code: 'MAIN', name: 'Main store', address: {} },
    stateTaxLabel: 'SGST',
    doc: {
      displayNumber: 'PO/HO/26-27/0007',
      docDate: '2026-10-06',
      expectedDate: '2026-10-15',
      vendorQuoteRef: 'Q-2291',
      placeOfSupply: '36',
      creditDays: 30,
      paymentTerms: null,
      taxableTotal: '118750.00',
      cgstTotal: '10687.50',
      sgstTotal: '10687.50',
      igstTotal: '0.00',
      cessTotal: '0.00',
      reverseCharge: false,
      reverseChargeTax: '0.00',
      roundOff: '0.00',
      grandTotal: '140125.00',
      taxNotes: [],
      terms: 'Material must carry a test certificate. Delivery Monday to Saturday, 9 am to 5 pm.',
      notes: null,
      createdBy: 'Ravi Kumar',
    },
    lines: [
      { lineNo: 1, description: 'PP homopolymer granules H110', itemCode: 'RM-PP-H110', hsnCode: '39021000', qty: '40', uomCode: 'BAG', rate: '2968.75', discountPct: '0', taxableValue: '118750.00', gstRate: '18.00', lineTotal: '140125.00', deliveryDate: null },
    ],
    customFields: [],
    approvals: [{ name: 'Purchase head', actedBy: 'Suresh Reddy' }],
    printedBy: 'Ravi Kumar',
    printedAt: '2026-10-06T11:00:00Z',
  },
  purchase_requisition: {
    company: { name: 'Sample Industries Pvt Ltd', gstin: '36AABCS1234E1ZU' },
    branch: { code: 'HO', name: 'Head Office' },
    doc: {
      displayNumber: 'PR/HO/26-27/0042',
      statusLabel: 'Approved',
      status: 'approved',
      docDate: '2026-10-05',
      fiscalYear: '2026-27',
      amount: '158746.88',
      createdBy: 'Ravi Kumar',
    },
    requiredBy: '2026-10-20',
    priority: 'high',
    department: 'Production',
    purpose: 'Raw material for injection moulding, October batch',
    notes: 'Deliver to Gate 2 stores.',
    customFields: [{ label: 'Cost centre', value: 'Moulding' }],
    lines: [
      { lineNo: 1, description: 'PP granules, homopolymer', remarks: 'MFI 12', quantity: '1250.5', uom: 'KG', estimatedRate: '118.75', estimatedAmount: '148496.88' },
      { lineNo: 2, description: 'Masterbatch, blue', remarks: null, quantity: '25', uom: 'KG', estimatedRate: '410', estimatedAmount: '10250.00' },
    ],
    approvals: [{ name: 'Plant head', actedBy: 'Suresh Reddy', actedAt: '2026-10-05T10:30:00Z' }],
    printedBy: 'Ravi Kumar',
    printedAt: '2026-10-05T11:00:00Z',
  },
};

/** Our own GST tax invoice for the SaaS subscription (rendered by BillingService). */
export const SAAS_INVOICE_TEMPLATE = `<div class="header">
  <div>
    <h1>{{seller.name}}</h1>
    <div>{{seller.address}}</div>
    <div class="muted">GSTIN: {{seller.gstin}} · State code {{seller.stateCode}}</div>
  </div>
  <div class="right">
    <h2>Tax Invoice</h2>
    <div class="mono">{{invoice.number}}</div>
    <div>Date: {{date invoice.invoiceDate}}</div>
    <div>Status: {{upper invoice.status}}</div>
  </div>
</div>

<div class="grid">
  <div class="wide"><div class="label">Billed to</div><strong>{{invoice.buyerName}}</strong>{{#if invoice.buyerGstin}}<br>GSTIN: {{invoice.buyerGstin}}{{/if}}</div>
  <div><div class="label">Place of supply</div>{{#if invoice.placeOfSupply}}State code {{invoice.placeOfSupply}}{{else}}—{{/if}}</div>
  <div><div class="label">Service period</div>{{date invoice.periodStart}} – {{date invoice.periodEnd}}</div>
  <div><div class="label">Payment reference</div>{{#if invoice.providerPaymentId}}{{invoice.providerPaymentId}}{{else}}—{{/if}}</div>
</div>

<table class="lines">
  <thead><tr><th>Description</th><th>SAC</th><th class="num">Taxable value</th></tr></thead>
  <tbody><tr><td>{{invoice.description}}</td><td>{{invoice.sacCode}}</td><td class="num">{{money invoice.taxableAmount}}</td></tr></tbody>
  <tfoot>
    {{#if intraState}}
    <tr><td colspan="2" class="num">CGST @ 9%</td><td class="num">{{money invoice.cgst}}</td></tr>
    <tr><td colspan="2" class="num">SGST @ 9%</td><td class="num">{{money invoice.sgst}}</td></tr>
    {{else}}
    <tr><td colspan="2" class="num">IGST @ 18%</td><td class="num">{{money invoice.igst}}</td></tr>
    {{/if}}
    <tr><td colspan="2" class="num">Total</td><td class="num">{{money invoice.total}}</td></tr>
  </tfoot>
</table>

<p class="muted" style="margin-top:16px">This is a computer-generated invoice. Tax is not payable on reverse charge.</p>
<div class="footer">{{seller.name}} · NextGen ERP</div>`;
