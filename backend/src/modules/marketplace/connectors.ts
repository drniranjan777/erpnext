import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The connector catalogue and the pure parts of each connector: field definitions, sample data
 * served by the sandbox, mapping of external records to ours, and signature checks for inbound
 * webhooks. Live calls to outside services need credentials and network access; in this
 * environment every connector runs in sandbox mode unless it only uses our own data (Tally export).
 */

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
}

export interface ConnectorDef {
  key: string;
  name: string;
  category: 'accounting' | 'commerce' | 'crm' | 'logistics' | 'payments' | 'productivity';
  description: string;
  fields: ConnectorField[];
  actions: { key: string; label: string; needs?: 'deliveryId' | 'invoiceId' | 'roleId' }[];
  /** Accepts pushes at /public/connectors/:installationId/webhook. */
  webhook?: boolean;
  /** Works on our own data only, so it is live everywhere. */
  local?: boolean;
}

export const CATALOGUE: ConnectorDef[] = [
  { key: 'tally', name: 'Tally Prime', category: 'accounting', description: 'Export ledgers (customers, vendors) and stock items as Tally XML for import into Tally.', fields: [{ key: 'company', label: 'Tally company name', required: true }], actions: [{ key: 'export_masters', label: 'Export masters (XML)' }], local: true },
  { key: 'shopify', name: 'Shopify', category: 'commerce', description: 'Online store orders become sales orders (items matched by SKU); order webhooks are verified by HMAC.', fields: [{ key: 'shop', label: 'Shop domain (yourstore.myshopify.com)', required: true }, { key: 'token', label: 'Admin API access token', secret: true }], actions: [{ key: 'import_orders', label: 'Import new orders' }], webhook: true },
  { key: 'amazon_seller', name: 'Amazon Seller (SP-API)', category: 'commerce', description: 'Amazon.in orders become sales orders, items matched by seller SKU.', fields: [{ key: 'sellerId', label: 'Seller ID', required: true }, { key: 'refreshToken', label: 'LWA refresh token', secret: true }], actions: [{ key: 'import_orders', label: 'Import new orders' }] },
  { key: 'flipkart_seller', name: 'Flipkart Seller', category: 'commerce', description: 'Flipkart orders become sales orders, items matched by SKU.', fields: [{ key: 'appId', label: 'Application ID', required: true }, { key: 'appSecret', label: 'Application secret', secret: true }], actions: [{ key: 'import_orders', label: 'Import new orders' }] },
  { key: 'indiamart', name: 'IndiaMART Lead Manager', category: 'crm', description: 'Buy-leads and enquiries become CRM leads (pull, or push to the webhook).', fields: [{ key: 'mobile', label: 'Registered mobile', required: true }, { key: 'crmKey', label: 'CRM API key', secret: true }], actions: [{ key: 'import_leads', label: 'Pull new leads' }], webhook: true },
  { key: 'shiprocket', name: 'Shiprocket', category: 'logistics', description: 'Book a shipment for a delivery note and write the courier and AWB number on it.', fields: [{ key: 'email', label: 'API user email', required: true }, { key: 'password', label: 'API user password', secret: true }], actions: [{ key: 'create_shipment', label: 'Book shipment', needs: 'deliveryId' }] },
  { key: 'delhivery', name: 'Delhivery', category: 'logistics', description: 'Create a Delhivery waybill for a delivery note.', fields: [{ key: 'client', label: 'Client name', required: true }, { key: 'token', label: 'API token', secret: true }], actions: [{ key: 'create_shipment', label: 'Create waybill', needs: 'deliveryId' }] },
  { key: 'razorpay_links', name: 'Razorpay Payment Links', category: 'payments', description: 'Create a payment link for the balance of a sales invoice to send to the customer.', fields: [{ key: 'keyId', label: 'Key ID', required: true }, { key: 'keySecret', label: 'Key secret', secret: true }], actions: [{ key: 'payment_link', label: 'Create payment link', needs: 'invoiceId' }] },
  { key: 'google_workspace', name: 'Google Workspace', category: 'productivity', description: 'Invite people from the Google Workspace directory who are not yet users.', fields: [{ key: 'domain', label: 'Primary domain', required: true }, { key: 'serviceAccount', label: 'Service account key (JSON)', secret: true }], actions: [{ key: 'sync_users', label: 'Invite directory users', needs: 'roleId' }] },
  { key: 'microsoft_365', name: 'Microsoft 365', category: 'productivity', description: 'Invite people from Microsoft Entra ID (Azure AD) who are not yet users.', fields: [{ key: 'tenantDomain', label: 'Tenant domain', required: true }, { key: 'clientSecret', label: 'App client secret', secret: true }], actions: [{ key: 'sync_users', label: 'Invite directory users', needs: 'roleId' }] },
];

export const connectorDef = (key: string) => CATALOGUE.find((c) => c.key === key);

// ---- commerce orders ----------------------------------------------------------------------------

export interface ExternalOrder {
  id: string;
  name: string;
  createdAt: string;
  customer: { name: string; email?: string | null; phone?: string | null };
  lines: { sku: string; title: string; qty: number; price: number }[];
}

/** Shopify order JSON (REST / webhook) to our neutral shape. */
export function fromShopify(o: Record<string, any>): ExternalOrder {
  return {
    id: String(o.id),
    name: String(o.name ?? o.id),
    createdAt: String(o.created_at ?? new Date().toISOString()),
    customer: { name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || 'Online customer', email: o.email ?? o.customer?.email ?? null, phone: o.phone ?? null },
    lines: (o.line_items ?? []).map((l: Record<string, any>) => ({ sku: String(l.sku ?? ''), title: String(l.title ?? l.name ?? ''), qty: Number(l.quantity ?? 1), price: Number(l.price ?? 0) })),
  };
}

/** Sandbox orders for a commerce connector: two orders with the given SKUs, stable ids per day. */
export function sampleOrders(connector: string, skus: string[], day: string): ExternalOrder[] {
  const tag = createHash('sha1').update(`${connector}:${day}`).digest('hex').slice(0, 8);
  const s = skus.length ? skus : ['SKU-UNKNOWN'];
  return [
    { id: `${tag}-1`, name: `${connector.toUpperCase()}-${tag}-1`, createdAt: `${day}T05:00:00Z`, customer: { name: 'Priya Sharma', email: 'priya@example.in', phone: '+91 98480 00001' }, lines: [{ sku: s[0], title: 'Item', qty: 2, price: 499 }] },
    { id: `${tag}-2`, name: `${connector.toUpperCase()}-${tag}-2`, createdAt: `${day}T06:30:00Z`, customer: { name: 'Arjun Rao', email: 'arjun@example.in' }, lines: s.slice(0, 2).map((sku, i) => ({ sku, title: 'Item', qty: i + 1, price: 999 })) },
  ];
}

/** Shopify signs webhooks with HMAC-SHA256 of the raw body, base64, in X-Shopify-Hmac-Sha256. */
export function shopifySignatureOk(raw: Buffer, header: string | undefined, secret: string) {
  if (!header) return false;
  const a = Buffer.from(createHmac('sha256', secret).update(raw).digest('base64'));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Our generic inbound signature (IndiaMART push and others): hex HMAC-SHA256 in X-NextGen-Signature. */
export function genericSignatureOk(raw: Buffer, header: string | undefined, secret: string) {
  if (!header) return false;
  const a = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const b = Buffer.from(header.replace(/^sha256=/, ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- leads --------------------------------------------------------------------------------------

export interface ExternalLead {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  product?: string | null;
  message?: string | null;
}

/** IndiaMART Lead Manager JSON (UNIQUE_QUERY_ID, SENDER_NAME…) to our neutral shape. */
export function fromIndiaMart(r: Record<string, any>): ExternalLead {
  return {
    id: String(r.UNIQUE_QUERY_ID ?? r.QUERY_ID),
    name: String(r.SENDER_NAME ?? 'IndiaMART buyer'),
    company: r.SENDER_COMPANY || null,
    email: r.SENDER_EMAIL || null,
    phone: r.SENDER_MOBILE ? String(r.SENDER_MOBILE).replace(/^\+?91-?/, '+91 ') : null,
    city: r.SENDER_CITY || null,
    product: r.QUERY_PRODUCT_NAME || null,
    message: r.QUERY_MESSAGE || null,
  };
}

export function sampleLeads(day: string) {
  const tag = createHash('sha1').update(`indiamart:${day}`).digest('hex').slice(0, 8);
  return [
    { UNIQUE_QUERY_ID: `${tag}01`, SENDER_NAME: 'Ramesh Gupta', SENDER_COMPANY: 'Gupta Packaging', SENDER_MOBILE: '+91-9811100001', SENDER_EMAIL: 'ramesh@guptapack.example', SENDER_CITY: 'Delhi', QUERY_PRODUCT_NAME: 'Corrugated boxes', QUERY_MESSAGE: 'Need 5000 boxes a month' },
    { UNIQUE_QUERY_ID: `${tag}02`, SENDER_NAME: 'Lakshmi Iyer', SENDER_COMPANY: 'Iyer Foods', SENDER_MOBILE: '+91-9840000002', SENDER_CITY: 'Chennai', QUERY_PRODUCT_NAME: 'Printed cartons', QUERY_MESSAGE: 'Quote for 2000 pcs' },
  ];
}

// ---- logistics and payments ---------------------------------------------------------------------

/** A sandbox AWB: courier prefix and 10 digits derived from the delivery note. */
export function sandboxAwb(connector: string, deliveryId: string) {
  const digits = BigInt(`0x${createHash('sha256').update(`${connector}:${deliveryId}`).digest('hex').slice(0, 12)}`).toString().padStart(10, '0').slice(-10);
  return { courier: connector === 'delhivery' ? 'Delhivery' : 'Shiprocket (Xpressbees)', awb: `${connector === 'delhivery' ? 'DL' : 'SR'}${digits}` };
}

export const sandboxPaymentLink = (invoiceId: string) => `https://rzp.io/sandbox/${createHash('sha256').update(invoiceId).digest('hex').slice(0, 10)}`;

// ---- directory ----------------------------------------------------------------------------------

export function sampleDirectory(domain: string) {
  return [
    { email: `meera.k@${domain}`, name: 'Meera Krishnan' },
    { email: `vikram.s@${domain}`, name: 'Vikram Singh' },
  ];
}

// ---- Tally --------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tally XML import envelope with ledgers (customers under Sundry Debtors, vendors under Sundry Creditors) and stock items. */
export function tallyMastersXml(company: string, parties: { name: string; isCustomer: boolean; gstin: string | null; stateName?: string | null }[], items: { name: string; uom: string; hsn: string | null; gstRate: number | null }[]) {
  const ledgers = parties
    .map(
      (p) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(p.name)}" ACTION="Create"><NAME.LIST><NAME>${esc(p.name)}</NAME></NAME.LIST><PARENT>${p.isCustomer ? 'Sundry Debtors' : 'Sundry Creditors'}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>${p.gstin ? `<PARTYGSTIN>${esc(p.gstin)}</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>` : '<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>'}${p.stateName ? `<LEDSTATENAME>${esc(p.stateName)}</LEDSTATENAME>` : ''}</LEDGER></TALLYMESSAGE>`,
    )
    .join('');
  const stock = items
    .map(
      (i) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="${esc(i.name)}" ACTION="Create"><NAME.LIST><NAME>${esc(i.name)}</NAME></NAME.LIST><BASEUNITS>${esc(i.uom)}</BASEUNITS>${i.hsn ? `<GSTDETAILS.LIST><HSNCODE>${esc(i.hsn)}</HSNCODE><TAXABILITY>Taxable</TAXABILITY>${i.gstRate !== null ? `<STATEWISEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE>${i.gstRate}</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST>` : ''}</GSTDETAILS.LIST>` : ''}</STOCKITEM></TALLYMESSAGE>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${ledgers}${stock}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}
