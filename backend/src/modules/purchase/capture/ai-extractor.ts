import type { ModelRequest, ModelResponse } from '../../ai-gov/ai-gateway.service';
import type { ExtractedBill } from './text-extractor';

/**
 * Reads a scanned / photographed / PDF bill with Claude (vision + PDF input) and returns the
 * fields through a forced tool call, so the output is always structured JSON.
 */

const TOOL = {
  name: 'record_bill',
  description: 'Record the fields of an Indian GST purchase bill exactly as printed.',
  input_schema: {
    type: 'object',
    properties: {
      supplierName: { type: ['string', 'null'] },
      supplierGstin: { type: ['string', 'null'], description: '15-character GSTIN of the seller' },
      buyerGstin: { type: ['string', 'null'], description: 'GSTIN of the buyer (billed to)' },
      invoiceNo: { type: ['string', 'null'] },
      invoiceDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      reverseCharge: { type: 'boolean' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            hsnCode: { type: ['string', 'null'] },
            qty: { type: ['string', 'null'] },
            unit: { type: ['string', 'null'] },
            rate: { type: ['string', 'null'], description: 'Rate per unit before discount and tax' },
            discountPct: { type: ['string', 'null'] },
            taxableValue: { type: ['string', 'null'], description: 'Line value before GST' },
            gstRate: { type: ['string', 'null'], description: 'Total GST % (CGST+SGST or IGST)' },
          },
          required: ['description'],
        },
      },
      taxableTotal: { type: ['string', 'null'] },
      cgst: { type: ['string', 'null'] },
      sgst: { type: ['string', 'null'] },
      igst: { type: ['string', 'null'] },
      cess: { type: ['string', 'null'] },
      grandTotal: { type: ['string', 'null'] },
    },
    required: ['lines'],
  },
} as const;

const clean = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).replace(/[₹,\s]/g, ''));

export async function extractWithAi(send: (req: ModelRequest) => Promise<ModelResponse>, file: { buffer: Buffer; mimeType: string }): Promise<ExtractedBill> {
  const data = file.buffer.toString('base64');
  const block =
    file.mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : file.mimeType.startsWith('image/')
        ? { type: 'image', source: { type: 'base64', media_type: file.mimeType, data } }
        : { type: 'text', text: file.buffer.toString('utf8').slice(0, 100_000) };
  const body = await send({
    max_tokens: 4096,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          block,
          {
            type: 'text',
            text: 'This is a purchase bill received by our company. Record every item row and the totals as printed. Use plain numbers without currency symbols or commas. Dates as YYYY-MM-DD (Indian bills are day-first). Leave a field null when it is not on the bill; never guess.',
          },
        ],
      },
    ],
  });
  const out = (body.content.find((c) => c.type === 'tool_use') as { input?: Record<string, unknown> } | undefined)?.input ?? {};
  const lines = Array.isArray(out.lines) ? (out.lines as Record<string, unknown>[]) : [];
  return {
    supplierName: (out.supplierName as string) ?? null,
    supplierGstin: (out.supplierGstin as string | null)?.toUpperCase() ?? null,
    buyerGstin: (out.buyerGstin as string | null)?.toUpperCase() ?? null,
    invoiceNo: (out.invoiceNo as string) ?? null,
    invoiceDate: (out.invoiceDate as string) ?? null,
    reverseCharge: out.reverseCharge === true,
    lines: lines.map((l) => ({
      description: String(l.description ?? ''),
      hsnCode: clean(l.hsnCode),
      qty: clean(l.qty),
      unit: (l.unit as string) ?? null,
      rate: clean(l.rate),
      discountPct: clean(l.discountPct),
      taxableValue: clean(l.taxableValue),
      gstRate: clean(l.gstRate)?.replace('%', '') ?? null,
    })),
    taxableTotal: clean(out.taxableTotal),
    cgst: clean(out.cgst),
    sgst: clean(out.sgst),
    igst: clean(out.igst),
    cess: clean(out.cess),
    grandTotal: clean(out.grandTotal),
  };
}
